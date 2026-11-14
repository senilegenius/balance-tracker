-- Adds recurring payments: bills and deposits that hit an account on a
-- schedule (mortgage, loans, utilities, tuition, paycheques). Used to list
-- upcoming payments and to work out how much checking needs before the next
-- paycheque, so the rest can stay in savings.
--
-- Apply with: psql -d balance_tracker -f db/add_recurring_payments.sql

CREATE TABLE IF NOT EXISTS recurring_payments (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  account_id INTEGER REFERENCES accounts(id),       -- account it hits (checking)
  direction VARCHAR(10) NOT NULL DEFAULT 'outflow', -- 'outflow' | 'inflow'
  category VARCHAR(20) NOT NULL DEFAULT 'must_have', -- 'must_have' | 'discretionary' | 'income'
  amount DECIMAL(15, 2) NOT NULL,                   -- typical amount, always positive
  amount_max DECIMAL(15, 2),                        -- worst case for variable bills
  frequency VARCHAR(12) NOT NULL,
  anchor_date DATE NOT NULL,                        -- a known occurrence; schedule projects from it
  day_of_month SMALLINT,                            -- 1..31, or -1 = last day, -2 = second-last; NULL = anchor's day
  active_months SMALLINT[],                         -- months it happens in (1-12); NULL = every month
  weekend_rule VARCHAR(10) NOT NULL DEFAULT 'next', -- 'next' | 'previous' | 'none'
  start_date DATE,                                  -- NULL = active from the anchor
  end_date DATE,                                    -- NULL = open-ended; set to stop (e.g. childcare)
  payee_match VARCHAR(100),                         -- future: match bank transaction descriptions
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,          -- soft delete
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT chk_rp_direction CHECK (direction IN ('outflow', 'inflow')),
  CONSTRAINT chk_rp_category  CHECK (category IN ('must_have', 'discretionary', 'income')),
  CONSTRAINT chk_rp_frequency CHECK (frequency IN ('weekly', 'biweekly', 'monthly', 'bimonthly', 'quarterly', 'annual', 'once')),
  CONSTRAINT chk_rp_weekend   CHECK (weekend_rule IN ('next', 'previous', 'none')),
  CONSTRAINT chk_rp_amount    CHECK (amount >= 0 AND (amount_max IS NULL OR amount_max >= amount)),
  CONSTRAINT chk_rp_dom       CHECK (day_of_month IS NULL OR day_of_month BETWEEN 1 AND 31 OR day_of_month BETWEEN -7 AND -1),
  CONSTRAINT chk_rp_months    CHECK (active_months IS NULL OR active_months <@ ARRAY[1,2,3,4,5,6,7,8,9,10,11,12]::SMALLINT[]),
  CONSTRAINT chk_rp_dates     CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date)
);

-- One-off changes to a single occurrence: move it, change its amount, or skip
-- it. Keyed by the scheduled date so the override survives edits to the rule.
CREATE TABLE IF NOT EXISTS recurring_payment_overrides (
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

-- App-wide settings edited from the UI (e.g. checking_buffer).
CREATE TABLE IF NOT EXISTS app_settings (
  key VARCHAR(50) PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recurring_payments_active ON recurring_payments(is_active);

-- Supabase: block the anonymous API, same as the other tables
-- (db/enable_rls.sql). Policies only where a "postgres" role exists, so this
-- file also applies cleanly to a local database.
ALTER TABLE recurring_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE recurring_payment_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t TEXT;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN
    FOREACH t IN ARRAY ARRAY['recurring_payments', 'recurring_payment_overrides', 'app_settings'] LOOP
      IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = t AND policyname = 'Allow postgres full access') THEN
        EXECUTE format('CREATE POLICY "Allow postgres full access" ON %I FOR ALL TO postgres USING (true) WITH CHECK (true)', t);
      END IF;
    END LOOP;
  END IF;
END $$;
