// Database helpers for tests: truncate tables and seed known fixtures.
// Uses its own pool (same connection string as the app) so tests can
// close it independently of the app's pool.
const { Pool } = require('pg');
const bcrypt = require('bcrypt');

const TEST_USER = { username: 'testuser', password: 'correct-horse-battery-staple' };

function createPool() {
  return new Pool({ connectionString: process.env.DATABASE_URL });
}

async function truncateAll(pool) {
  await pool.query(`
    TRUNCATE balance_snapshots, accounts, plaid_items, exchange_rates, users, session
    RESTART IDENTITY CASCADE
  `);
}

async function seedUser(pool, { username, password } = TEST_USER) {
  const hash = await bcrypt.hash(password, 10);
  const result = await pool.query(
    'INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id',
    [username, hash]
  );
  return result.rows[0].id;
}

// updated_at defaults to NOW() so the app treats the rate as fresh and
// never calls the external exchange-rate API during tests.
async function seedExchangeRate(pool, rate = 1.35) {
  await pool.query(
    `INSERT INTO exchange_rates (from_currency, to_currency, rate, updated_at)
     VALUES ('USD', 'CAD', $1, NOW())
     ON CONFLICT (from_currency, to_currency) DO UPDATE SET rate = $1, updated_at = NOW()`,
    [rate]
  );
}

async function seedAccount(pool, {
  institution = 'Test Bank',
  name,
  type = 'chequing',
  category = 'liquid',
  currency = 'CAD',
  isLiability = false,
  isActive = true,
  plaidAccountId = null,
}) {
  const result = await pool.query(
    `INSERT INTO accounts
       (institution_name, account_name, account_type, account_category,
        currency, is_liability, is_active, plaid_account_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [institution, name, type, category, currency, isLiability, isActive, plaidAccountId]
  );
  return result.rows[0].id;
}

async function seedSnapshot(pool, accountId, balance, date, rate = 1.35) {
  await pool.query(
    `INSERT INTO balance_snapshots (account_id, balance, date, usd_to_cad_rate)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (account_id, date) DO UPDATE SET balance = $2, usd_to_cad_rate = $4`,
    [accountId, balance, date, rate]
  );
}

// Matches how server.js computes "today" (new Date().toLocaleDateString('en-CA'))
function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toLocaleDateString('en-CA');
}

module.exports = {
  TEST_USER,
  createPool,
  truncateAll,
  seedUser,
  seedExchangeRate,
  seedAccount,
  seedSnapshot,
  daysAgo,
};
