-- Enable Row Level Security on all tables
-- This prevents access via Supabase's anonymous API while maintaining
-- full access for the postgres user (used by the application)

-- Enable RLS on all tables
ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE balance_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE exchange_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE plaid_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE session ENABLE ROW LEVEL SECURITY;

-- Create policies that allow postgres user full access
-- The postgres user is what the application uses for direct database connections
-- This ensures the app continues to work exactly as before

CREATE POLICY "Allow postgres full access" ON accounts
  FOR ALL
  TO postgres
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow postgres full access" ON balance_snapshots
  FOR ALL
  TO postgres
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow postgres full access" ON exchange_rates
  FOR ALL
  TO postgres
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow postgres full access" ON plaid_items
  FOR ALL
  TO postgres
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow postgres full access" ON users
  FOR ALL
  TO postgres
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow postgres full access" ON session
  FOR ALL
  TO postgres
  USING (true)
  WITH CHECK (true);
