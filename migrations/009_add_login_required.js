// migrations/009_add_login_required.js
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function migrate() {
  const client = await pool.connect();

  try {
    console.log('Starting migration: Add login_required column to plaid_items');

    await client.query('BEGIN');

    // Check if column already exists
    const check = await client.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'plaid_items' AND column_name = 'login_required'
    `);

    if (check.rows.length > 0) {
      console.log('✅ Column login_required already exists — nothing to do.');
      await client.query('ROLLBACK');
      return;
    }

    await client.query(`
      ALTER TABLE plaid_items
      ADD COLUMN login_required BOOLEAN NOT NULL DEFAULT false
    `);

    console.log('✅ Added login_required column to plaid_items');

    // Verify
    const verify = await client.query(`
      SELECT column_name, data_type, column_default
      FROM information_schema.columns
      WHERE table_name = 'plaid_items' AND column_name = 'login_required'
    `);
    console.log('Column details:', verify.rows[0]);

    await client.query('COMMIT');
    console.log('\n✅ Migration completed successfully!');

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('\n❌ Migration failed:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch(console.error);
