-- Migration: Standardize credit card account_type to match Plaid format
-- Changes 'credit' to 'credit card' for consistency

UPDATE accounts
SET account_type = 'credit card'
WHERE account_type = 'credit';

-- Verify the updates
SELECT id, account_name, account_type, institution_name
FROM accounts
WHERE account_type = 'credit card'
ORDER BY id;
