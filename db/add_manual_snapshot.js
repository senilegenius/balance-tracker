// Script to add balance snapshots manually with current exchange rate
require('dotenv').config();
const { Pool } = require('pg');
const readline = require('readline');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(query) {
  return new Promise(resolve => rl.question(query, resolve));
}

async function addManualSnapshot() {
  try {
    // Get current exchange rate from database
    const rateResult = await pool.query(`
      SELECT rate FROM exchange_rates
      WHERE from_currency = 'USD' AND to_currency = 'CAD'
    `);

    const currentRate = rateResult.rows.length > 0 ?
      parseFloat(rateResult.rows[0].rate) : 1.40225;

    console.log(`\n📊 Add Manual Balance Snapshot`);
    console.log(`Current USD→CAD rate: ${currentRate}\n`);

    // Get list of accounts
    const accountsResult = await pool.query(`
      SELECT id, institution_name, account_name, currency, account_mask
      FROM accounts
      WHERE is_active = true
      ORDER BY institution_name, account_name
    `);

    console.log('Available accounts:');
    accountsResult.rows.forEach((acc, i) => {
      console.log(`  ${i + 1}. ${acc.institution_name} - ${acc.account_name} (${acc.currency})`);
    });

    const accountIndex = parseInt(await question('\nEnter account number: ')) - 1;
    const account = accountsResult.rows[accountIndex];

    if (!account) {
      console.log('❌ Invalid account number');
      rl.close();
      await pool.end();
      return;
    }

    const balance = await question('Enter balance: ');
    const date = await question('Enter date (YYYY-MM-DD) or press Enter for today: ');

    const snapshotDate = date.trim() || new Date().toISOString().split('T')[0];

    // Insert snapshot
    await pool.query(`
      INSERT INTO balance_snapshots (account_id, balance, date, usd_to_cad_rate)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (account_id, date)
      DO UPDATE SET balance = $2, usd_to_cad_rate = $4
    `, [account.id, parseFloat(balance), snapshotDate, currentRate]);

    console.log(`\n✅ Snapshot added successfully!`);
    console.log(`   Account: ${account.account_name}`);
    console.log(`   Balance: ${balance}`);
    console.log(`   Date: ${snapshotDate}`);
    console.log(`   Rate used: ${currentRate}\n`);

    const addMore = await question('Add another snapshot? (y/n): ');

    if (addMore.toLowerCase() === 'y') {
      await addManualSnapshot();
    } else {
      rl.close();
      await pool.end();
    }

  } catch (error) {
    console.error('❌ Error adding snapshot:', error);
    rl.close();
    await pool.end();
  }
}

addManualSnapshot();
