// migrations/010_add_account_category.js
//
// Adds `account_category` column to the accounts table, distinguishing
// liquid/everyday accounts (the main dashboard) from retirement accounts
// (RRSP, 401k, pension, IRA, etc.).
//
// Safe to re-run: checks for the column before applying any changes.
//
// Run against any environment:
//   DATABASE_URL=<url> node migrations/010_add_account_category.js
//   (or let it pick up DATABASE_URL from .env / environment)

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function migrate() {
  const client = await pool.connect();

  try {
    console.log('Starting migration 010: Add account_category to accounts');

    await client.query('BEGIN');

    // ── 1. Add column if missing ───────────────────────────────────────────
    const columnCheck = await client.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'accounts' AND column_name = 'account_category'
    `);

    if (columnCheck.rows.length > 0) {
      console.log('✅ Column account_category already exists — skipping column add.');
    } else {
      await client.query(`
        ALTER TABLE accounts
          ADD COLUMN account_category VARCHAR(20) NOT NULL DEFAULT 'liquid'
      `);
      console.log("✅ Added account_category column (default: 'liquid')");
    }

    // ── 2. Add CHECK constraint if missing ────────────────────────────────
    const constraintCheck = await client.query(`
      SELECT constraint_name
      FROM information_schema.table_constraints
      WHERE table_name = 'accounts' AND constraint_name = 'chk_account_category'
    `);

    if (constraintCheck.rows.length > 0) {
      console.log('✅ Constraint chk_account_category already exists — skipping.');
    } else {
      await client.query(`
        ALTER TABLE accounts
          ADD CONSTRAINT chk_account_category
          CHECK (account_category IN ('liquid', 'retirement'))
      `);
      console.log('✅ Added CHECK constraint on account_category');
    }

    // ── 3. Add index if missing ───────────────────────────────────────────
    const indexCheck = await client.query(`
      SELECT indexname
      FROM pg_indexes
      WHERE tablename = 'accounts' AND indexname = 'idx_accounts_category'
    `);

    if (indexCheck.rows.length > 0) {
      console.log('✅ Index idx_accounts_category already exists — skipping.');
    } else {
      await client.query(`
        CREATE INDEX idx_accounts_category ON accounts(account_category)
      `);
      console.log('✅ Created index idx_accounts_category');
    }

    // ── 4. Auto-fix existing Plaid accounts whose account_type matches a
    //       retirement subtype but are still categorized as 'liquid'.
    //       This corrects accounts imported before auto-classification was added.
    const retirementTypes = [
      '401k', '401a', '403b', '457b', '457',
      'ira', 'roth', 'roth 401k',
      'pension', 'retirement',
      'rrsp', 'tfsa', 'lira', 'rrif', 'resp',
    ];
    const fixResult = await client.query(`
      UPDATE accounts
      SET account_category = 'retirement'
      WHERE account_category = 'liquid'
        AND LOWER(account_type) = ANY($1::text[])
    `, [retirementTypes]);
    if (fixResult.rowCount > 0) {
      console.log(`✅ Auto-fixed ${fixResult.rowCount} existing account(s) → 'retirement'`);
    } else {
      console.log('✅ No existing accounts needed category correction.');
    }

    await client.query('COMMIT');

    // ── 5. Verify ─────────────────────────────────────────────────────────
    const verify = await client.query(`
      SELECT column_name, data_type, column_default, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'accounts' AND column_name = 'account_category'
    `);
    console.log('\nColumn details:', verify.rows[0]);

    const counts = await client.query(`
      SELECT account_category, COUNT(*) as count
      FROM accounts
      GROUP BY account_category
      ORDER BY account_category
    `);
    console.log('Current category distribution:');
    counts.rows.forEach(r => console.log(`  ${r.account_category}: ${r.count} accounts`));

    console.log('\n✅ Migration 010 completed successfully!');
    console.log('\nNEXT STEPS for each environment (sandbox, prd):');
    console.log('  1. Run this migration against the target DB before deploying server code.');
    console.log('  2. Then deploy the updated server.js (which filters by account_category).');
    console.log('  Note: existing accounts with known retirement subtypes are auto-fixed above.');

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('\n❌ Migration 010 failed:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch(console.error);
