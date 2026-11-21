// Schedule engine for recurring payments.
//
// Pure functions, no DB access, so the scheduling rules can be unit tested.
// Every date in and out is a 'YYYY-MM-DD' string; Date objects are only used
// internally, always in UTC, so results never depend on the server's timezone.
// "Today" comes from APP_TZ (an IANA zone such as America/New_York), since the
// server's own clock may be in UTC.

const FREQUENCIES = ['weekly', 'biweekly', 'monthly', 'bimonthly', 'quarterly', 'annual', 'once'];
const WEEKEND_RULES = ['next', 'previous', 'none'];
const DIRECTIONS = ['outflow', 'inflow'];
const CATEGORIES = ['must_have', 'discretionary', 'income'];

const DAY_STEPS = { weekly: 7, biweekly: 14 };
const MONTH_STEPS = { monthly: 1, bimonthly: 2, quarterly: 3, annual: 12 };
const MONTHLY_FACTORS = {
  weekly: 52 / 12,
  biweekly: 26 / 12,
  monthly: 1,
  bimonthly: 1 / 2,
  quarterly: 1 / 3,
  annual: 1 / 12,
  once: 0,
};

// Occurrences can move a few days (weekends, overrides), so expand a little
// past the requested range and filter on the final date.
const RANGE_PADDING_DAYS = 10;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(str) {
  if (typeof str !== 'string' || !DATE_RE.test(str)) return false;
  return formatDate(parseDate(str)) === str;
}

function parseDate(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(str, days) {
  const date = parseDate(str);
  date.setUTCDate(date.getUTCDate() + days);
  return formatDate(date);
}

function daysBetween(fromStr, toStr) {
  return Math.round((parseDate(toStr) - parseDate(fromStr)) / 86400000);
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate(); // month is 1-12
}

// "Today" in the app's timezone, regardless of where the server runs.
function todayLocal(now = new Date(), timeZone = process.env.APP_TZ) {
  return now.toLocaleDateString('en-CA', { timeZone });
}

function isValidTimeZone(timeZone) {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone });
    return Boolean(timeZone);
  } catch {
    return false;
  }
}

// Day 31 in a 30-day month lands on the 30th; -1 is the last day, -2 the
// second-last, and so on.
function resolveDay(year, month, dayOfMonth) {
  const len = daysInMonth(year, month);
  const day = dayOfMonth < 0 ? len + 1 + dayOfMonth : Math.min(dayOfMonth, len);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function applyWeekendRule(dateStr, rule) {
  if (rule === 'none') return dateStr;
  const dow = parseDate(dateStr).getUTCDay(); // 0 = Sunday, 6 = Saturday
  if (dow !== 0 && dow !== 6) return dateStr;
  if (rule === 'previous') return addDays(dateStr, dow === 6 ? -1 : -2);
  return addDays(dateStr, dow === 6 ? 2 : 1);
}

// Nominal (pre-weekend-shift) dates of a payment between lo and hi inclusive.
function nominalDates(payment, lo, hi) {
  const anchor = payment.anchor_date;
  const dates = [];

  if (payment.frequency === 'once') {
    if (anchor >= lo && anchor <= hi) dates.push(anchor);
    return dates;
  }

  const dayStep = DAY_STEPS[payment.frequency];
  if (dayStep) {
    // First step on or after lo, counting backwards from the anchor if needed
    const k = Math.ceil(daysBetween(anchor, lo) / dayStep);
    for (let d = addDays(anchor, k * dayStep); d <= hi; d = addDays(d, dayStep)) {
      dates.push(d);
    }
    return dates;
  }

  const monthStep = MONTH_STEPS[payment.frequency];
  const anchorDate = parseDate(anchor);
  const anchorIndex = anchorDate.getUTCFullYear() * 12 + anchorDate.getUTCMonth();
  const dayOfMonth = payment.day_of_month ?? anchorDate.getUTCDate();
  const loDate = parseDate(lo);
  const loIndex = loDate.getUTCFullYear() * 12 + loDate.getUTCMonth();

  // Start one step early: a negative/clamped day can fall before lo's month day
  let k = Math.floor((loIndex - anchorIndex) / monthStep) - 1;
  for (;;) {
    const index = anchorIndex + k * monthStep;
    const year = Math.floor(index / 12);
    const month = (index % 12) + 1;
    const d = resolveDay(year, month, dayOfMonth);
    if (d > hi) break;
    if (d >= lo) dates.push(d);
    k++;
  }
  return dates;
}

// Expands a payment into its occurrences whose final date is within
// [fromDate, toDate]. Overrides (keyed by scheduled_date, the nominal date)
// can move an occurrence, change its amount, or mark it skipped; skipped
// occurrences are returned with skipped: true so the UI can show them.
function expandOccurrences(payment, overrides = [], fromDate, toDate) {
  const effectiveStart = payment.start_date || payment.anchor_date;
  const lo = maxDate(addDays(fromDate, -RANGE_PADDING_DAYS), effectiveStart);
  let hi = addDays(toDate, RANGE_PADDING_DAYS);
  if (payment.end_date && payment.end_date < hi) hi = payment.end_date;

  const overridesByDate = new Map(overrides.map(o => [o.scheduled_date, o]));
  const activeMonths = payment.active_months && payment.active_months.length
    ? new Set(payment.active_months.map(Number))
    : null;

  const amount = Number(payment.amount);
  const amountMax = payment.amount_max == null ? null : Number(payment.amount_max);

  // Overrides can move an occurrence further than the padding, so also pick
  // up any whose new date is in range — as long as the scheduled date is a
  // real occurrence of this payment.
  const scheduledDates = new Set(lo <= hi ? nominalDates(payment, lo, hi) : []);
  for (const o of overrides) {
    if (o.override_date && o.override_date >= fromDate && o.override_date <= toDate &&
        o.scheduled_date >= effectiveStart && (!payment.end_date || o.scheduled_date <= payment.end_date) &&
        nominalDates(payment, o.scheduled_date, o.scheduled_date).length) {
      scheduledDates.add(o.scheduled_date);
    }
  }

  const occurrences = [];
  for (const scheduled of [...scheduledDates].sort()) {
    if (activeMonths && !activeMonths.has(parseDate(scheduled).getUTCMonth() + 1)) continue;

    const override = overridesByDate.get(scheduled);
    const date = override?.override_date || applyWeekendRule(scheduled, payment.weekend_rule || 'next');
    if (date < fromDate || date > toDate) continue;

    const overrideAmount = override?.override_amount == null ? null : Number(override.override_amount);
    occurrences.push({
      payment_id: payment.id,
      name: payment.name,
      direction: payment.direction,
      category: payment.category,
      scheduled_date: scheduled,
      date,
      // A known bill amount replaces both the typical and worst-case amounts
      amount: overrideAmount ?? amount,
      amount_max: overrideAmount ?? amountMax,
      overridden: Boolean(override),
      skipped: Boolean(override?.skipped),
    });
  }
  return occurrences;
}

function maxDate(a, b) {
  return a > b ? a : b;
}

// Typical monthly cost, for "what do must-haves cost per month". Monthly
// payments limited to some months (tuition Sep–Jul) are averaged over the year.
function monthlyEquivalent(payment) {
  let factor = MONTHLY_FACTORS[payment.frequency] ?? 0;
  if (payment.frequency === 'monthly' && payment.active_months && payment.active_months.length) {
    factor = payment.active_months.length / 12;
  }
  return Math.round(Number(payment.amount) * factor * 100) / 100;
}

// 'ended' once end_date has passed, 'scheduled' before it starts, else 'active'.
function paymentStatus(payment, today) {
  if (payment.end_date && payment.end_date < today) return 'ended';
  const effectiveStart = payment.start_date || payment.anchor_date;
  if (payment.frequency !== 'once' && effectiveStart > today) return 'scheduled';
  if (payment.frequency === 'once' && payment.anchor_date < today) return 'ended';
  return 'active';
}

// Next non-skipped occurrence on or after today, looking a little over a
// year ahead so annual payments are found.
function nextOccurrence(payment, overrides, today) {
  const upcoming = expandOccurrences(payment, overrides, today, addDays(today, 400));
  return upcoming.find(o => !o.skipped) || null;
}

module.exports = {
  FREQUENCIES,
  WEEKEND_RULES,
  DIRECTIONS,
  CATEGORIES,
  isValidDate,
  addDays,
  todayLocal,
  isValidTimeZone,
  applyWeekendRule,
  expandOccurrences,
  monthlyEquivalent,
  paymentStatus,
  nextOccurrence,
};
