-- Adds plaid_items.sync_paused: when true, the item is skipped during Plaid
-- balance refreshes and its accounts are treated as manually-updated instead.
-- Used when an institution's Plaid connection is broken (e.g. unsupported MFA)
-- and balances must be entered by hand until the connection works again.
--
-- Apply with: psql -d balance_tracker -f db/add_sync_paused.sql

ALTER TABLE plaid_items
  ADD COLUMN IF NOT EXISTS sync_paused BOOLEAN NOT NULL DEFAULT false;
