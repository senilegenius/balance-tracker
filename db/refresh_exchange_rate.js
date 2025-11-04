// Script to fetch current exchange rate and update database
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function fetchExchangeRate(fromCurrency, toCurrency) {
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
    console.error('Error fetching exchange rate:', error);
    throw error;
  }
}

async function updateExchangeRate() {
  try {
    console.log('Fetching current USD→CAD exchange rate from API...');

    const rate = await fetchExchangeRate('USD', 'CAD');

    console.log(`Current rate: ${rate}`);

    // Update database
    await pool.query(`
      INSERT INTO exchange_rates (from_currency, to_currency, rate, updated_at)
      VALUES ('USD', 'CAD', $1, NOW())
      ON CONFLICT (from_currency, to_currency)
      DO UPDATE SET rate = $1, updated_at = NOW()
    `, [rate]);

    console.log('✅ Exchange rate updated successfully in database');

    await pool.end();
    process.exit(0);

  } catch (error) {
    console.error('❌ Error updating exchange rate:', error);
    await pool.end();
    process.exit(1);
  }
}

updateExchangeRate();
