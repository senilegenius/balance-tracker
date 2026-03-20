// scripts/preview_plaid_accounts.js
require('dotenv').config();
const { Configuration, PlaidApi, PlaidEnvironments } = require('plaid');
const { Pool } = require('pg');
const readline = require('readline');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const configuration = new Configuration({
  basePath: PlaidEnvironments.production,
  baseOptions: {
    headers: {
      'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID,
      'PLAID-SECRET': process.env.PLAID_SECRET,
    },
  },
});

const plaidClient = new PlaidApi(configuration);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(query) {
  return new Promise(resolve => rl.question(query, resolve));
}

async function previewAccounts() {
  try {
    console.log('🔍 Plaid Account Preview Tool\n');
    console.log('This will show you what accounts Plaid can see WITHOUT adding them to your database.\n');

    // Step 1: Create link token
    console.log('📝 Creating Plaid Link token...');
    const linkTokenResponse = await plaidClient.linkTokenCreate({
      user: { client_user_id: 'preview-user' },
      client_name: 'Balance Tracker Preview',
      products: ['transactions'],
      country_codes: ['US', 'CA'],
      language: 'en',
    });

    const linkToken = linkTokenResponse.data.link_token;
    console.log('✅ Link token created\n');

    // Step 2: Show instructions
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📱 NEXT STEPS:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('1. Open your browser and go to: http://localhost:3000/connect.html');
    console.log('2. Open the browser console (F12)');
    console.log('3. Paste this command:\n');
    console.log(`   handler.open('${linkToken}')\n`);
    console.log('4. Complete the Plaid Link flow for the institution');
    console.log('5. After success, copy the PUBLIC_TOKEN from the console');
    console.log('6. Come back here and paste it\n');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const publicToken = await question('Enter the public_token: ');

    if (!publicToken || publicToken.trim() === '') {
      console.log('❌ No token provided. Exiting.');
      process.exit(1);
    }

    console.log('\n🔄 Exchanging public token...');

    // Step 3: Exchange public token for access token
    const exchangeResponse = await plaidClient.itemPublicTokenExchange({
      public_token: publicToken.trim(),
    });

    const accessToken = exchangeResponse.data.access_token;
    const itemId = exchangeResponse.data.item_id;

    // Step 4: Get institution info
    const itemResponse = await plaidClient.itemGet({
      access_token: accessToken,
    });
    const institutionId = itemResponse.data.item.institution_id;

    const institutionResponse = await plaidClient.institutionsGetById({
      institution_id: institutionId,
      country_codes: ['US', 'CA'],
    });
    const institutionName = institutionResponse.data.institution.name;

    console.log(`✅ Connected to: ${institutionName}\n`);

    // Step 5: Get accounts
    console.log('📊 Fetching accounts...\n');
    const accountsResponse = await plaidClient.accountsGet({
      access_token: accessToken,
    });

    // Step 6: Get balances
    const balancesResponse = await plaidClient.accountsBalanceGet({
      access_token: accessToken,
    });

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`📋 ACCOUNTS FOUND AT ${institutionName.toUpperCase()}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    balancesResponse.data.accounts.forEach((account, index) => {
      const accountType = account.type;
      const subtype = account.subtype;

      // Auto-detect if this would be marked as liability
      const liabilityTypes = ['mortgage', 'loan', 'line of credit', 'credit line', 'auto loan', 'automobile loan'];
      const wouldBeLiability = liabilityTypes.includes(subtype?.toLowerCase()) ||
                               liabilityTypes.includes(accountType?.toLowerCase());

      console.log(`Account ${index + 1}:`);
      console.log(`  Name:          ${account.name}`);
      console.log(`  Type:          ${subtype || accountType}`);
      console.log(`  Currency:      ${account.balances.iso_currency_code || 'USD'}`);
      console.log(`  Mask:          ${account.mask || 'N/A'}`);
      console.log(`  Balance:       ${account.balances.current !== null ? account.balances.current : 'N/A'}`);
      console.log(`  Available:     ${account.balances.available !== null ? account.balances.available : 'N/A'}`);
      console.log(`  Would be marked as liability: ${wouldBeLiability ? '✅ YES' : '❌ NO'}`);
      console.log(`  Plaid ID:      ${account.account_id}`);
      console.log('');
    });

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Step 7: Ask if they want to add these accounts
    const addAccounts = await question('Do you want to add these accounts to your database? (yes/no): ');

    if (addAccounts.toLowerCase() === 'yes' || addAccounts.toLowerCase() === 'y') {
      console.log('\n💾 Adding accounts to database...');

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Add plaid item
        await client.query(`
          INSERT INTO plaid_items (institution_name, plaid_item_id, access_token_encrypted)
          VALUES ($1, $2, pgp_sym_encrypt($3, $4))
          ON CONFLICT (plaid_item_id)
          DO UPDATE SET access_token_encrypted = pgp_sym_encrypt($3, $4)
        `, [institutionName, itemId, accessToken, process.env.DB_ENCRYPTION_KEY]);

        // Add accounts
        for (const account of accountsResponse.data.accounts) {
          const accountType = account.type;
          const subtype = account.subtype;

          const liabilityTypes = ['mortgage', 'loan', 'line of credit', 'credit line', 'auto loan', 'automobile loan'];
          const isLiability = liabilityTypes.includes(subtype?.toLowerCase()) ||
                              liabilityTypes.includes(accountType?.toLowerCase());

          await client.query(`
            INSERT INTO accounts (
              plaid_item_id, institution_name, account_name, account_type,
              currency, account_mask, plaid_account_id, is_liability
            )
            SELECT
              pi.id, $1, $2, $3, $4, $5, $6, $7
            FROM plaid_items pi
            WHERE pi.plaid_item_id = $8
            ON CONFLICT (plaid_account_id) DO NOTHING
          `, [
            institutionName,
            account.name,
            subtype || accountType,
            account.balances.iso_currency_code || 'USD',
            account.mask,
            account.account_id,
            isLiability,
            itemId
          ]);
        }

        await client.query('COMMIT');
        console.log('✅ Accounts added successfully!');
        console.log('\n💡 Next steps:');
        console.log('   1. Check your accounts: SELECT * FROM accounts WHERE institution_name = \'' + institutionName + '\';');
        console.log('   2. Deactivate any you don\'t want: UPDATE accounts SET is_active = false WHERE id = <id>;');
        console.log('   3. Click "Refresh Balances" in the dashboard');

      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }

    } else {
      console.log('\n❌ Accounts NOT added to database.');
      console.log('💡 You can run this script again when ready.');
    }

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    if (error.response?.data) {
      console.error('Details:', error.response.data);
    }
  } finally {
    rl.close();
    await pool.end();
  }
}

previewAccounts();
