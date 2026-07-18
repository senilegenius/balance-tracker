-- Drop existing tables if they exist (for clean start)
DROP TABLE IF EXISTS balance_snapshots CASCADE;
DROP TABLE IF EXISTS accounts CASCADE;
DROP TABLE IF EXISTS sync_events CASCADE;
DROP TABLE IF EXISTS plaid_items CASCADE;
DROP TABLE IF EXISTS exchange_rates CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS session CASCADE;

-- Enable pgcrypto extension for encryption
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Table: users (authentication)
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(50) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Table: session (for express-session)
CREATE TABLE session (
  sid VARCHAR NOT NULL COLLATE "default",
  sess JSON NOT NULL,
  expire TIMESTAMP(6) NOT NULL,
  PRIMARY KEY (sid)
);

CREATE INDEX IDX_session_expire ON session (expire);

-- Table: plaid_items (stores access tokens for each bank connection)
CREATE TABLE plaid_items (
  id SERIAL PRIMARY KEY,
  institution_name VARCHAR(100) NOT NULL,
  plaid_item_id VARCHAR(100) UNIQUE,
  access_token_encrypted BYTEA,  -- Encrypted access token
  login_required BOOLEAN NOT NULL DEFAULT false,
  sync_paused BOOLEAN NOT NULL DEFAULT false,  -- Skip Plaid refresh; accounts updated manually
  created_at TIMESTAMP DEFAULT NOW()
);

-- Table: sync_events (audit trail of pause/resume transitions per item)
CREATE TABLE sync_events (
  id SERIAL PRIMARY KEY,
  plaid_item_id INTEGER REFERENCES plaid_items(id),
  action VARCHAR(10) NOT NULL,  -- 'paused' | 'resumed'
  created_at TIMESTAMP DEFAULT NOW()
);

-- Table: accounts (all your financial accounts)
CREATE TABLE accounts (
  id SERIAL PRIMARY KEY,
  plaid_item_id INTEGER REFERENCES plaid_items(id),
  institution_name VARCHAR(100) NOT NULL,
  account_name VARCHAR(100) NOT NULL,
  account_type VARCHAR(50) NOT NULL,  -- 'checking', 'savings', 'credit', 'liability', '401k', 'rrsp', etc.
  account_category VARCHAR(20) NOT NULL DEFAULT 'liquid', -- 'liquid' | 'retirement'
  currency VARCHAR(3) NOT NULL,        -- 'USD' or 'CAD'
  account_mask VARCHAR(10),            -- Last 4 digits
  plaid_account_id VARCHAR(100) UNIQUE,
  is_liability BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT chk_account_category CHECK (account_category IN ('liquid', 'retirement'))
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
CREATE INDEX idx_accounts_category ON accounts(account_category);
CREATE INDEX idx_sync_events_item ON sync_events(plaid_item_id);
CREATE INDEX idx_exchange_rates_currencies ON exchange_rates(from_currency, to_currency);

-- Helper functions for encrypting/decrypting access tokens
-- These will be used in your Node.js code

-- Example of how to insert encrypted data:
-- INSERT INTO plaid_items (institution_name, access_token_encrypted)
-- VALUES ('Bank Name', pgp_sym_encrypt('access-token-here', 'your-encryption-key'));

-- Example of how to read encrypted data:
-- SELECT institution_name, pgp_sym_decrypt(access_token_encrypted, 'your-encryption-key') as access_token
-- FROM plaid_items;
