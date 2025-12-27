-- Migration: Allow NULL balances in balance_snapshots
-- This lets us track accounts even when balance is unavailable

ALTER TABLE balance_snapshots
ALTER COLUMN balance DROP NOT NULL;

-- Verify the change
SELECT column_name, is_nullable, data_type
FROM information_schema.columns
WHERE table_name = 'balance_snapshots' AND column_name = 'balance';
