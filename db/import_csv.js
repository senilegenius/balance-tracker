// Script to import balance snapshots from CSV
require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const { parse } = require('csv-parse/sync');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function importCSV(filePath) {
  try {
    console.log(`\n📊 Importing snapshots from: ${filePath}\n`);

    // Read CSV file
    const fileContent = fs.readFileSync(filePath, 'utf-8');

    // Parse CSV
    const records = parse(fileContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true
    });

    console.log(`Found ${records.length} rows to process\n`);

    // Get all accounts from database for validation
    const accountsResult = await pool.query(`
      SELECT id, institution_name, account_name
      FROM accounts
    `);

    const accountsMap = {};
    accountsResult.rows.forEach(acc => {
      accountsMap[acc.id] = {
        institution_name: acc.institution_name,
        account_name: acc.account_name
      };
    });

    let inserted = 0;
    let skipped = 0;
    let validationFailed = 0;

    // Process each row
    for (let i = 0; i < records.length; i++) {
      const row = records[i];
      const rowNum = i + 2; // +2 because of header row and 0-indexing

      const accountId = parseInt(row.account_id);
      const institutionName = row.institution_name;
      const accountName = row.account_name;
      const balance = parseFloat(row.balance.replace(/,/g, '')); // Remove commas before parsing
      const usdToCadRate = parseFloat(row.usd_to_cad_rate);
      const date = row.date;

      // Validation 1: Check if account_id exists
      if (!accountsMap[accountId]) {
        console.log(`❌ Row ${rowNum}: Account ID ${accountId} not found in database. Skipped.`);
        validationFailed++;
        continue;
      }

      // Validation 2: Check if institution_name matches
      if (accountsMap[accountId].institution_name !== institutionName) {
        console.log(`❌ Row ${rowNum}: Institution name mismatch for account ${accountId}.`);
        console.log(`   Expected: "${accountsMap[accountId].institution_name}", Got: "${institutionName}". Skipped.`);
        validationFailed++;
        continue;
      }

      // Validation 3: Check if account_name matches
      if (accountsMap[accountId].account_name !== accountName) {
        console.log(`❌ Row ${rowNum}: Account name mismatch for account ${accountId}.`);
        console.log(`   Expected: "${accountsMap[accountId].account_name}", Got: "${accountName}". Skipped.`);
        validationFailed++;
        continue;
      }

      // Validation 4: Check for valid numbers
      if (isNaN(balance) || isNaN(usdToCadRate)) {
        console.log(`❌ Row ${rowNum}: Invalid balance or exchange rate. Skipped.`);
        validationFailed++;
        continue;
      }

      // Validation 5: Check for valid date format
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        console.log(`❌ Row ${rowNum}: Invalid date format "${date}". Use YYYY-MM-DD. Skipped.`);
        validationFailed++;
        continue;
      }

      // Check for duplicate (account_id + date already exists)
      const duplicateCheck = await pool.query(`
        SELECT id FROM balance_snapshots
        WHERE account_id = $1 AND date = $2
      `, [accountId, date]);

      if (duplicateCheck.rows.length > 0) {
        console.log(`⏭️  Row ${rowNum}: Snapshot for account ${accountId} on ${date} already exists. Skipped.`);
        skipped++;
        continue;
      }

      // All validations passed - insert the snapshot
      try {
        await pool.query(`
          INSERT INTO balance_snapshots (account_id, balance, date, usd_to_cad_rate)
          VALUES ($1, $2, $3, $4)
        `, [accountId, balance, date, usdToCadRate]);

        console.log(`✅ Row ${rowNum}: Inserted snapshot for ${accountName} on ${date} (${balance})`);
        inserted++;

      } catch (error) {
        console.log(`❌ Row ${rowNum}: Database error - ${error.message}. Skipped.`);
        validationFailed++;
      }
    }

    console.log(`\n📊 Import Summary:`);
    console.log(`   ✅ Inserted: ${inserted}`);
    console.log(`   ⏭️  Skipped (duplicates): ${skipped}`);
    console.log(`   ❌ Failed (validation): ${validationFailed}`);
    console.log(`   📝 Total rows processed: ${records.length}\n`);

    await pool.end();
    process.exit(0);

  } catch (error) {
    console.error('❌ Error importing CSV:', error);
    await pool.end();
    process.exit(1);
  }
}

// Get CSV file path from command line argument
const csvFilePath = process.argv[2];

if (!csvFilePath) {
  console.error('❌ Error: Please provide a CSV file path');
  console.log('\nUsage: npm run db:import-csv /path/to/snapshots.csv');
  process.exit(1);
}

if (!fs.existsSync(csvFilePath)) {
  console.error(`❌ Error: File not found: ${csvFilePath}`);
  process.exit(1);
}

importCSV(csvFilePath);
