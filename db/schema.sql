-- Drop existing tables if they exist (for clean start)
DROP TABLE IF EXISTS balance_snapshots CASCADE;
DROP TABLE IF EXISTS accounts CASCADE;
DROP TABLE IF EXISTS plaid_items CASCADE;
DROP TABLE IF EXISTS exchange_rates CASCADE;

-- Enable pgcrypto extension for encryption
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Table: plaid_items (stores access tokens for each bank connection)
CREATE TABLE plaid_items (
  id SERIAL PRIMARY KEY,
  institution_name VARCHAR(100) NOT NULL,
  plaid_item_id VARCHAR(100) UNIQUE,
  access_token_encrypted BYTEA,  -- Encrypted access token
  created_at TIMESTAMP DEFAULT NOW()
);

-- Table: accounts (all your financial accounts)
CREATE TABLE accounts (
  id SERIAL PRIMARY KEY,
  plaid_item_id INTEGER REFERENCES plaid_items(id),
  institution_name VARCHAR(100) NOT NULL,
  account_name VARCHAR(100) NOT NULL,
  account_type VARCHAR(50) NOT NULL,  -- 'checking', 'savings', 'credit', 'liability'
  currency VARCHAR(3) NOT NULL,        -- 'USD' or 'CAD'
  account_mask VARCHAR(10),            -- Last 4 digits
  plaid_account_id VARCHAR(100) UNIQUE,
  is_liability BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Table: balance_snapshots (historical balance data)
CREATE TABLE balance_snapshots (
  id SERIAL PRIMARY KEY,
  account_id INTEGER REFERENCES accounts(id) ON DELETE CASCADE,
  balance DECIMAL(15, 2),  -- NULL allowed for accounts where balance is unavailable
  date DATE NOT NULL,
  usd_to_cad_rate DECIMAL(10, 6),  -- Exchange rate at time of snapshot
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(account_id, date)  -- Only one snapshot per account per day
);

-- Table: exchange_rates (currency conversion rates)
CREATE TABLE exchange_rates (
  id SERIAL PRIMARY KEY,
  from_currency VARCHAR(3) NOT NULL,
  to_currency VARCHAR(3) NOT NULL,
  rate DECIMAL(10, 6) NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(from_currency, to_currency)
);

-- Create indexes for better query performance
CREATE INDEX idx_balance_snapshots_account_date ON balance_snapshots(account_id, date);
CREATE INDEX idx_accounts_institution ON accounts(institution_name);
CREATE INDEX idx_accounts_active ON accounts(is_active);
CREATE INDEX idx_exchange_rates_currencies ON exchange_rates(from_currency, to_currency);

-- Helper functions for encrypting/decrypting access tokens
-- These will be used in your Node.js code

-- Example of how to insert encrypted data:
-- INSERT INTO plaid_items (institution_name, access_token_encrypted)
-- VALUES ('Bank Name', pgp_sym_encrypt('access-token-here', 'your-encryption-key'));

-- Example of how to read encrypted data:
-- SELECT institution_name, pgp_sym_decrypt(access_token_encrypted, 'your-encryption-key') as access_token
-- FROM plaid_items;
