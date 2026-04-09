-- Sample seed data for local Docker development
-- Login: demo / demo1234

-- Clear existing data
TRUNCATE balance_snapshots, accounts, plaid_items, exchange_rates, users RESTART IDENTITY CASCADE;

-- Demo user (password: demo1234)
INSERT INTO users (username, password_hash) VALUES
  ('demo', '$2b$10$Wr31hMj8GIh15lCFg.qYtuIej6y5fHeDXdBFEYnhQWQ5S.eRKEEIG');

-- Exchange rate
INSERT INTO exchange_rates (from_currency, to_currency, rate, updated_at)
VALUES ('USD', 'CAD', 1.4400, NOW());

-- ─── Institutions ────────────────────────────────────────────────────────────
-- Liquid / everyday banking
INSERT INTO plaid_items (institution_name) VALUES
  ('Maple Bank'),           -- id 1
  ('Eagle Credit Union'),   -- id 2
  ('Cards Inc');            -- id 3

-- Retirement institutions (manual — no Plaid tokens)
INSERT INTO plaid_items (institution_name) VALUES
  ('Summit Investments'),   -- id 4  (USD 401k)
  ('Northern Pension Trust'), -- id 5  (CAD pension, manual)
  ('Sun Life Financial');   -- id 6  (CAD RRSP)

-- ─── Accounts ────────────────────────────────────────────────────────────────
INSERT INTO accounts
  (plaid_item_id, institution_name, account_name, account_type, account_category, currency, account_mask, is_liability, is_active)
VALUES
  -- ── Liquid: Maple Bank (CAD) ──────────────────────────────────────────────
  (1, 'Maple Bank', 'Chequing',             'checking',    'liquid',     'CAD', '7701', false, true),  -- id 1
  (1, 'Maple Bank', 'High Interest Savings','savings',     'liquid',     'CAD', '7702', false, true),  -- id 2

  -- ── Liquid: Eagle Credit Union (USD) ──────────────────────────────────────
  (2, 'Eagle Credit Union', 'US Checking',  'checking',    'liquid',     'USD', '3301', false, true),  -- id 3
  (2, 'Eagle Credit Union', 'US Savings',   'savings',     'liquid',     'USD', '3302', false, true),  -- id 4

  -- ── Liquid: Credit Cards ──────────────────────────────────────────────────
  (3, 'Cards Inc', 'Cashback Visa',         'credit card', 'liquid',     'CAD', '4411', false, true),  -- id 5
  (3, 'Cards Inc', 'Travel Rewards',        'credit card', 'liquid',     'USD', '4422', false, true),  -- id 6

  -- ── Liquid: Liabilities ───────────────────────────────────────────────────
  (NULL, 'Liabilities', 'Mortgage',         'liability',   'liquid',     'CAD', NULL,   true,  true),  -- id 7
  (NULL, 'Liabilities', 'Car Loan',         'liability',   'liquid',     'CAD', NULL,   true,  true),  -- id 8
  (NULL, 'Liabilities', 'Student Loan',     'liability',   'liquid',     'USD', NULL,   true,  true),  -- id 9

  -- ── Retirement: Summit Investments 401(k) (USD) ──────────────────────────
  (4, 'Summit Investments', '401(k)',        '401k',        'retirement', 'USD', '8801', false, true),  -- id 10

  -- ── Retirement: Northern Pension Trust (CAD, manual) ─────────────────────
  (NULL, 'Northern Pension Trust', 'Public Service Pension', 'pension', 'retirement', 'CAD', NULL, false, true),  -- id 11

  -- ── Retirement: Sun Life RRSP (CAD) ──────────────────────────────────────
  (6, 'Sun Life Financial', 'Group RRSP',   'rrsp',        'retirement', 'CAD', '9901', false, true);  -- id 12

-- ─── Balance Snapshots ───────────────────────────────────────────────────────
-- ~90 days of history across 6 snapshot dates.
--
-- Liquid accounts:
--   Checking:    fluctuates with paycheque/spending cycles
--   Savings:     slow upward trend
--   Credit cards: negative, spend-then-pay cycles
--   Liabilities: negative, gradual paydown
--
-- Retirement accounts:
--   401(k) USD:  market-driven growth with minor dips; contributions each period
--   Pension CAD: steady defined-benefit accumulation
--   RRSP CAD:    contribution-driven growth, small market variance

-- 2025-12-01
INSERT INTO balance_snapshots (account_id, balance, date, usd_to_cad_rate) VALUES
  -- Liquid
  (1,    4250.00, '2025-12-01', NULL),
  (2,   15200.00, '2025-12-01', NULL),
  (3,    1820.50, '2025-12-01', 1.4400),
  (4,    8500.00, '2025-12-01', 1.4400),
  (5,   -1340.00, '2025-12-01', NULL),
  (6,    -420.00, '2025-12-01', 1.4400),
  (7, -385000.00, '2025-12-01', NULL),
  (8,  -18200.00, '2025-12-01', NULL),
  (9,  -32500.00, '2025-12-01', 1.4400),
  -- Retirement
  (10,  141200.00, '2025-12-01', 1.4400),  -- 401(k) USD
  (11,   79400.00, '2025-12-01', NULL),     -- Pension CAD
  (12,   43100.00, '2025-12-01', NULL);     -- RRSP CAD

-- 2025-12-15  (post-paycheque)
INSERT INTO balance_snapshots (account_id, balance, date, usd_to_cad_rate) VALUES
  -- Liquid
  (1,    6800.00, '2025-12-15', NULL),
  (2,   15350.00, '2025-12-15', NULL),
  (3,    2950.00, '2025-12-15', 1.4400),
  (4,    8550.00, '2025-12-15', 1.4400),
  (5,   -2180.00, '2025-12-15', NULL),
  (6,    -890.00, '2025-12-15', 1.4400),
  (7, -384500.00, '2025-12-15', NULL),
  (8,  -17950.00, '2025-12-15', NULL),
  (9,  -32300.00, '2025-12-15', 1.4400),
  -- Retirement (market dip mid-month, pension steady)
  (10,  139800.00, '2025-12-15', 1.4400),
  (11,   79800.00, '2025-12-15', NULL),
  (12,   43350.00, '2025-12-15', NULL);

-- 2026-01-01  (new year, post-holidays spending)
INSERT INTO balance_snapshots (account_id, balance, date, usd_to_cad_rate) VALUES
  -- Liquid
  (1,    3100.00, '2026-01-01', NULL),
  (2,   15500.00, '2026-01-01', NULL),
  (3,    1450.00, '2026-01-01', 1.4400),
  (4,    8600.00, '2026-01-01', 1.4400),
  (5,   -3950.00, '2026-01-01', NULL),
  (6,   -1650.00, '2026-01-01', 1.4400),
  (7, -384000.00, '2026-01-01', NULL),
  (8,  -17700.00, '2026-01-01', NULL),
  (9,  -32100.00, '2026-01-01', 1.4400),
  -- Retirement (year-end contribution posted; market recovery)
  (10,  145600.00, '2026-01-01', 1.4400),
  (11,   80400.00, '2026-01-01', NULL),
  (12,   44800.00, '2026-01-01', NULL);

-- 2026-01-15  (paycheque, paid off holiday cards)
INSERT INTO balance_snapshots (account_id, balance, date, usd_to_cad_rate) VALUES
  -- Liquid
  (1,    7200.00, '2026-01-15', NULL),
  (2,   15800.00, '2026-01-15', NULL),
  (3,    3100.00, '2026-01-15', 1.4400),
  (4,    8700.00, '2026-01-15', 1.4400),
  (5,    -780.00, '2026-01-15', NULL),
  (6,    -310.00, '2026-01-15', 1.4400),
  (7, -383500.00, '2026-01-15', NULL),
  (8,  -17450.00, '2026-01-15', NULL),
  (9,  -31900.00, '2026-01-15', 1.4400),
  -- Retirement (continued growth)
  (10,  147300.00, '2026-01-15', 1.4400),
  (11,   80900.00, '2026-01-15', NULL),
  (12,   45200.00, '2026-01-15', NULL);

-- 2026-02-01
INSERT INTO balance_snapshots (account_id, balance, date, usd_to_cad_rate) VALUES
  -- Liquid
  (1,    4900.00, '2026-02-01', NULL),
  (2,   16000.00, '2026-02-01', NULL),
  (3,    2200.00, '2026-02-01', 1.4400),
  (4,    8800.00, '2026-02-01', 1.4400),
  (5,   -1560.00, '2026-02-01', NULL),
  (6,    -540.00, '2026-02-01', 1.4400),
  (7, -383000.00, '2026-02-01', NULL),
  (8,  -17200.00, '2026-02-01', NULL),
  (9,  -31700.00, '2026-02-01', 1.4400),
  -- Retirement (small market pullback on 401k; RRSP contribution)
  (10,  146100.00, '2026-02-01', 1.4400),
  (11,   81500.00, '2026-02-01', NULL),
  (12,   46500.00, '2026-02-01', NULL);

-- 2026-02-15  (latest)
INSERT INTO balance_snapshots (account_id, balance, date, usd_to_cad_rate) VALUES
  -- Liquid
  (1,    7500.00, '2026-02-15', NULL),
  (2,   16200.00, '2026-02-15', NULL),
  (3,    3350.00, '2026-02-15', 1.4400),
  (4,    8900.00, '2026-02-15', 1.4400),
  (5,    -920.00, '2026-02-15', NULL),
  (6,    -275.00, '2026-02-15', 1.4400),
  (7, -382500.00, '2026-02-15', NULL),
  (8,  -16950.00, '2026-02-15', NULL),
  (9,  -31500.00, '2026-02-15', 1.4400),
  -- Retirement (recovery + employer match posted)
  (10,  149800.00, '2026-02-15', 1.4400),  -- ~$215,712 CAD
  (11,   82100.00, '2026-02-15', NULL),     -- CAD
  (12,   47300.00, '2026-02-15', NULL);     -- CAD
