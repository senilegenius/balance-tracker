// server.js with PostgreSQL integration
require('dotenv').config();

const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const bcrypt = require('bcrypt');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cors = require('cors');
const { Configuration, PlaidApi, PlaidEnvironments } = require('plaid');
const { Pool } = require('pg');

const app = express();

// Trust proxy - required for Render, Azure, and other cloud platforms
// This allows Express to correctly identify client IPs from X-Forwarded-* headers
app.set('trust proxy', 1);

// Security: Helmet for security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"], // Inline styles in HTML
      scriptSrc: ["'self'", "https://cdn.jsdelivr.net", "https://cdn.plaid.com"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https://api.exchangerate-api.com", "https://production.plaid.com", "https://cdn.jsdelivr.net"],
      frameSrc: ["https://cdn.plaid.com"]
    }
  }
}));

// Security: CORS - only allow your domain(s)
const allowedOrigins = process.env.NODE_ENV === 'production'
  ? (process.env.ALLOWED_ORIGIN || '').split(',').map(origin => origin.trim()).filter(Boolean)
  : ['http://localhost:3000'];

app.use(cors({
  origin: function(origin, callback) {
    // Allow requests with no origin (mobile apps, curl, server-to-server)
    if (!origin) return callback(null, true);

    // Check if origin is in allowed list
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));

// Security: Force HTTPS in production
if (process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    if (req.header('x-forwarded-proto') !== 'https') {
      res.redirect(`https://${req.header('host')}${req.url}`);
    } else {
      next();
    }
  });
}

app.use(express.json());

// Initialize PostgreSQL connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Configure session middleware
app.use(session({
  store: new pgSession({
    pool: pool,
    tableName: 'session',
    createTableIfMissing: true
  }),
  secret: process.env.SESSION_SECRET || 'session-secret-key-change-this',
  resave: false,
  saveUninitialized: false,
  rolling: true, // Reset expiration on every request (idle timeout)
  cookie: {
    maxAge: 25 * 60 * 1000, // 25 minutes of inactivity
    httpOnly: true, // Prevent JavaScript access
    secure: process.env.NODE_ENV === 'production', // HTTPS only in production
    sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax'
  }
}));

// Protect HTML pages before serving static files
app.get('/', requireAuthPage);
app.get('/index.html', requireAuthPage);
app.get('/connect.html', requireAuthPage);

// Serve static files
app.use(express.static('public'));

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
  basePath: PlaidEnvironments.production,
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
// AUTHENTICATION MIDDLEWARE
// ===========================================

// Middleware to check if user is authenticated
function requireAuth(req, res, next) {
  if (req.session && req.session.userId) {
    // User is authenticated
    return next();
  }

  // Not authenticated - return 401 for API calls
  return res.status(401).json({ error: 'Unauthorized. Please login.' });
}

// Middleware to redirect unauthenticated users to login for HTML pages
function requireAuthPage(req, res, next) {
  if (req.session && req.session.userId) {
    return next();
  }

  // Redirect to login page
  return res.redirect('/login.html');
}

// ===========================================
// AUTHENTICATION ENDPOINTS
// ===========================================

// Security: Rate limiting for login endpoint
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts per window
  message: 'Too many login attempts, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
});

// Login endpoint
app.post('/api/login', loginLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    // Get user from database
    const result = await pool.query(`
      SELECT id, username, password_hash
      FROM users
      WHERE username = $1
    `, [username]);

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const user = result.rows[0];

    // Compare password with hash
    const isValid = await bcrypt.compare(password, user.password_hash);

    if (!isValid) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    // Set session
    req.session.userId = user.id;
    req.session.username = user.username;

    res.json({ success: true, username: user.username });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'An error occurred during login' });
  }
});

// Logout endpoint
app.post('/api/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) {
      return res.status(500).json({ error: 'Error logging out' });
    }
    res.json({ success: true });
  });
});

// Check if user is logged in
app.get('/api/check-auth', (req, res) => {
  if (req.session && req.session.userId) {
    res.json({ authenticated: true, username: req.session.username });
  } else {
    res.json({ authenticated: false });
  }
});

// ===========================================
// DATABASE API ENDPOINTS
// ===========================================

// Apply authentication to all API endpoints below
app.use('/api/', requireAuth);

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

// Get manual accounts (accounts without plaid_account_id) with their last balances
app.get('/api/manual_accounts', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        a.id,
        a.account_name,
        a.currency,
        a.account_type,
        a.is_liability,
        (
          SELECT b.balance
          FROM balance_snapshots b
          WHERE b.account_id = a.id
          ORDER BY b.date DESC
          LIMIT 1
        ) as last_balance
      FROM accounts a
      WHERE a.plaid_account_id IS NULL
        AND a.is_active = true
      ORDER BY a.institution_name, a.account_name
    `);

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching manual accounts:', error);
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
        AND b.balance IS NOT NULL
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
    // Calculate totals using each account's most recent snapshot
    const currentTotals = await pool.query(`
      SELECT
        SUM(CASE WHEN a.currency = 'CAD' AND a.is_liability = false AND a.account_type != 'credit' AND a.account_type != 'credit card' THEN b.balance ELSE 0 END) as total_cad,
        SUM(CASE WHEN a.currency = 'USD' AND a.is_liability = false AND a.account_type != 'credit' AND a.account_type != 'credit card' THEN b.balance ELSE 0 END) as total_usd,
        SUM(CASE WHEN a.currency = 'CAD' AND (a.account_type = 'credit' OR a.account_type = 'credit card') THEN b.balance ELSE 0 END) as cc_debt_cad,
        SUM(CASE WHEN a.currency = 'USD' AND (a.account_type = 'credit' OR a.account_type = 'credit card') THEN b.balance ELSE 0 END) as cc_debt_usd,
        MAX(b.date) as latest_date,
        MAX(b.usd_to_cad_rate) as current_rate
      FROM balance_snapshots b
      JOIN accounts a ON b.account_id = a.id
      WHERE a.is_active = true
        AND b.date = (
          SELECT MAX(date)
          FROM balance_snapshots
          WHERE account_id = a.id
        )
    `);

    // Get the previous snapshot date for comparison (second most recent across all accounts)
    const previousDateResult = await pool.query(`
      SELECT DISTINCT date
      FROM balance_snapshots
      ORDER BY date DESC
      LIMIT 1 OFFSET 1
    `);

    const latestDate = currentTotals.rows[0].latest_date;
    const currentRate = parseFloat(currentTotals.rows[0].current_rate);
    const previousDate = previousDateResult.rows.length > 0 ? previousDateResult.rows[0].date : null;

    // Calculate totals for previous date (if exists)
    let previousTotals = null;
    let previousRate = currentRate;

    if (previousDate) {
      previousTotals = await pool.query(`
        SELECT
          SUM(CASE WHEN a.currency = 'CAD' AND a.is_liability = false AND a.account_type != 'credit' AND a.account_type != 'credit card' THEN b.balance ELSE 0 END) as total_cad,
          SUM(CASE WHEN a.currency = 'USD' AND a.is_liability = false AND a.account_type != 'credit' AND a.account_type != 'credit card' THEN b.balance ELSE 0 END) as total_usd,
          SUM(CASE WHEN a.currency = 'CAD' AND (a.account_type = 'credit' OR a.account_type = 'credit card') THEN b.balance ELSE 0 END) as cc_debt_cad,
          SUM(CASE WHEN a.currency = 'USD' AND (a.account_type = 'credit' OR a.account_type = 'credit card') THEN b.balance ELSE 0 END) as cc_debt_usd,
          MAX(b.usd_to_cad_rate) as rate
        FROM balance_snapshots b
        JOIN accounts a ON b.account_id = a.id
        WHERE a.is_active = true
          AND b.date = $1
      `, [previousDate]);

      previousRate = parseFloat(previousTotals.rows[0].rate);
    }

    const current = currentTotals.rows[0];
    const previous = previousTotals ? previousTotals.rows[0] : null;

    // Calculate liquid cash using the rate from each snapshot
    const currentLiquidCad =
      parseFloat(current.total_cad) +
      (parseFloat(current.total_usd) * currentRate) -
      Math.abs(parseFloat(current.cc_debt_cad)) -
      (Math.abs(parseFloat(current.cc_debt_usd)) * currentRate);

    const previousLiquidCad = previous && previous.total_cad !== null ?
      parseFloat(previous.total_cad) +
      (parseFloat(previous.total_usd) * previousRate) -
      Math.abs(parseFloat(previous.cc_debt_cad)) -
      (Math.abs(parseFloat(previous.cc_debt_usd)) * previousRate) : null;

    const liquidChange = previousLiquidCad !== null ?
      currentLiquidCad - previousLiquidCad : 0;

    res.json({
      date: latestDate,
      previousDate: previousDate,
      usdToCadRate: currentRate,
      totalCad: parseFloat(current.total_cad),
      totalUsd: parseFloat(current.total_usd),
      ccDebtCad: Math.abs(parseFloat(current.cc_debt_cad)),
      ccDebtUsd: Math.abs(parseFloat(current.cc_debt_usd)),
      liquidCashCad: currentLiquidCad,
      liquidChange: liquidChange,
      previousTotalCad: previous && previous.total_cad !== null ? parseFloat(previous.total_cad) : null,
      previousTotalUsd: previous && previous.total_usd !== null ? parseFloat(previous.total_usd) : null,
      previousCcDebtCad: previous && previous.cc_debt_cad !== null ? Math.abs(parseFloat(previous.cc_debt_cad)) : null,
      previousCcDebtUsd: previous && previous.cc_debt_usd !== null ? Math.abs(parseFloat(previous.cc_debt_usd)) : null,
    });
  } catch (error) {
    console.error('Error calculating summary:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get balance history for trend chart
app.get('/api/trend_data', async (req, res) => {
  try {
    const granularity = req.query.granularity || 'daily';

    // Step 1: Generate complete daily series with carried-forward balances
    const dailyResult = await pool.query(`
      WITH
      -- Get the date range
      date_range AS (
        SELECT
          MIN(date) as first_date,
          CURRENT_DATE as last_date
        FROM balance_snapshots
      ),

      -- Generate ALL calendar days from first snapshot to today
      all_calendar_days AS (
        SELECT date::date as date
        FROM date_range,
             generate_series(first_date, last_date, '1 day'::interval) as date
      ),

      -- For each (day, account), carry forward the most recent balance
      daily_account_balances AS (
        SELECT
          d.date,
          a.id as account_id,
          a.currency,
          a.is_liability,
          a.account_type,
          (
            SELECT b.balance
            FROM balance_snapshots b
            WHERE b.account_id = a.id AND b.date <= d.date
            ORDER BY b.date DESC
            LIMIT 1
          ) as balance,
          (
            SELECT b.usd_to_cad_rate
            FROM balance_snapshots b
            WHERE b.account_id = a.id AND b.date <= d.date
            ORDER BY b.date DESC
            LIMIT 1
          ) as rate
        FROM all_calendar_days d
        CROSS JOIN accounts a
        WHERE a.is_active = true
      ),

      -- Aggregate to daily totals (sum across all accounts)
      daily_totals AS (
        SELECT
          date,
          MAX(rate) as rate,
          SUM(CASE
            WHEN currency = 'CAD'
              AND is_liability = false
              AND account_type != 'credit'
              AND account_type != 'credit card'
              AND balance IS NOT NULL
            THEN balance ELSE 0
          END) as total_cad,
          SUM(CASE
            WHEN currency = 'USD'
              AND is_liability = false
              AND account_type != 'credit'
              AND account_type != 'credit card'
              AND balance IS NOT NULL
            THEN balance ELSE 0
          END) as total_usd,
          SUM(CASE
            WHEN currency = 'CAD'
              AND (account_type = 'credit' OR account_type = 'credit card')
              AND balance IS NOT NULL
            THEN balance ELSE 0
          END) as cc_debt_cad,
          SUM(CASE
            WHEN currency = 'USD'
              AND (account_type = 'credit' OR account_type = 'credit card')
              AND balance IS NOT NULL
            THEN balance ELSE 0
          END) as cc_debt_usd
        FROM daily_account_balances
        GROUP BY date
      ),

      -- Calculate liquid cash for each day
      daily_liquid_cash AS (
        SELECT
          date,
          total_cad + (total_usd * rate) - ABS(cc_debt_cad) - (ABS(cc_debt_usd) * rate) as liquid_cash_cad
        FROM daily_totals
      )

      SELECT date, liquid_cash_cad
      FROM daily_liquid_cash
      ORDER BY date
    `);

    let finalResult = dailyResult.rows;

    // Helper function to safely parse dates in UTC
    const parseUTCDate = (dateValue) => {
      if (dateValue instanceof Date) {
        return dateValue;
      }
      // Handle string dates: '2026-01-31' or '2026-01-31T00:00:00Z'
      const dateStr = String(dateValue);
      if (dateStr.includes('T')) {
        return new Date(dateStr);
      }
      return new Date(dateStr + 'T00:00:00Z');
    };

    // Step 2: Apply granularity aggregation with UTC-aware date handling
    if (granularity === 'weekly') {
      // Filter to Sundays only, plus always include today
      const weeklyData = [];
      const processedWeeks = new Set();

      dailyResult.rows.forEach(row => {
        const date = parseUTCDate(row.date);
        const dayOfWeek = date.getUTCDay(); // 0 = Sunday, use UTC methods

        // Calculate the Sunday of this week (using UTC)
        const sunday = new Date(date);
        sunday.setUTCDate(date.getUTCDate() - dayOfWeek);
        const weekKey = sunday.toISOString().split('T')[0];

        // If this is a Sunday and we haven't processed this week yet
        if (dayOfWeek === 0 && !processedWeeks.has(weekKey)) {
          weeklyData.push(row);
          processedWeeks.add(weekKey);
        }
      });

      // Always include the most recent data point (today) if it's not already included
      const lastDaily = dailyResult.rows[dailyResult.rows.length - 1];
      const lastWeekly = weeklyData[weeklyData.length - 1];

      if (!lastWeekly || lastDaily.date !== lastWeekly.date) {
        weeklyData.push(lastDaily);
      }

      finalResult = weeklyData;

    } else if (granularity === 'monthly') {
      // Filter to last day of each month, plus always include today
      const monthlyData = {};

      dailyResult.rows.forEach(row => {
        const date = parseUTCDate(row.date);
        const monthKey = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;

        // Keep the latest date in each month
        if (!monthlyData[monthKey] || parseUTCDate(row.date) > parseUTCDate(monthlyData[monthKey].date)) {
          monthlyData[monthKey] = row;
        }
      });

      // Ensure today is included (it will naturally be the last day of the current month)
      const lastDaily = dailyResult.rows[dailyResult.rows.length - 1];
      const lastDailyDate = parseUTCDate(lastDaily.date);
      const currentMonthKey = `${lastDailyDate.getUTCFullYear()}-${String(lastDailyDate.getUTCMonth() + 1).padStart(2, '0')}`;

      // This ensures today is the last entry for the current month
      monthlyData[currentMonthKey] = lastDaily;

      finalResult = Object.keys(monthlyData).sort().map(key => monthlyData[key]);
    }
    // else: granularity === 'daily', return all days (already done)

    res.json(finalResult);
  } catch (error) {
    console.error('Error fetching trend data:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get account history for individual account view
app.get('/api/account_history/:accountId', async (req, res) => {
  try {
    const accountId = parseInt(req.params.accountId);

    // Get account info
    const accountInfo = await pool.query(`
      SELECT account_name, currency, account_type
      FROM accounts
      WHERE id = $1
    `, [accountId]);

    if (accountInfo.rows.length === 0) {
      return res.status(404).json({ error: 'Account not found' });
    }

    // Get all snapshots for this account
    const snapshots = await pool.query(`
      SELECT date, balance
      FROM balance_snapshots
      WHERE account_id = $1
      ORDER BY date
    `, [accountId]);

    if (snapshots.rows.length === 0) {
      return res.json({
        account: accountInfo.rows[0],
        monthlyData: [],
        stats: null
      });
    }

    // Aggregate by month (last snapshot of each month)
    const monthlyData = [];
    const allMonths = new Set();

    // Get all months that have snapshots
    snapshots.rows.forEach(row => {
      const date = new Date(row.date);
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      allMonths.add(monthKey);
    });

    // Get min and max month
    const sortedMonths = Array.from(allMonths).sort();
    const minMonth = sortedMonths[0];
    const maxMonth = sortedMonths[sortedMonths.length - 1];

    // Generate all months from min to max (fill gaps)
    const [minYear, minMonthNum] = minMonth.split('-').map(Number);
    const [maxYear, maxMonthNum] = maxMonth.split('-').map(Number);

    let currentYear = minYear;
    let currentMonth = minMonthNum;
    let lastBalance = null;

    while (currentYear < maxYear || (currentYear === maxYear && currentMonth <= maxMonthNum)) {
      const monthKey = `${currentYear}-${String(currentMonth).padStart(2, '0')}`;

      // Find last snapshot in this month
      const monthSnapshot = snapshots.rows
        .filter(row => {
          const d = new Date(row.date);
          const mk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
          return mk === monthKey;
        })
        .sort((a, b) => new Date(b.date) - new Date(a.date))[0];

      const balance = monthSnapshot ? parseFloat(monthSnapshot.balance) : lastBalance;

      if (balance !== null) {
        const monthName = new Date(currentYear, currentMonth - 1).toLocaleString('en-US', { month: 'short', year: 'numeric' });
        monthlyData.push({
          month: monthName,
          balance: balance,
          date: monthSnapshot ? monthSnapshot.date : null,
          isCarriedForward: !monthSnapshot
        });
        lastBalance = balance;
      }

      // Move to next month
      currentMonth++;
      if (currentMonth > 12) {
        currentMonth = 1;
        currentYear++;
      }
    }

    // Calculate stats for last 3 months
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

    const recentSnapshots = snapshots.rows.filter(row =>
      new Date(row.date) >= threeMonthsAgo
    );

    let stats = null;
    if (recentSnapshots.length > 0) {
      const balances = recentSnapshots.map(s => parseFloat(s.balance));
      const minBalance = Math.min(...balances);
      const maxBalance = Math.max(...balances);
      const minSnapshot = recentSnapshots.find(s => parseFloat(s.balance) === minBalance);
      const maxSnapshot = recentSnapshots.find(s => parseFloat(s.balance) === maxBalance);
      const firstBalance = parseFloat(recentSnapshots[0].balance);
      const lastBalance = parseFloat(recentSnapshots[recentSnapshots.length - 1].balance);

      stats = {
        min: minBalance,
        minDate: minSnapshot.date,
        max: maxBalance,
        maxDate: maxSnapshot.date,
        totalChange: lastBalance - firstBalance
      };
    }

    res.json({
      account: accountInfo.rows[0],
      monthlyData: monthlyData,
      stats: stats
    });

  } catch (error) {
    console.error('Error fetching account history:', error);
    res.status(500).json({ error: error.message });
  }
});

// ===========================================
// PLAID API ENDPOINTS
// ===========================================

// Create a link token - needed to initialize Plaid Link
app.post('/api/create_link_token', async (req, res) => {
  try {
    const response = await plaidClient.linkTokenCreate({
      user: { client_user_id: 'user-1' },
      client_name: 'Balance Tracker',
      // products: ['auth','transactions'],  // AUTH product includes balance access
      products: ['transactions'],
      country_codes: ['US','CA'],
      language: 'en',
    });
    res.json({ link_token: response.data.link_token });
  } catch (error) {
    console.error('Error creating link token:', error);
    console.error('Full error details:', error.response?.data);
    res.status(500).json({
      error: error.message,
      details: error.response?.data
    });
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

    // Insert balance (even if null - we track that the account exists)
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
      const accountType = account.type;
      const subtype = account.subtype;

      // Auto-detect liabilities based on account type
      const liabilityTypes = ['mortgage', 'loan', 'line of credit', 'credit line'];
      const isLiability = liabilityTypes.includes(subtype?.toLowerCase()) ||
                          liabilityTypes.includes(accountType?.toLowerCase());

      await pool.query(`
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

    res.json({ success: true });
  } catch (error) {
    console.error('Error exchanging token:', error);
    res.status(500).json({ error: error.message });
  }
});

// Refresh balances from Plaid and save to database
app.post('/api/refresh_balances', async (req, res) => {
  try {
    const { manualBalances } = req.body || {};

    // Get current exchange rate (with auto-refresh if stale)
    const exchangeRateResult = await pool.query(`
      SELECT rate, updated_at FROM exchange_rates
      WHERE from_currency = 'USD' AND to_currency = 'CAD'
    `);

    let currentRate;

    if (exchangeRateResult.rows.length === 0) {
      // No rate exists, fetch from API
      console.log('No USD→CAD rate found, fetching from API...');
      currentRate = await fetchExchangeRateFromAPI('USD', 'CAD');
      await pool.query(`
        INSERT INTO exchange_rates (from_currency, to_currency, rate, updated_at)
        VALUES ('USD', 'CAD', $1, NOW())
      `, [currentRate]);
    } else {
      currentRate = parseFloat(exchangeRateResult.rows[0].rate);
      const updatedAt = exchangeRateResult.rows[0].updated_at;
      // Check if rate is stale (older than 24 hours)
      const ageInHours = (Date.now() - new Date(updatedAt).getTime()) / (1000 * 60 * 60);

      if (ageInHours > 24) {
        console.log(`Exchange rate is ${ageInHours.toFixed(1)} hours old, refreshing from API...`);
        try {
          currentRate = await fetchExchangeRateFromAPI('USD', 'CAD');
          await pool.query(`
            UPDATE exchange_rates
            SET rate = $1, updated_at = NOW()
            WHERE from_currency = 'USD' AND to_currency = 'CAD'
          `, [currentRate]);
          console.log(`✅ Exchange rate updated to ${currentRate}`);
        } catch (error) {
          console.error('Error refreshing exchange rate, using cached rate:', error);
        }
      } else {
        console.log(`Using cached exchange rate (${ageInHours.toFixed(1)} hours old): ${currentRate}`);
      }
    }

    // Use provided date or default to server's local timezone
    const today = req.body?.date || new Date().toLocaleDateString('en-CA');
    console.log(`Using date: ${today}`);

    let accountsUpdated = 0;

    // Only process Plaid accounts if manualBalances is not provided
    // (manualBalances presence indicates this is the second call)
    if (!manualBalances || Object.keys(manualBalances).length === 0) {
      // Process Plaid accounts
      const itemsResult = await pool.query(`
        SELECT id, plaid_item_id, access_token_encrypted
        FROM plaid_items
        WHERE access_token_encrypted IS NOT NULL
      `);

      console.log(`\n🔄 Refreshing balances for ${itemsResult.rows.length} Plaid items...`);

    for (const item of itemsResult.rows) {
      try {
        console.log(`\n📍 Processing item: ${item.plaid_item_id}`);

        // Decrypt access token
        const accessToken = await decryptToken(item.access_token_encrypted);

        // Fetch balances from Plaid
        const balancesResponse = await plaidClient.accountsBalanceGet({
          access_token: accessToken,
        });

        console.log(`   Found ${balancesResponse.data.accounts.length} accounts from Plaid`);

        // Save each balance with the current exchange rate
        for (const account of balancesResponse.data.accounts) {
          console.log(`   - Account: ${account.name}, Balance: ${account.balances.current}, Plaid ID: ${account.account_id}`);

          const accountResult = await pool.query(`
            SELECT id, account_name, account_type, is_liability FROM accounts WHERE plaid_account_id = $1
          `, [account.account_id]);

          if (accountResult.rows.length > 0) {
            const accountId = accountResult.rows[0].id;
            const accountName = accountResult.rows[0].account_name;
            const accountType = accountResult.rows[0].account_type;

            let balanceToSave = account.balances.current;

            // For debt accounts, invert the sign (Plaid convention: positive = debt, Our convention: negative = debt)
            if (balanceToSave !== null) {
              const debtTypes = ['mortgage', 'loan', 'line of credit', 'credit card', 'auto'];
              const isDebtType = debtTypes.includes(accountType.toLowerCase());

              if (isDebtType || accountResult.rows[0].is_liability) {
                balanceToSave = -balanceToSave;
                console.log(`     🔄 Inverted balance (${isDebtType ? 'debt type' : 'liability'}): ${account.balances.current} → ${balanceToSave}`);
              }
            }

            await pool.query(`
              INSERT INTO balance_snapshots (account_id, balance, date, usd_to_cad_rate)
              VALUES ($1, $2, $3, $4)
              ON CONFLICT (account_id, date)
              DO UPDATE SET balance = $2, usd_to_cad_rate = $4
            `, [accountId, balanceToSave, today, currentRate]);

            if (balanceToSave !== null) {
              console.log(`     ✅ Updated DB account ${accountId} (${accountName}): ${balanceToSave}`);
              accountsUpdated++;
            } else {
              console.log(`     ⚠️  Saved with NULL balance (not available from bank)`);
            }
          } else {
            console.log(`     ⚠️  No matching account in DB for Plaid ID: ${account.account_id}`);
          }
        }
      } catch (error) {
        console.error(`❌ Error refreshing item ${item.plaid_item_id}:`, error.message);
      }
    }
    }

    // Process manual accounts if provided
    let manualAccountsUpdated = 0;
    if (manualBalances && Object.keys(manualBalances).length > 0) {
      console.log(`\n💼 Processing ${Object.keys(manualBalances).length} manual accounts...`);

      for (const [accountId, balance] of Object.entries(manualBalances)) {
        if (balance === null || balance === undefined || balance === '') {
          console.log(`   ⏭️  Skipping account ${accountId} (no value provided)`);
          continue;
        }

        const accountResult = await pool.query(`
          SELECT account_name, account_type, is_liability FROM accounts WHERE id = $1
        `, [parseInt(accountId)]);

        if (accountResult.rows.length > 0) {
          const accountName = accountResult.rows[0].account_name;
          const accountType = accountResult.rows[0].account_type;
          const isLiability = accountResult.rows[0].is_liability;

          let balanceToSave = parseFloat(balance);

          // Invert if liability or credit card (user enters positive, we store negative)
          const isCreditCard = accountType === 'credit' || accountType === 'credit card';
          if ((isLiability || isCreditCard) && balanceToSave > 0) {
            balanceToSave = -balanceToSave;
            console.log(`   🔄 Inverted balance for ${isCreditCard ? 'credit card' : 'liability'} ${accountName}: ${balance} → ${balanceToSave}`);
          }

          await pool.query(`
            INSERT INTO balance_snapshots (account_id, balance, date, usd_to_cad_rate)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (account_id, date)
            DO UPDATE SET balance = $2, usd_to_cad_rate = $4
          `, [parseInt(accountId), balanceToSave, today, currentRate]);

          console.log(`   ✅ Updated manual account ${accountId} (${accountName}): ${balanceToSave}`);
          manualAccountsUpdated++;
        }
      }
    }

    const totalUpdated = accountsUpdated + manualAccountsUpdated;
    console.log(`\n✅ Refresh complete: ${totalUpdated} accounts updated (${accountsUpdated} Plaid, ${manualAccountsUpdated} manual)\n`);

    res.json({
      success: true,
      accountsUpdated: totalUpdated,
      plaidAccountsUpdated: accountsUpdated,
      manualAccountsUpdated: manualAccountsUpdated,
      date: today,
      exchangeRate: currentRate
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
  console.log('   GET  /api/manual_accounts - List manual accounts with last balances');
  console.log('   GET  /api/latest_balances - Current balances');
  console.log('   GET  /api/historical_balances - All balance history');
  console.log('   GET  /api/summary - Calculated summary');
  console.log('   GET  /api/trend_data - Data for trend chart');
  console.log('   GET  /api/account_history/:id - Individual account history');
  console.log('   POST /api/refresh_balances - Update from Plaid and manual accounts\n');
  console.log('📄 Pages:');
  console.log('   http://localhost:3000 - Main Dashboard');
  console.log('   http://localhost:3000/connect.html - Connect Banks\n');
});
