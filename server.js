// plaid-server.js
const express = require('express');
const { Configuration, PlaidApi, PlaidEnvironments } = require('plaid');
const fs = require('fs').promises;

const app = express();
app.use(express.json());
app.use(express.static('public'));

// Initialize Plaid client
// Get these from: https://dashboard.plaid.com/developers/keys
const configuration = new Configuration({
  basePath: PlaidEnvironments.sandbox, // Use 'sandbox' for testing, 'development' for real banks
  baseOptions: {
    headers: {
      'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID,
      'PLAID-SECRET': process.env.PLAID_SECRET,
    },
  },
});

const plaidClient = new PlaidApi(configuration);

// Store access tokens (in production, use a database)
let accessToken = null;

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

// Exchange public token for access token
app.post('/api/exchange_public_token', async (req, res) => {
  const { public_token } = req.body;
  
  try {
    const response = await plaidClient.itemPublicTokenExchange({
      public_token: public_token,
    });
    
    accessToken = response.data.access_token;
    
    // In production, save this to a database
    await fs.writeFile('plaid-token.json', JSON.stringify({ 
      access_token: accessToken 
    }));
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error exchanging token:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get account balances
app.get('/api/plaid_balance', async (req, res) => {
  try {
    // Load access token if not in memory
    if (!accessToken) {
      const data = await fs.readFile('plaid-token.json', 'utf-8');
      accessToken = JSON.parse(data).access_token;
    }
    
    const response = await plaidClient.accountsBalanceGet({
      access_token: accessToken,
    });
    
    // Find credit card accounts
    const creditCards = response.data.accounts.filter(
      account => account.type === 'credit'
    );
    
    // Format the data
    const balances = creditCards.map(account => ({
      name: account.name,
      officialName: account.official_name,
      currentBalance: account.balances.current,
      availableBalance: account.balances.available,
      limit: account.balances.limit,
      mask: account.mask, // Last 4 digits
    }));
    
    const data = {
      institution: response.data.item.institution_id,
      accounts: balances,
      timestamp: new Date().toISOString()
    };
    
    res.json(data);
  } catch (error) {
    console.error('Error getting balance:', error);
    res.status(500).json({ error: error.message });
  }
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`🚀 Plaid server running at http://localhost:${PORT}`);
  console.log('\n📝 Setup instructions:');
  console.log('1. Sign up at https://dashboard.plaid.com/signup');
  console.log('2. Get your Client ID and Secret from the Keys page');
  console.log('3. Set environment variables:');
  console.log('   export PLAID_CLIENT_ID=your_client_id');
  console.log('   export PLAID_SECRET=your_sandbox_secret');
  console.log('4. Open http://localhost:3000 in your browser\n');
});