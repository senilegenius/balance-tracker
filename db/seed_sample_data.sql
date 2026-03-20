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

-- Institutions (manual accounts, no Plaid tokens)
INSERT INTO plaid_items (institution_name) VALUES
  ('Maple Bank'),         -- id 1
  ('Eagle Credit Union'), -- id 2
  ('Cards Inc');          -- id 3

-- Accounts
INSERT INTO accounts (plaid_item_id, institution_name, account_name, account_type, currency, account_mask, is_liability, is_active) VALUES
  -- Maple Bank (CAD)
  (1, 'Maple Bank', 'Chequing',        'checking', 'CAD', '7701', false, true),   -- id 1
  (1, 'Maple Bank', 'High Interest Savings', 'savings', 'CAD', '7702', false, true),   -- id 2

  -- Eagle Credit Union (USD)
  (2, 'Eagle Credit Union', 'US Checking',  'checking', 'USD', '3301', false, true),   -- id 3
  (2, 'Eagle Credit Union', 'US Savings',   'savings',  'USD', '3302', false, true),   -- id 4

  -- Credit Cards
  (3, 'Cards Inc', 'Cashback Visa',    'credit card', 'CAD', '4411', false, true),  -- id 5
  (3, 'Cards Inc', 'Travel Rewards',   'credit card', 'USD', '4422', false, true),  -- id 6

  -- Liabilities (no plaid_item)
  (NULL, 'Liabilities', 'Mortgage',     'liability', 'CAD', NULL, true, true),  -- id 7
  (NULL, 'Liabilities', 'Car Loan',     'liability', 'CAD', NULL, true, true),  -- id 8
  (NULL, 'Liabilities', 'Student Loan', 'liability', 'USD', NULL, true, true);  -- id 9

-- Balance snapshots (~90 days, 6 dates)
-- Patterns:
--   Checking: fluctuates with paycheck/spending cycles
--   Savings: slow upward trend
--   Credit cards: negative, spend-then-pay cycles
--   Liabilities: negative, gradual decrease

-- 2025-12-01
INSERT INTO balance_snapshots (account_id, balance, date, usd_to_cad_rate) VALUES
  (1,  4250.00, '2025-12-01', NULL),
  (2, 15200.00, '2025-12-01', NULL),
  (3,  1820.50, '2025-12-01', 1.4400),
  (4,  8500.00, '2025-12-01', 1.4400),
  (5, -1340.00, '2025-12-01', NULL),
  (6,  -420.00, '2025-12-01', 1.4400),
  (7, -385000.00, '2025-12-01', NULL),
  (8, -18200.00, '2025-12-01', NULL),
  (9, -32500.00, '2025-12-01', 1.4400);

-- 2025-12-15 (post-paycheck)
INSERT INTO balance_snapshots (account_id, balance, date, usd_to_cad_rate) VALUES
  (1,  6800.00, '2025-12-15', NULL),
  (2, 15350.00, '2025-12-15', NULL),
  (3,  2950.00, '2025-12-15', 1.4400),
  (4,  8550.00, '2025-12-15', 1.4400),
  (5, -2180.00, '2025-12-15', NULL),
  (6,  -890.00, '2025-12-15', 1.4400),
  (7, -384500.00, '2025-12-15', NULL),
  (8, -17950.00, '2025-12-15', NULL),
  (9, -32300.00, '2025-12-15', 1.4400);

-- 2026-01-01 (new year, post-holidays spending)
INSERT INTO balance_snapshots (account_id, balance, date, usd_to_cad_rate) VALUES
  (1,  3100.00, '2026-01-01', NULL),
  (2, 15500.00, '2026-01-01', NULL),
  (3,  1450.00, '2026-01-01', 1.4400),
  (4,  8600.00, '2026-01-01', 1.4400),
  (5, -3950.00, '2026-01-01', NULL),
  (6, -1650.00, '2026-01-01', 1.4400),
  (7, -384000.00, '2026-01-01', NULL),
  (8, -17700.00, '2026-01-01', NULL),
  (9, -32100.00, '2026-01-01', 1.4400);

-- 2026-01-15 (paycheck, paid off holiday cards)
INSERT INTO balance_snapshots (account_id, balance, date, usd_to_cad_rate) VALUES
  (1,  7200.00, '2026-01-15', NULL),
  (2, 15800.00, '2026-01-15', NULL),
  (3,  3100.00, '2026-01-15', 1.4400),
  (4,  8700.00, '2026-01-15', 1.4400),
  (5,  -780.00, '2026-01-15', NULL),
  (6,  -310.00, '2026-01-15', 1.4400),
  (7, -383500.00, '2026-01-15', NULL),
  (8, -17450.00, '2026-01-15', NULL),
  (9, -31900.00, '2026-01-15', 1.4400);

-- 2026-02-01
INSERT INTO balance_snapshots (account_id, balance, date, usd_to_cad_rate) VALUES
  (1,  4900.00, '2026-02-01', NULL),
  (2, 16000.00, '2026-02-01', NULL),
  (3,  2200.00, '2026-02-01', 1.4400),
  (4,  8800.00, '2026-02-01', 1.4400),
  (5, -1560.00, '2026-02-01', NULL),
  (6,  -540.00, '2026-02-01', 1.4400),
  (7, -383000.00, '2026-02-01', NULL),
  (8, -17200.00, '2026-02-01', NULL),
  (9, -31700.00, '2026-02-01', 1.4400);

-- 2026-02-15 (latest)
INSERT INTO balance_snapshots (account_id, balance, date, usd_to_cad_rate) VALUES
  (1,  7500.00, '2026-02-15', NULL),
  (2, 16200.00, '2026-02-15', NULL),
  (3,  3350.00, '2026-02-15', 1.4400),
  (4,  8900.00, '2026-02-15', 1.4400),
  (5,  -920.00, '2026-02-15', NULL),
  (6,  -275.00, '2026-02-15', 1.4400),
  (7, -382500.00, '2026-02-15', NULL),
  (8, -16950.00, '2026-02-15', NULL),
  (9, -31500.00, '2026-02-15', 1.4400);
