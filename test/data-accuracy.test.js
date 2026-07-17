// Data accuracy tests: summary math, currency conversion, liability sign
// handling, trend carry-forward, and liquid/retirement separation.
//
// Each describe block reseeds the database with a known fixture and asserts
// exact expected numbers from the API.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { app } = require('./helpers/setup');
const db = require('./helpers/db');

const pool = db.createPool();
const RATE = 1.35;

after(async () => {
  await pool.end();
});

// Reseed the DB and return a logged-in agent (truncate wipes sessions too)
async function freshLogin(ip) {
  await db.seedUser(pool);
  await db.seedExchangeRate(pool, RATE);
  const agent = request.agent(app);
  const res = await agent
    .post('/api/login')
    .set('X-Forwarded-For', ip)
    .send(db.TEST_USER);
  assert.equal(res.status, 200, 'test login failed');
  return agent;
}

describe('summary math (liquid cash in CAD)', () => {
  let agent;
  const today = db.daysAgo(0);
  const prior = db.daysAgo(5);

  before(async () => {
    await db.truncateAll(pool);
    agent = await freshLogin('10.10.0.1');

    const chequing = await db.seedAccount(pool, { name: 'Chequing', currency: 'CAD' });
    const usdSavings = await db.seedAccount(pool, { name: 'US Savings', type: 'savings', currency: 'USD' });
    const creditCard = await db.seedAccount(pool, { name: 'Visa', type: 'credit card', currency: 'CAD', isLiability: true });
    const rrsp = await db.seedAccount(pool, { name: 'RRSP', type: 'rrsp', category: 'retirement', currency: 'CAD' });

    // Prior snapshot: 900 + 500×1.35 − 100 = 1475 liquid CAD
    await db.seedSnapshot(pool, chequing, 900, prior, RATE);
    await db.seedSnapshot(pool, usdSavings, 500, prior, RATE);
    await db.seedSnapshot(pool, creditCard, -100, prior, RATE);
    await db.seedSnapshot(pool, rrsp, 9500, prior, RATE);

    // Today: 1200 + 500×1.35 − 200 = 1675 liquid CAD
    await db.seedSnapshot(pool, chequing, 1200, today, RATE);
    await db.seedSnapshot(pool, usdSavings, 500, today, RATE);
    await db.seedSnapshot(pool, creditCard, -200, today, RATE);
    await db.seedSnapshot(pool, rrsp, 10000, today, RATE);
  });

  it('computes current totals, USD conversion, and credit card debt', async () => {
    const res = await agent.get('/api/summary');
    assert.equal(res.status, 200);

    const s = res.body;
    assert.equal(s.date, today);
    assert.equal(s.totalCad, 1200);
    assert.equal(s.totalUsd, 500);
    assert.equal(s.ccDebtCad, 200);
    assert.equal(s.ccDebtUsd, 0);
    assert.equal(s.usdToCadRate, RATE);
    // liquid = CAD + USD×rate − CC debt = 1200 + 675 − 200
    assert.equal(s.liquidCashCad, 1675);
  });

  it('computes change vs the previous snapshot date', async () => {
    const s = (await agent.get('/api/summary')).body;
    assert.equal(s.previousDate, prior);
    // 1675 − 1475
    assert.equal(Math.round(s.liquidChange * 100) / 100, 200);
  });

  it('excludes retirement accounts from liquid balances', async () => {
    const res = await agent.get('/api/latest_balances');
    assert.equal(res.status, 200);
    const names = res.body.accounts.map(a => a.account_name).sort();
    assert.deepEqual(names, ['Chequing', 'US Savings', 'Visa']);
  });

  it('retirement summary converts USD and groups by type', async () => {
    // Add a USD 401k so conversion is exercised: 10000 + 1000×1.35 = 11350
    const k401 = await db.seedAccount(pool, { name: '401k', type: '401k', category: 'retirement', currency: 'USD' });
    await db.seedSnapshot(pool, k401, 1000, today, RATE);

    const res = await agent.get('/api/retirement_summary');
    assert.equal(res.status, 200);
    assert.equal(res.body.totalRetirementCad, 11350);

    const byType = Object.fromEntries(res.body.byType.map(t => [t.accountType, t.totalCad]));
    assert.equal(byType['rrsp'], 10000);
    assert.equal(byType['401k'], 1350);
  });
});

describe('trend data carry-forward', () => {
  let agent;

  before(async () => {
    await db.truncateAll(pool);
    agent = await freshLogin('10.10.0.2');

    // One CAD account with snapshots 6 days ago (100) and 2 days ago (250).
    // The gap days must carry the last known balance forward.
    const chequing = await db.seedAccount(pool, { name: 'Chequing', currency: 'CAD' });
    await db.seedSnapshot(pool, chequing, 100, db.daysAgo(6), RATE);
    await db.seedSnapshot(pool, chequing, 250, db.daysAgo(2), RATE);
  });

  it('fills every calendar day and carries balances forward', async () => {
    const res = await agent.get('/api/trend_data?granularity=daily');
    assert.equal(res.status, 200);

    const rows = res.body;
    assert.equal(rows.length, 7, 'should cover all 7 days from first snapshot to today');

    const values = rows.map(r => parseFloat(r.liquid_cash_cad));
    assert.deepEqual(values, [100, 100, 100, 100, 250, 250, 250]);

    const dates = rows.map(r => r.date);
    assert.equal(dates[0], db.daysAgo(6));
    assert.equal(dates[6], db.daysAgo(0));
  });

  it('weekly granularity returns only Sundays plus today', async () => {
    const res = await agent.get('/api/trend_data?granularity=weekly');
    assert.equal(res.status, 200);

    const today = db.daysAgo(0);
    for (const row of res.body) {
      const [y, m, d] = row.date.split('-').map(Number);
      const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
      assert.ok(dow === 0 || row.date === today, `${row.date} is neither a Sunday nor today`);
    }
    assert.equal(res.body.at(-1).date, today, 'today must always be included');
  });

  it('rejects an unknown granularity by falling back to daily', async () => {
    const res = await agent.get('/api/trend_data?granularity=1;DROP TABLE accounts');
    assert.equal(res.status, 200);
    assert.equal(res.body.length, 7);
    const check = await pool.query('SELECT COUNT(*)::int AS n FROM accounts');
    assert.equal(check.rows[0].n, 1, 'accounts table intact');
  });

  it('ignores inactive accounts', async () => {
    const closed = await db.seedAccount(pool, { name: 'Closed', currency: 'CAD', isActive: false });
    await db.seedSnapshot(pool, closed, 99999, db.daysAgo(1), RATE);

    const res = await agent.get('/api/trend_data?granularity=daily');
    const values = res.body.map(r => parseFloat(r.liquid_cash_cad));
    assert.ok(values.every(v => v < 1000), 'inactive account balance leaked into trend');
  });
});

describe('manual account creation and balance entry', () => {
  let agent;

  before(async () => {
    await db.truncateAll(pool);
    agent = await freshLogin('10.10.0.3');
  });

  it('rejects missing fields, bad currency, and bad category', async () => {
    const cases = [
      { account_name: 'No institution', account_type: 'savings', currency: 'CAD' },
      { institution_name: 'B', account_name: 'X', account_type: 'savings', currency: 'EUR' },
      { institution_name: 'B', account_name: 'X', account_type: 'savings', currency: 'CAD', account_category: 'crypto' },
    ];
    for (const body of cases) {
      const res = await agent.post('/api/accounts/manual').send(body);
      assert.equal(res.status, 400, `should reject: ${JSON.stringify(body)}`);
    }
  });

  it('stores a credit card initial balance as negative (liability convention)', async () => {
    const res = await agent.post('/api/accounts/manual').send({
      institution_name: 'Test Bank',
      account_name: 'Manual Visa',
      account_type: 'credit card',
      currency: 'CAD',
      account_category: 'liquid',
      initial_balance: 300,
    });
    assert.equal(res.status, 200);

    const accounts = (await agent.get('/api/manual_accounts')).body;
    const visa = accounts.find(a => a.account_name === 'Manual Visa');
    assert.ok(visa, 'created account not found');
    assert.equal(visa.is_liability, true);
    assert.equal(parseFloat(visa.last_balance), -300);
  });

  it('defaults to the retirement category and supports category filtering', async () => {
    const res = await agent.post('/api/accounts/manual').send({
      institution_name: 'Test Bank',
      account_name: 'Manual RRSP',
      account_type: 'rrsp',
      currency: 'CAD',
      initial_balance: 5000,
    });
    assert.equal(res.status, 200);

    const retirement = (await agent.get('/api/manual_accounts?category=retirement')).body;
    assert.ok(retirement.some(a => a.account_name === 'Manual RRSP'));

    const liquid = (await agent.get('/api/manual_accounts?category=liquid')).body;
    assert.ok(!liquid.some(a => a.account_name === 'Manual RRSP'));
  });

  it('refresh_balances inverts positive entries for liability accounts', async () => {
    const loan = await db.seedAccount(pool, {
      name: 'Car Loan', type: 'loan', currency: 'CAD', isLiability: true,
    });

    // User enters 400 owed; it must be stored as −400
    const res = await agent
      .post('/api/refresh_balances')
      .send({ manualBalances: { [loan]: 400 } });
    assert.equal(res.status, 200);
    assert.equal(res.body.manualAccountsUpdated, 1);

    const snap = await pool.query(
      'SELECT balance FROM balance_snapshots WHERE account_id = $1', [loan]
    );
    assert.equal(parseFloat(snap.rows[0].balance), -400);
  });

  it('upserts rather than duplicates when the same day is saved twice', async () => {
    const savings = await db.seedAccount(pool, { name: 'Upsert Test', type: 'savings', currency: 'CAD' });

    await agent.post('/api/refresh_balances').send({ manualBalances: { [savings]: 100 } });
    await agent.post('/api/refresh_balances').send({ manualBalances: { [savings]: 150 } });

    const snaps = await pool.query(
      'SELECT balance FROM balance_snapshots WHERE account_id = $1', [savings]
    );
    assert.equal(snaps.rows.length, 1, 'one snapshot per account per day');
    assert.equal(parseFloat(snaps.rows[0].balance), 150);
  });
});
