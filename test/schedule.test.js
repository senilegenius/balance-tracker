// Unit tests for the recurring-payment schedule engine (lib/schedule.js).
// Pure functions — no database or server needed.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  isValidDate,
  applyWeekendRule,
  expandOccurrences,
  monthlyEquivalent,
  paymentStatus,
  nextOccurrence,
  todayLocal,
  isValidTimeZone,
} = require('../lib/schedule');

function payment(overrides) {
  return {
    id: 1,
    name: 'Test bill',
    direction: 'outflow',
    category: 'must_have',
    amount: '100.00',
    amount_max: null,
    weekend_rule: 'next',
    day_of_month: null,
    active_months: null,
    start_date: null,
    end_date: null,
    ...overrides,
  };
}

const dates = occs => occs.map(o => o.date);

describe('isValidDate', () => {
  it('accepts real dates and rejects malformed or impossible ones', () => {
    assert.equal(isValidDate('2026-02-28'), true);
    assert.equal(isValidDate('2026-02-30'), false);
    assert.equal(isValidDate('2026-2-3'), false);
    assert.equal(isValidDate(''), false);
    assert.equal(isValidDate(null), false);
  });
});

describe('applyWeekendRule', () => {
  it('moves Saturday and Sunday to Monday with "next"', () => {
    assert.equal(applyWeekendRule('2026-10-24', 'next'), '2026-10-26'); // Sat
    assert.equal(applyWeekendRule('2026-11-22', 'next'), '2026-11-23'); // Sun
  });

  it('moves Saturday and Sunday to Friday with "previous"', () => {
    assert.equal(applyWeekendRule('2026-10-24', 'previous'), '2026-10-23');
    assert.equal(applyWeekendRule('2026-11-22', 'previous'), '2026-11-20');
  });

  it('leaves weekdays alone and ignores weekends with "none"', () => {
    assert.equal(applyWeekendRule('2026-10-23', 'next'), '2026-10-23');
    assert.equal(applyWeekendRule('2026-10-24', 'none'), '2026-10-24');
  });
});

describe('expandOccurrences: weekly and biweekly', () => {
  it('steps every 14 days from the anchor, keeping the Wednesday cycle', () => {
    const p = payment({ frequency: 'biweekly', anchor_date: '2026-10-07' });
    assert.deepEqual(
      dates(expandOccurrences(p, [], '2026-11-01', '2026-12-31')),
      ['2026-11-04', '2026-11-18', '2026-12-02', '2026-12-16', '2026-12-30']
    );
  });

  it('includes an occurrence that lands exactly on the range boundaries', () => {
    const p = payment({ frequency: 'biweekly', anchor_date: '2026-10-07' });
    assert.deepEqual(
      dates(expandOccurrences(p, [], '2026-11-04', '2026-11-18')),
      ['2026-11-04', '2026-11-18']
    );
  });

  it('steps weekly and starts at the anchor when no start_date is set', () => {
    const p = payment({ frequency: 'weekly', anchor_date: '2026-11-04' });
    assert.deepEqual(
      dates(expandOccurrences(p, [], '2026-10-01', '2026-11-20')),
      ['2026-11-04', '2026-11-11', '2026-11-18']
    );
  });

  it('honours start_date and end_date (a service switched on and off)', () => {
    const p = payment({
      frequency: 'weekly',
      anchor_date: '2026-07-06',
      start_date: '2026-11-02',
      end_date: '2026-11-20',
    });
    assert.deepEqual(
      dates(expandOccurrences(p, [], '2026-10-01', '2026-12-31')),
      ['2026-11-02', '2026-11-09', '2026-11-16']
    );
  });
});

describe('expandOccurrences: monthly', () => {
  it('uses the anchor day and moves weekends to Monday', () => {
    const p = payment({ frequency: 'monthly', anchor_date: '2026-09-12' });
    assert.deepEqual(
      dates(expandOccurrences(p, [], '2026-10-01', '2027-01-31')),
      ['2026-10-12', '2026-11-12', '2026-12-14', '2027-01-12']
    );
  });

  it('clamps day 31 to the end of shorter months', () => {
    const p = payment({ frequency: 'monthly', anchor_date: '2027-01-29', day_of_month: 31, weekend_rule: 'none' });
    assert.deepEqual(
      dates(expandOccurrences(p, [], '2027-01-01', '2027-04-30')),
      ['2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30']
    );
  });

  it('counts negative days back from month end (bill on the third-last day)', () => {
    const p = payment({ frequency: 'monthly', anchor_date: '2025-01-29', day_of_month: -3 });
    const got = dates(expandOccurrences(p, [], '2025-11-01', '2026-06-30'));
    assert.deepEqual(got, [
      '2025-11-28',
      '2025-12-29',
      '2026-01-29',
      '2026-02-26',
      '2026-03-30', // Mar 29 was a Sunday
      '2026-04-28',
      '2026-05-29',
      '2026-06-29', // Jun 28 was a Sunday
    ]);
  });

  it('skips months outside active_months (tuition Sep–Jul)', () => {
    const p = payment({
      frequency: 'monthly',
      anchor_date: '2026-09-01',
      active_months: [1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12],
    });
    const got = dates(expandOccurrences(p, [], '2027-06-01', '2027-10-31'));
    assert.deepEqual(got, ['2027-06-01', '2027-07-01', '2027-09-01', '2027-10-01']);
  });

  it('finds an occurrence shifted into the range from just before it', () => {
    // Nov 1 2026 is a Sunday, so the 1st-of-month debit lands on Mon Nov 2
    const p = payment({ frequency: 'monthly', anchor_date: '2026-10-01' });
    assert.deepEqual(dates(expandOccurrences(p, [], '2026-11-02', '2026-11-30')), ['2026-11-02']);
    assert.deepEqual(dates(expandOccurrences(p, [], '2026-10-25', '2026-11-01')), []);
  });
});

describe('expandOccurrences: other frequencies', () => {
  it('handles bimonthly, quarterly, annual and once', () => {
    const range = ['2026-01-01', '2026-12-31'];
    const bi = payment({ frequency: 'bimonthly', anchor_date: '2025-11-20', weekend_rule: 'none' });
    assert.deepEqual(dates(expandOccurrences(bi, [], ...range)), [
      '2026-01-20', '2026-03-20', '2026-05-20', '2026-07-20', '2026-09-20', '2026-11-20',
    ]);

    const q = payment({ frequency: 'quarterly', anchor_date: '2026-02-10' });
    assert.deepEqual(dates(expandOccurrences(q, [], ...range)), [
      '2026-02-10', '2026-05-11', '2026-08-10', '2026-11-10',
    ]);

    const annual = payment({ frequency: 'annual', anchor_date: '2025-07-02' });
    assert.deepEqual(dates(expandOccurrences(annual, [], ...range)), ['2026-07-02']);

    const once = payment({ frequency: 'once', anchor_date: '2026-03-04' });
    assert.deepEqual(dates(expandOccurrences(once, [], ...range)), ['2026-03-04']);
    assert.deepEqual(dates(expandOccurrences(once, [], '2026-04-01', '2026-12-31')), []);
  });
});

describe('expandOccurrences: amounts and overrides', () => {
  it('returns numeric amounts and the worst case', () => {
    const p = payment({ frequency: 'monthly', anchor_date: '2026-10-21', amount: '120.00', amount_max: '260.00' });
    const [occ] = expandOccurrences(p, [], '2026-11-01', '2026-11-30');
    assert.equal(occ.amount, 120);
    assert.equal(occ.amount_max, 260);
    assert.equal(occ.scheduled_date, '2026-11-21');
    assert.equal(occ.date, '2026-11-23');
  });

  it('applies an override amount to both typical and worst case', () => {
    const p = payment({ frequency: 'monthly', anchor_date: '2026-10-21', amount: '120.00', amount_max: '260.00' });
    const overrides = [{ scheduled_date: '2026-11-21', override_amount: '187.40', override_date: null, skipped: false }];
    const [occ] = expandOccurrences(p, overrides, '2026-11-01', '2026-11-30');
    assert.equal(occ.amount, 187.4);
    assert.equal(occ.amount_max, 187.4);
    assert.equal(occ.overridden, true);
  });

  it('moves an occurrence with override_date, in or out of the range', () => {
    const p = payment({ frequency: 'monthly', anchor_date: '2026-09-12' });
    const moved = [{ scheduled_date: '2026-11-12', override_date: '2026-12-02', skipped: false }];
    assert.deepEqual(dates(expandOccurrences(p, moved, '2026-11-01', '2026-11-30')), []);
    assert.deepEqual(dates(expandOccurrences(p, moved, '2026-12-01', '2026-12-05')), ['2026-12-02']);
  });

  it('flags skipped occurrences instead of dropping them', () => {
    const p = payment({ frequency: 'monthly', anchor_date: '2026-09-12' });
    const skip = [{ scheduled_date: '2026-11-12', skipped: true }];
    const [occ] = expandOccurrences(p, skip, '2026-11-01', '2026-11-30');
    assert.equal(occ.skipped, true);
  });
});

describe('monthlyEquivalent', () => {
  it('normalises each frequency to a monthly figure', () => {
    assert.equal(monthlyEquivalent(payment({ frequency: 'biweekly', amount: '1200' })), 2600);
    assert.equal(monthlyEquivalent(payment({ frequency: 'weekly', amount: '300' })), 1300);
    assert.equal(monthlyEquivalent(payment({ frequency: 'monthly', amount: '99.99' })), 99.99);
    assert.equal(monthlyEquivalent(payment({ frequency: 'bimonthly', amount: '500' })), 250);
    assert.equal(monthlyEquivalent(payment({ frequency: 'quarterly', amount: '300' })), 100);
    assert.equal(monthlyEquivalent(payment({ frequency: 'annual', amount: '6000' })), 500);
    assert.equal(monthlyEquivalent(payment({ frequency: 'once', amount: '6000' })), 0);
  });

  it('averages a monthly payment over its active months', () => {
    const p = payment({ frequency: 'monthly', amount: '1200', active_months: [1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12] });
    assert.equal(monthlyEquivalent(p), 1100);
  });
});

describe('paymentStatus and nextOccurrence', () => {
  it('reports active, scheduled and ended', () => {
    const today = '2026-11-10';
    assert.equal(paymentStatus(payment({ frequency: 'monthly', anchor_date: '2026-01-01' }), today), 'active');
    assert.equal(paymentStatus(payment({ frequency: 'weekly', anchor_date: '2026-12-01' }), today), 'scheduled');
    assert.equal(paymentStatus(payment({ frequency: 'weekly', anchor_date: '2026-01-01', end_date: '2026-08-31' }), today), 'ended');
    assert.equal(paymentStatus(payment({ frequency: 'once', anchor_date: '2026-03-04' }), today), 'ended');
  });

  it('finds the next non-skipped occurrence, including annual ones', () => {
    const annual = payment({ frequency: 'annual', anchor_date: '2026-08-07' });
    assert.equal(nextOccurrence(annual, [], '2026-11-10').date, '2027-08-09'); // Aug 7 2027 is a Saturday

    const monthly = payment({ frequency: 'monthly', anchor_date: '2026-09-12' });
    const skip = [{ scheduled_date: '2026-11-12', skipped: true }];
    assert.equal(nextOccurrence(monthly, skip, '2026-11-10').date, '2026-12-14');
  });
});

describe('todayLocal', () => {
  it('uses the given time zone, not UTC', () => {
    // Tokyo is UTC+9: 14:30 UTC is still Nov 10 there, 15:30 UTC is Nov 11
    assert.equal(todayLocal(new Date('2026-11-10T14:30:00Z'), 'Asia/Tokyo'), '2026-11-10');
    assert.equal(todayLocal(new Date('2026-11-10T15:30:00Z'), 'Asia/Tokyo'), '2026-11-11');
  });

  it('validates time zone names', () => {
    assert.equal(isValidTimeZone('Asia/Tokyo'), true);
    assert.equal(isValidTimeZone('Not/AZone'), false);
    assert.equal(isValidTimeZone(undefined), false);
  });
});
