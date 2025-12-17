// migrations/008_migrate_account_11_to_35.js
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function migrate() {
  const client = await pool.connect();

  try {
    console.log('Starting migration: Migrate account 11 to 35 and deactivate 11');

    await client.query('BEGIN');

    // Step 1: Preview what we're about to do
    console.log('\n📊 Preview of changes:');

    const account11 = await client.query('SELECT * FROM accounts WHERE id = 11');
    const account35 = await client.query('SELECT * FROM accounts WHERE id = 35');

    console.log('\nAccount 11 (will be deactivated):');
    console.log(account11.rows[0]);

    console.log('\nAccount 35 (will receive snapshots):');
    console.log(account35.rows[0]);

    const snapshots11Before = await client.query(
      'SELECT COUNT(*) FROM balance_snapshots WHERE account_id = 11'
    );
    const snapshots35Before = await client.query(
      'SELECT COUNT(*) FROM balance_snapshots WHERE account_id = 35'
    );

    console.log(`\nSnapshots for account 11: ${snapshots11Before.rows[0].count}`);
    console.log(`Snapshots for account 35 (before): ${snapshots35Before.rows[0].count}`);

    // Step 2: Check for date conflicts
    console.log('\n🔍 Checking for date conflicts...');
    const conflicts = await client.query(`
      SELECT b11.date, b11.balance as bal_11, b35.balance as bal_35
      FROM balance_snapshots b11
      JOIN balance_snapshots b35 ON b11.date = b35.date
      WHERE b11.account_id = 11 AND b35.account_id = 35
    `);

    if (conflicts.rows.length > 0) {
      console.log(`\n⚠️  WARNING: Found ${conflicts.rows.length} date conflict(s):`);
      conflicts.rows.forEach(row => {
        console.log(`  Date: ${row.date}, Account 11 balance: ${row.bal_11}, Account 35 balance: ${row.bal_35}`);
      });
      console.log('\nThese snapshots from account 11 will be skipped to avoid conflicts.');
    } else {
      console.log('✅ No date conflicts found');
    }

    // Step 3: Migrate snapshots (excluding conflicts)
    console.log('\n🔄 Migrating balance snapshots from account 11 to 35...');
    const migrateResult = await client.query(`
      UPDATE balance_snapshots
      SET account_id = 35
      WHERE account_id = 11
        AND date NOT IN (
          SELECT date FROM balance_snapshots WHERE account_id = 35
        )
    `);

    console.log(`✅ Migrated ${migrateResult.rowCount} snapshots`);

    // Step 4: Delete any remaining snapshots for account 11 (conflicts)
    if (conflicts.rows.length > 0) {
      const deleteResult = await client.query(`
        DELETE FROM balance_snapshots WHERE account_id = 11
      `);
      console.log(`🗑️  Deleted ${deleteResult.rowCount} conflicting snapshots from account 11`);
    }

    // Step 5: Deactivate account 11
    console.log('\n🔒 Deactivating account 11...');
    await client.query(`
      UPDATE accounts SET is_active = false WHERE id = 11
    `);
    console.log('✅ Account 11 deactivated');

    // Step 6: Verify final state
    console.log('\n✅ Verification:');
    const snapshots11After = await client.query(
      'SELECT COUNT(*) FROM balance_snapshots WHERE account_id = 11'
    );
    const snapshots35After = await client.query(
      'SELECT COUNT(*) FROM balance_snapshots WHERE account_id = 35'
    );
    const account11Active = await client.query(
      'SELECT is_active FROM accounts WHERE id = 11'
    );

    console.log(`Snapshots for account 11 (after): ${snapshots11After.rows[0].count}`);
    console.log(`Snapshots for account 35 (after): ${snapshots35After.rows[0].count}`);
    console.log(`Account 11 is_active: ${account11Active.rows[0].is_active}`);

    const expectedTotal = parseInt(snapshots11Before.rows[0].count) +
                          parseInt(snapshots35Before.rows[0].count) -
                          conflicts.rows.length;

    console.log(`\nExpected total for account 35: ${expectedTotal}`);
    console.log(`Actual total for account 35: ${snapshots35After.rows[0].count}`);

    if (parseInt(snapshots35After.rows[0].count) === expectedTotal) {
      console.log('✅ Snapshot counts match!');
    } else {
      throw new Error('Snapshot count mismatch!');
    }

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
