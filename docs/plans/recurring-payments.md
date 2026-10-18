# Plan: Recurring payments & checking target

## Goal

Keep as much money as possible in savings and move into checking only what the
upcoming must-have payments need. To get there the app needs to know:

1. **What recurring payments hit checking**: a list you can edit, including
   payments that come and go (e.g. weekly childcare) and annual bills (property tax).
2. **What's coming up**: a dated list of upcoming payments (a calendar view comes later).
3. **How much checking needs right now**: a "checking target" for the current
   pay period, compared against the current checking balance.
4. **What must-haves cost per month**: every schedule normalized to a monthly figure.

## Context that shapes the design

- **Income routing today:** the user's paycheque goes to savings; their
  partner's paycheque (every second Friday) goes to checking. The
  eventual goal is for both to go to savings, with transfers into checking sized
  by this feature. So **inflows are modelled the same way as outflows**: a
  recurring item with `direction = 'inflow'`. The checking target uses the
  next checking inflow as the end of the pay period. When paycheques move to
  savings, the user removes that inflow and the target changes to a fixed
  horizon (or to the planned transfer dates).
- **RBC credit card payments** come out of checking but stay manual for now.
  The user transfers the right amount when paying. Out of scope for v1 (see Phase 4).
- **Income taxes are not tracked.** They're too variable and manual. Property tax is tracked.
- The app is single-household: there's no `user_id` on `accounts`, and new tables follow the same pattern.
- Same-day inflow and outflow (mortgage and payroll both post on Fridays): the target
  **never relies on a same-day inflow** to cover an outflow.

## Data model

New migration `db/add_recurring_payments.sql`, following the `add_sync_paused.sql`
pattern. Also update `db/schema.sql` (DROP + CREATE), `db/enable_rls.sql`, and the
`truncateAll` list in `test/helpers/db.js`.

```sql
CREATE TABLE recurring_payments (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,              -- "Mortgage", "Car insurance"
  account_id INTEGER REFERENCES accounts(id),  -- account it hits (checking)
  direction VARCHAR(10) NOT NULL DEFAULT 'outflow',   -- 'outflow' | 'inflow'
  category VARCHAR(20) NOT NULL DEFAULT 'must_have',  -- 'must_have' | 'discretionary' | 'income'
  amount DECIMAL(15, 2) NOT NULL,          -- expected amount, always positive
  amount_max DECIMAL(15, 2),               -- optional worst case for variable bills (e.g. a mobile bill)
  frequency VARCHAR(12) NOT NULL,          -- 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'annual' | 'once'
  anchor_date DATE NOT NULL,               -- a known occurrence; the schedule is projected from it
  weekend_rule VARCHAR(10) NOT NULL DEFAULT 'next',   -- 'next' | 'previous' | 'none'
  start_date DATE,                         -- NULL = active since anchor
  end_date DATE,                           -- NULL = open-ended; set to stop (childcare paused)
  payee_match VARCHAR(100),                -- future: match bank transaction descriptions
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true, -- soft delete, like accounts.is_active
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT chk_rp_direction CHECK (direction IN ('outflow', 'inflow')),
  CONSTRAINT chk_rp_frequency CHECK (frequency IN ('weekly','biweekly','monthly','quarterly','annual','once')),
  CONSTRAINT chk_rp_weekend   CHECK (weekend_rule IN ('next','previous','none')),
  CONSTRAINT chk_rp_amount    CHECK (amount >= 0 AND (amount_max IS NULL OR amount_max >= amount))
);

-- One-off changes to a single occurrence: move it, change its amount, or skip it.
-- Keyed by the *scheduled* date so the override survives rule edits that don't
-- move the schedule.
CREATE TABLE recurring_payment_overrides (
  id SERIAL PRIMARY KEY,
  recurring_payment_id INTEGER NOT NULL REFERENCES recurring_payments(id) ON DELETE CASCADE,
  scheduled_date DATE NOT NULL,
  override_date DATE,              -- NULL = keep the scheduled date
  override_amount DECIMAL(15, 2),  -- NULL = keep the rule amount
  skipped BOOLEAN NOT NULL DEFAULT false,
  note TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (recurring_payment_id, scheduled_date)
);
```

**Design decisions**
- **Permanent change vs. one-off.** A lasting amount change (e.g. a new insurance
  premium) is an edit to the payment. Only future occurrences are projected, so
  there's no history to keep consistent. A change to a single occurrence goes in
  an override.
- **Starting and stopping payments.** Childcare is added with a `start_date` and stopped by
  setting `end_date`. The row stays, so it can be restarted later by clearing
  `end_date` or setting a new start. Deleting a payment is a soft delete.
- **Projecting from an anchor date.** Monthly payments keep the anchor's day of month,
  moved to the month's last day when needed (31st → Feb 28). Annual payments keep
  the anchor's month and day. Weekly and biweekly payments step 7 or 14 days from
  the anchor, so the mortgage stays on its Friday cycle.
- **Weekend rule.** Each payment has its own rule. The observed data supports
  `next` as the default: monthly debits due on a Saturday or Sunday come out
  the following Monday. Statutory holidays are
  **not** handled in v1, because the data shows payments posting on BC Day anyway.
- **Positive amounts plus `direction`.** Clearer than signed amounts. Snapshots stay
  signed as they are today.

## Schedule engine: `lib/schedule.js`

This is the first module pulled out of `server.js`. It's pure logic with no DB
access, so it can be unit tested (the backlog already asks for logic that can be
tested this way).

```js
expandOccurrences(payment, overrides, fromDate, toDate)
  // → [{ payment_id, name, direction, category, scheduled_date, date, amount, amount_max, overridden, skipped }]
monthlyEquivalent(payment)
  // weekly ×52/12, biweekly ×26/12, monthly ×1, quarterly ÷3, annual ÷12, once → 0
checkingTarget({ balance, occurrences, today, buffer })
  // → see "Checking target" below
```

- All dates are `YYYY-MM-DD` strings in the engine. No JS `Date` timezone math is
  exposed, which avoids off-by-one-day bugs on Lambda (UTC).
- "Today" is computed in `America/Vancouver`. One helper does this and its
  result is passed in, so tests can pin the date.

## API (all under the existing `requireAuth` on `/api/`)

| Method & path | Purpose |
|---|---|
| `GET /api/recurring_payments` | Every non-deleted payment, each with `monthly_equivalent`, `next_date`, `status` (`active` / `ended` / `scheduled`), plus totals per category |
| `POST /api/recurring_payments` | Create. Validation mirrors `POST /api/accounts/manual` (required fields, allowed values, amounts ≥ 0, `end_date ≥ start_date`) |
| `PUT /api/recurring_payments/:id` | Update. Setting `end_date` stops a payment |
| `DELETE /api/recurring_payments/:id` | Soft delete (`is_active = false`) |
| `PUT /api/recurring_payments/:id/overrides/:scheduledDate` | Add or replace a one-off override (amount, date, skip) |
| `DELETE /api/recurring_payments/:id/overrides/:scheduledDate` | Remove an override |
| `GET /api/upcoming_payments?from=&to=&account_id=` | Occurrences in the range (default: today + 30 days), sorted, each with a projected running balance |
| `GET /api/checking_target?account_id=&buffer=` | The checking target (below) |

## Checking target

Inputs: the checking account's latest balance snapshot, the occurrences in
the range, and a buffer.

1. **Current period** = today → the next checking inflow date (if there's no
   inflow, today + 14 days). Outflows **on** the inflow date count in the current
   period, so a same-day paycheque is never relied on.
2. `needed_now = Σ outflows in the period (using amount_max when set) + buffer`
3. `difference = balance − needed_now`. If it's negative, show **"Transfer $X to
   checking."** If it's positive, show **"$Y could move to savings."**
4. **Next-period check:** compare the next inflow with the outflows between that
   inflow and the one after it. If the inflow won't cover them, show a warning.
   For example: school fees, a loan payment and the internet bill all
   due the Monday after payday.

Buffer for v1: a query param, defaulting to a constant in `server.js`, with an
input on the page. Whether it should be stored server-side is an open question.

Worked example (fictional numbers; also the Phase 2 test fixture): balance $3,000,
next inflow Fri the 30th. Outflows through the 30th = loan $300 + insurance $100 +
phone $150 (max $400) + mortgage $2,400 = **$3,200** using `amount_max` → difference
**−$200**, so "Transfer $200 to checking" (plus buffer). Next period: inflow $3,500
vs. $1,800 due the following Monday → covered.

## UI: `public/payments.html` + `public/js/payments.js`

Add a **📅 Payments** tab next to *Liquid Cash* / *Retirement*. Protect it with
`requireAuthPage` (and add the missing protection for `/retirement.html` while
there). Reuse the existing dark-mode and card styles.

1. **Checking target card** (top): balance, needed through `<date>`, buffer input,
   and either "Transfer $X to checking" or "$Y could move to savings", plus the
   next-period warning when it applies.
2. **Upcoming list:** grouped by date for the next 14 or 30 days (toggle). Each row
   shows name, amount (range shown for variable bills), and a projected running
   balance. Inflows are styled differently. Each row can be moved, given a
   different amount, or skipped, which creates an override.
3. **Recurring payments table:** every payment with frequency, next date,
   amount, monthly equivalent, and category. Add / edit (modal) / end / restart /
   delete. Ended payments are collapsed under "Inactive" so childcare can be
   switched back on in one click. Footer shows **must-have total per month**,
   **income per month**, and the difference between them.

## Getting real data in

The real payments are entered through the UI after deploy. Real financial
data is **not** committed to the repo. Fictional recurring payments are added to
`db/seed_sample_data.sql` for the demo user, and tests use fictional data.

The starting list (derived from real checking history) is kept locally, outside the repo.

## Phases / PRs

Each phase ships on its own branch → PR → sandbox → tag, following the existing
release flow. **Migrations are applied by hand: to sandbox before merge, to prod before tag.**

**Phase 1: Recurring payments list (data + CRUD)**
- Migration, schema, RLS, test helper updates
- `lib/schedule.js` with `expandOccurrences` + `monthlyEquivalent`, plus unit tests
  (month-end clamping, weekend rules, biweekly anchor stepping backwards and
  forwards, start/end windows, annual)
- CRUD endpoints, plus integration tests (auth required, validation, soft delete, stop/restart)
- Payments page with the recurring payments table and monthly totals

**Phase 2: Upcoming payments & checking target**
- Overrides table use + endpoints, `upcoming_payments`, `checking_target`, plus tests
  (including the same-day inflow rule and the worked example above as a fixture)
- Checking target card + upcoming list on the payments page
- Optional: a small "Checking target" summary card on the main dashboard

**Phase 3: Calendar view**
- Month grid of occurrences (inflows and outflows), with daily totals and the
  projected balance. Built from `upcoming_payments`, so no new backend work.

**Phase 4: Plaid-assisted (later; each item needs a check that Canadian/RBC support exists)**
- **Credit card statements:** Plaid `/liabilities/get` gives `last_statement_balance`
  and `next_payment_due_date`. If RBC supports it, card payments become automatic
  upcoming occurrences, which removes the biggest manual step today.
- **Matching transactions:** use Plaid transactions to mark occurrences as
  paid, flag amount changes, and use `payee_match` to suggest new recurring
  payments (Plaid also has `/transactions/recurring/get`).

**Phase 5: Savings-first transfers**
- Once both paycheques go to savings, plan transfers: on each savings inflow,
  recommend (or schedule a reminder for) the transfer to checking that covers the
  next period. The model already supports this. It's mostly UI on top of
  `checkingTarget`.

## Open questions

1. **Buffer:** what's a comfortable default cushion ($250? $500?), and should it
   be stored server-side or just entered on the page?
2. **Irregular school fees:** are they predictable enough to model (e.g. annual
   or termly), or should they be entered as one-off payments when known?
3. **Debit days:** confirm the usual debit day for bills whose posting date wanders.
4. **Multiple checking accounts:** is there only one checking account to plan for? v1 assumes
   one account is chosen on the page, with a dropdown if there are more.
