-- Migration: Add usd_to_cad_rate to balance_snapshots
-- This allows each snapshot to have its own exchange rate

-- Add the column
ALTER TABLE balance_snapshots
ADD COLUMN IF NOT EXISTS usd_to_cad_rate DECIMAL(10, 6);

-- Backfill existing snapshots with the current exchange rate
UPDATE balance_snapshots
SET usd_to_cad_rate = (
  SELECT rate FROM exchange_rates
  WHERE from_currency = 'USD' AND to_currency = 'CAD'
)
WHERE usd_to_cad_rate IS NULL;

-- Verify the migration
SELECT COUNT(*) as total_snapshots,
       COUNT(usd_to_cad_rate) as snapshots_with_rate
FROM balance_snapshots;
