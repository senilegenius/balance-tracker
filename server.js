// server.js with PostgreSQL integration
require('dotenv').config();

const express = require('express');
const { Configuration, PlaidApi, PlaidEnvironments } = require('plaid');
const { Pool } = require('pg');

const app = express();
app.use(express.json());
app.use(express.static('public'));

// Initialize PostgreSQL connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Test database connection
pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('❌ Database connection failed:', err);
  } else {
    console.log('✅ Database connected successfully');
  }
});

// Initialize Plaid client
const configuration = new Configuration({
  basePath: PlaidEnvironments.sandbox,
  baseOptions: {
    headers: {
      'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID,
      'PLAID-SECRET': process.env.PLAID_SECRET,
    },
  },
});

const plaidClient = new PlaidApi(configuration);

// Helper function to encrypt access token
async function encryptToken(token) {
  const result = await pool.query(
    "SELECT pgp_sym_encrypt($1, $2) as encrypted",
    [token, process.env.DB_ENCRYPTION_KEY]
  );
  return result.rows[0].encrypted;
}

// Helper function to decrypt access token
async function decryptToken(encryptedToken) {
  const result = await pool.query(
    "SELECT pgp_sym_decrypt($1, $2) as decrypted",
    [encryptedToken, process.env.DB_ENCRYPTION_KEY]
  );
  return result.rows[0].decrypted;
}

// Helper function to fetch exchange rate from external API
async function fetchExchangeRateFromAPI(fromCurrency, toCurrency) {
  try {
    // Using exchangerate-api.com (free, no API key needed for basic usage)
    const response = await fetch(`https://api.exchangerate-api.com/v4/latest/${fromCurrency}`);

    if (!response.ok) {
      throw new Error(`Exchange rate API returned ${response.status}`);
    }

    const data = await response.json();

    if (!data.rates || !data.rates[toCurrency]) {
      throw new Error(`Exchange rate for ${fromCurrency}→${toCurrency} not found`);
    }

    return parseFloat(data.rates[toCurrency]);

  } catch (error) {
    console.error('Error fetching from exchange rate API:', error);
    throw error;
  }
}

// ===========================================
// DATABASE API ENDPOINTS
// ===========================================

// Get exchange rate (with automatic refresh if stale)
app.get('/api/exchange_rate', async (req, res) => {
  try {
    const fromCurrency = req.query.from || 'USD';
    const toCurrency = req.query.to || 'CAD';

    // Get current rate from database
    const result = await pool.query(`
      SELECT rate, updated_at
      FROM exchange_rates
      WHERE from_currency = $1 AND to_currency = $2
    `, [fromCurrency, toCurrency]);

    let rate;
    let updatedAt;
    let wasRefreshed = false;

    if (result.rows.length === 0) {
      // No rate exists, fetch from API
      console.log(`No ${fromCurrency}→${toCurrency} rate found, fetching from API...`);
      rate = await fetchExchangeRateFromAPI(fromCurrency, toCurrency);
      updatedAt = new Date();
      wasRefreshed = true;

      // Save to database
      await pool.query(`
        INSERT INTO exchange_rates (from_currency, to_currency, rate, updated_at)
        VALUES ($1, $2, $3, $4)
      `, [fromCurrency, toCurrency, rate, updatedAt]);

    } else {
      rate = parseFloat(result.rows[0].rate);
      updatedAt = result.rows[0].updated_at;

      // Check if rate is stale (older than 24 hours)
      const ageInHours = (Date.now() - new Date(updatedAt).getTime()) / (1000 * 60 * 60);

      if (ageInHours > 24) {
        console.log(`${fromCurrency}→${toCurrency} rate is ${ageInHours.toFixed(1)} hours old, refreshing...`);

        try {
          // Fetch new rate from API
          const newRate = await fetchExchangeRateFromAPI(fromCurrency, toCurrency);
          rate = newRate;
          updatedAt = new Date();
          wasRefreshed = true;

          // Update database
          await pool.query(`
            UPDATE exchange_rates
            SET rate = $1, updated_at = $2
            WHERE from_currency = $3 AND to_currency = $4
          `, [rate, updatedAt, fromCurrency, toCurrency]);

        } catch (error) {
          console.error('Error refreshing exchange rate, using cached rate:', error);
          // Continue with cached rate if API fails
        }
      }
    }

    res.json({
      fromCurrency,
      toCurrency,
      rate,
      updatedAt,
      wasRefreshed
    });

  } catch (error) {
    console.error('Error getting exchange rate:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get all accounts
app.get('/api/accounts', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        id,
        institution_name,
        account_name,
        account_type,
        currency,
        account_mask,
        is_liability,
        is_active
      FROM accounts
      ORDER BY institution_name, account_name
    `);

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching accounts:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get latest balances for all active accounts
app.get('/api/latest_balances', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        a.id,
        a.institution_name,
        a.account_name,
        a.account_type,
        a.currency,
        a.account_mask,
        a.is_liability,
        b.balance,
        b.date
      FROM accounts a
      LEFT JOIN balance_snapshots b ON a.id = b.account_id
      WHERE a.is_active = true
        AND b.date = (
          SELECT MAX(date)
          FROM balance_snapshots
          WHERE account_id = a.id
        )
      ORDER BY a.institution_name, a.account_name
    `);

    res.json({
      accounts: result.rows,
      date: result.rows.length > 0 ? result.rows[0].date : null
    });
  } catch (error) {
    console.error('Error fetching latest balances:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get historical balances for charts
app.get('/api/historical_balances', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        b.date,
        a.id as account_id,
        a.account_name,
        a.currency,
        a.is_liability,
        b.balance
      FROM balance_snapshots b
      JOIN accounts a ON b.account_id = a.id
      WHERE a.is_active = true
      ORDER BY b.date, a.id
    `);

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching historical balances:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get summary calculations
app.get('/api/summary', async (req, res) => {
  try {
    // Get exchange rate from database
    const exchangeRateResult = await pool.query(`
      SELECT rate FROM exchange_rates
      WHERE from_currency = 'USD' AND to_currency = 'CAD'
    `);

    if (exchangeRateResult.rows.length === 0) {
      return res.status(500).json({
        error: 'Exchange rate not found. Please ensure exchange_rates table is populated.'
      });
    }

    const usdToCad = parseFloat(exchangeRateResult.rows[0].rate);

    // Get the latest date
    const latestDateResult = await pool.query(`
      SELECT MAX(date) as latest_date FROM balance_snapshots
    `);
    const latestDate = latestDateResult.rows[0].latest_date;

    // Get previous date for comparison
    const previousDateResult = await pool.query(`
      SELECT MAX(date) as previous_date
      FROM balance_snapshots
      WHERE date < $1
    `, [latestDate]);
    const previousDate = previousDateResult.rows[0].previous_date;

    // Calculate totals for latest date
    const currentTotals = await pool.query(`
      SELECT
        SUM(CASE WHEN a.currency = 'CAD' AND a.is_liability = false AND a.account_type != 'credit' THEN b.balance ELSE 0 END) as total_cad,
        SUM(CASE WHEN a.currency = 'USD' AND a.is_liability = false AND a.account_type != 'credit' THEN b.balance ELSE 0 END) as total_usd,
        SUM(CASE WHEN a.currency = 'CAD' AND a.account_type = 'credit' THEN b.balance ELSE 0 END) as cc_debt_cad,
        SUM(CASE WHEN a.currency = 'USD' AND a.account_type = 'credit' THEN b.balance ELSE 0 END) as cc_debt_usd
      FROM balance_snapshots b
      JOIN accounts a ON b.account_id = a.id
      WHERE b.date = $1 AND a.is_active = true
    `, [latestDate]);

    // Calculate totals for previous date
    const previousTotals = await pool.query(`
      SELECT
        SUM(CASE WHEN a.currency = 'CAD' AND a.is_liability = false AND a.account_type != 'credit' THEN b.balance ELSE 0 END) as total_cad,
        SUM(CASE WHEN a.currency = 'USD' AND a.is_liability = false AND a.account_type != 'credit' THEN b.balance ELSE 0 END) as total_usd,
        SUM(CASE WHEN a.currency = 'CAD' AND a.account_type = 'credit' THEN b.balance ELSE 0 END) as cc_debt_cad,
        SUM(CASE WHEN a.currency = 'USD' AND a.account_type = 'credit' THEN b.balance ELSE 0 END) as cc_debt_usd
      FROM balance_snapshots b
      JOIN accounts a ON b.account_id = a.id
      WHERE b.date = $1 AND a.is_active = true
    `, [previousDate]);

    const current = currentTotals.rows[0];
    const previous = previousTotals.rows[0];

    // Calculate liquid cash (all assets minus CC debt, converted to CAD)
    const currentLiquidCad =
      parseFloat(current.total_cad) +
      (parseFloat(current.total_usd) * usdToCad) -
      Math.abs(parseFloat(current.cc_debt_cad)) -
      (Math.abs(parseFloat(current.cc_debt_usd)) * usdToCad);

    const previousLiquidCad = previous.total_cad !== null ?
      parseFloat(previous.total_cad) +
      (parseFloat(previous.total_usd) * usdToCad) -
      Math.abs(parseFloat(previous.cc_debt_cad)) -
      (Math.abs(parseFloat(previous.cc_debt_usd)) * usdToCad) : null;

    const liquidChange = previousLiquidCad !== null ?
      currentLiquidCad - previousLiquidCad : 0;

    res.json({
      date: latestDate,
      previousDate: previousDate,
      usdToCadRate: usdToCad,
      totalCad: parseFloat(current.total_cad),
      totalUsd: parseFloat(current.total_usd),
      ccDebtCad: Math.abs(parseFloat(current.cc_debt_cad)),
      ccDebtUsd: Math.abs(parseFloat(current.cc_debt_usd)),
      liquidCashCad: currentLiquidCad,
      liquidChange: liquidChange,
      previousTotalCad: previous.total_cad !== null ? parseFloat(previous.total_cad) : null,
      previousTotalUsd: previous.total_usd !== null ? parseFloat(previous.total_usd) : null,
      previousCcDebtCad: previous.cc_debt_cad !== null ? Math.abs(parseFloat(previous.cc_debt_cad)) : null,
      previousCcDebtUsd: previous.cc_debt_usd !== null ? Math.abs(parseFloat(previous.cc_debt_usd)) : null,
    });
  } catch (error) {
    console.error('Error calculating summary:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get balance history for trend chart
app.get('/api/trend_data', async (req, res) => {
  try {
    // Get exchange rate from database
    const exchangeRateResult = await pool.query(`
      SELECT rate FROM exchange_rates
      WHERE from_currency = 'USD' AND to_currency = 'CAD'
    `);

    if (exchangeRateResult.rows.length === 0) {
      return res.status(500).json({
        error: 'Exchange rate not found. Please ensure exchange_rates table is populated.'
      });
    }

    const usdToCad = parseFloat(exchangeRateResult.rows[0].rate);

    const result = await pool.query(`
      WITH daily_totals AS (
        SELECT
          b.date,
          SUM(CASE WHEN a.currency = 'CAD' AND a.is_liability = false AND a.account_type != 'credit' THEN b.balance ELSE 0 END) as total_cad,
          SUM(CASE WHEN a.currency = 'USD' AND a.is_liability = false AND a.account_type != 'credit' THEN b.balance ELSE 0 END) as total_usd,
          SUM(CASE WHEN a.currency = 'CAD' AND a.account_type = 'credit' THEN b.balance ELSE 0 END) as cc_debt_cad,
          SUM(CASE WHEN a.currency = 'USD' AND a.account_type = 'credit' THEN b.balance ELSE 0 END) as cc_debt_usd
        FROM balance_snapshots b
        JOIN accounts a ON b.account_id = a.id
        WHERE a.is_active = true
        GROUP BY b.date
        ORDER BY b.date
      )
      SELECT
        date,
        total_cad + (total_usd * $1) - ABS(cc_debt_cad) - (ABS(cc_debt_usd) * $1) as liquid_cash_cad
      FROM daily_totals
      ORDER BY date
    `, [usdToCad]);

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching trend data:', error);
    res.status(500).json({ error: error.message });
  }
});

// ===========================================
// PLAID API ENDPOINTS (Keep existing ones)
// ===========================================

// Create a link token - needed to initialize Plaid Link
app.post('/api/create_link_token', async (req, res) => {
  try {
    const response = await plaidClient.linkTokenCreate({
      user: { client_user_id: 'user-1' },
      client_name: 'Balance Tracker',
      products: ['transactions'],
      country_codes: ['US'],
      language: 'en',
    });
    res.json({ link_token: response.data.link_token });
  } catch (error) {
    console.error('Error creating link token:', error);
    res.status(500).json({ error: error.message });
  }
});

// Exchange public token for access token and save to database
app.post('/api/exchange_public_token', async (req, res) => {
  const { public_token } = req.body;

  try {
    // Exchange token with Plaid
    const response = await plaidClient.itemPublicTokenExchange({
      public_token: public_token,
    });

    const accessToken = response.data.access_token;
    const itemId = response.data.item_id;

    // Get institution info
    const itemResponse = await plaidClient.itemGet({
      access_token: accessToken,
    });
    const institutionId = itemResponse.data.item.institution_id;

    // Get institution name
    const institutionResponse = await plaidClient.institutionsGetById({
      institution_id: institutionId,
      country_codes: ['US'],
    });
    const institutionName = institutionResponse.data.institution.name;

    // Encrypt and save to database
    const encryptedToken = await encryptToken(accessToken);

    await pool.query(`
      INSERT INTO plaid_items (institution_name, plaid_item_id, access_token_encrypted)
      VALUES ($1, $2, $3)
      ON CONFLICT (plaid_item_id)
      DO UPDATE SET access_token_encrypted = $3
    `, [institutionName, itemId, encryptedToken]);

    // Get accounts and save them
    const accountsResponse = await plaidClient.accountsGet({
      access_token: accessToken,
    });

    for (const account of accountsResponse.data.accounts) {
      const accountType = account.type; // 'depository', 'credit', etc.
      const subtype = account.subtype; // 'checking', 'savings', 'credit card', etc.

      await pool.query(`
        INSERT INTO accounts (
          plaid_item_id, institution_name, account_name, account_type,
          currency, account_mask, plaid_account_id, is_liability
        )
        SELECT
          pi.id, $1, $2, $3, $4, $5, $6, false
        FROM plaid_items pi
        WHERE pi.plaid_item_id = $7
        ON CONFLICT (plaid_account_id) DO NOTHING
      `, [
        institutionName,
        account.name,
        subtype || accountType,
        account.balances.iso_currency_code || 'USD',
        account.mask,
        account.account_id,
        itemId
      ]);
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error exchanging token:', error);
    res.status(500).json({ error: error.message });
  }
});

// Refresh balances from Plaid and save to database
app.post('/api/refresh_balances', async (req, res) => {
  try {
    // Get all Plaid items
    const itemsResult = await pool.query(`
      SELECT id, plaid_item_id, access_token_encrypted
      FROM plaid_items
      WHERE access_token_encrypted IS NOT NULL
    `);

    const today = new Date().toISOString().split('T')[0];
    let accountsUpdated = 0;

    for (const item of itemsResult.rows) {
      try {
        // Decrypt access token
        const accessToken = await decryptToken(item.access_token_encrypted);

        // Fetch balances from Plaid
        const balancesResponse = await plaidClient.accountsBalanceGet({
          access_token: accessToken,
        });

        // Save each balance
        for (const account of balancesResponse.data.accounts) {
          const accountResult = await pool.query(`
            SELECT id FROM accounts WHERE plaid_account_id = $1
          `, [account.account_id]);

          if (accountResult.rows.length > 0) {
            const accountId = accountResult.rows[0].id;

            await pool.query(`
              INSERT INTO balance_snapshots (account_id, balance, date)
              VALUES ($1, $2, $3)
              ON CONFLICT (account_id, date)
              DO UPDATE SET balance = $2
            `, [accountId, account.balances.current, today]);

            accountsUpdated++;
          }
        }
      } catch (error) {
        console.error(`Error refreshing item ${item.plaid_item_id}:`, error);
      }
    }

    res.json({
      success: true,
      accountsUpdated: accountsUpdated,
      date: today
    });
  } catch (error) {
    console.error('Error refreshing balances:', error);
    res.status(500).json({ error: error.message });
  }
});

// ===========================================
// SERVER START
// ===========================================

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
  console.log('\n📊 Available endpoints:');
  console.log('   GET  /api/exchange_rate - Get USD/CAD exchange rate');
  console.log('   GET  /api/accounts - List all accounts');
  console.log('   GET  /api/latest_balances - Current balances');
  console.log('   GET  /api/historical_balances - All balance history');
  console.log('   GET  /api/summary - Calculated summary');
  console.log('   GET  /api/trend_data - Data for trend chart');
  console.log('   POST /api/refresh_balances - Update from Plaid\n');
});
