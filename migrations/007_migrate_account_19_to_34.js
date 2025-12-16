// migrations/007_migrate_account_19_to_34.js
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function migrate() {
  const client = await pool.connect();

  try {
    console.log('Starting migration: Migrate account 19 to 34 and deactivate 19');

    await client.query('BEGIN');

    // Step 1: Preview what we're about to do
    console.log('\n📊 Preview of changes:');

    const account19 = await client.query('SELECT * FROM accounts WHERE id = 19');
    const account34 = await client.query('SELECT * FROM accounts WHERE id = 34');

    console.log('\nAccount 19 (will be deactivated):');
    console.log(account19.rows[0]);

    console.log('\nAccount 34 (will receive snapshots):');
    console.log(account34.rows[0]);

    const snapshots19Before = await client.query(
      'SELECT COUNT(*) FROM balance_snapshots WHERE account_id = 19'
    );
    const snapshots34Before = await client.query(
      'SELECT COUNT(*) FROM balance_snapshots WHERE account_id = 34'
    );

    console.log(`\nSnapshots for account 19: ${snapshots19Before.rows[0].count}`);
    console.log(`Snapshots for account 34 (before): ${snapshots34Before.rows[0].count}`);

    // Step 2: Check for date conflicts
    console.log('\n🔍 Checking for date conflicts...');
    const conflicts = await client.query(`
      SELECT b19.date, b19.balance as bal_19, b34.balance as bal_34
      FROM balance_snapshots b19
      JOIN balance_snapshots b34 ON b19.date = b34.date
      WHERE b19.account_id = 19 AND b34.account_id = 34
    `);

    if (conflicts.rows.length > 0) {
      console.log(`\n⚠️  WARNING: Found ${conflicts.rows.length} date conflict(s):`);
      conflicts.rows.forEach(row => {
        console.log(`  Date: ${row.date}, Account 19 balance: ${row.bal_19}, Account 34 balance: ${row.bal_34}`);
      });
      console.log('\nThese snapshots from account 19 will be skipped to avoid conflicts.');
    } else {
      console.log('✅ No date conflicts found');
    }

    // Step 3: Migrate snapshots (excluding conflicts)
    console.log('\n🔄 Migrating balance snapshots from account 19 to 34...');
    const migrateResult = await client.query(`
      UPDATE balance_snapshots
      SET account_id = 34
      WHERE account_id = 19
        AND date NOT IN (
          SELECT date FROM balance_snapshots WHERE account_id = 34
        )
    `);

    console.log(`✅ Migrated ${migrateResult.rowCount} snapshots`);

    // Step 4: Delete any remaining snapshots for account 19 (conflicts)
    if (conflicts.rows.length > 0) {
      const deleteResult = await client.query(`
        DELETE FROM balance_snapshots WHERE account_id = 19
      `);
      console.log(`🗑️  Deleted ${deleteResult.rowCount} conflicting snapshots from account 19`);
    }

    // Step 5: Deactivate account 19
    console.log('\n🔒 Deactivating account 19...');
    await client.query(`
      UPDATE accounts SET is_active = false WHERE id = 19
    `);
    console.log('✅ Account 19 deactivated');

    // Step 6: Verify final state
    console.log('\n✅ Verification:');
    const snapshots19After = await client.query(
      'SELECT COUNT(*) FROM balance_snapshots WHERE account_id = 19'
    );
    const snapshots34After = await client.query(
      'SELECT COUNT(*) FROM balance_snapshots WHERE account_id = 34'
    );
    const account19Active = await client.query(
      'SELECT is_active FROM accounts WHERE id = 19'
    );

    console.log(`Snapshots for account 19 (after): ${snapshots19After.rows[0].count}`);
    console.log(`Snapshots for account 34 (after): ${snapshots34After.rows[0].count}`);
    console.log(`Account 19 is_active: ${account19Active.rows[0].is_active}`);

    const expectedTotal = parseInt(snapshots19Before.rows[0].count) +
                          parseInt(snapshots34Before.rows[0].count) -
                          conflicts.rows.length;

    console.log(`\nExpected total for account 34: ${expectedTotal}`);
    console.log(`Actual total for account 34: ${snapshots34After.rows[0].count}`);

    if (parseInt(snapshots34After.rows[0].count) === expectedTotal) {
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
