-- Adds plaid_items.sync_paused: when true, the item is skipped during Plaid
-- balance refreshes and its accounts are treated as manually-updated instead.
-- Used when an institution's Plaid connection is broken (e.g. unsupported MFA)
-- and balances must be entered by hand until the connection works again.
--
-- Apply with: psql -d balance_tracker -f db/add_sync_paused.sql

ALTER TABLE plaid_items
  ADD COLUMN IF NOT EXISTS sync_paused BOOLEAN NOT NULL DEFAULT false;

-- Audit trail of pause/resume transitions, so it's always possible to tell
-- when an institution was paused and which stretches of balance history were
-- manually entered vs Plaid-synced.
CREATE TABLE IF NOT EXISTS sync_events (
  id SERIAL PRIMARY KEY,
  plaid_item_id INTEGER REFERENCES plaid_items(id),
  action VARCHAR(10) NOT NULL,  -- 'paused' | 'resumed'
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sync_events_item ON sync_events(plaid_item_id);
