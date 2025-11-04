-- Migration: Add exchange_rates table
-- This stores currency exchange rates with timestamps

CREATE TABLE IF NOT EXISTS exchange_rates (
  id SERIAL PRIMARY KEY,
  from_currency VARCHAR(3) NOT NULL,
  to_currency VARCHAR(3) NOT NULL,
  rate DECIMAL(10, 6) NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(from_currency, to_currency)
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_exchange_rates_currencies
ON exchange_rates(from_currency, to_currency);

-- Insert initial USD to CAD rate
INSERT INTO exchange_rates (from_currency, to_currency, rate, updated_at)
VALUES ('USD', 'CAD', 1.40225, NOW())
ON CONFLICT (from_currency, to_currency)
DO UPDATE SET rate = EXCLUDED.rate, updated_at = NOW();

-- Verify it was inserted
SELECT * FROM exchange_rates;