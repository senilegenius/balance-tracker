// Sync pause tests: pausing a Plaid item routes its accounts into the manual
// update flow (and back), without touching the Plaid linkage.
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

describe('pausing Plaid sync for an item', () => {
  let agent;
  let item;
  let plaidAccount;
  let manualAccount;

  before(async () => {
    await db.truncateAll(pool);
    await db.seedUser(pool);
    await db.seedExchangeRate(pool, RATE);

    agent = request.agent(app);
    const login = await agent
      .post('/api/login')
      .set('X-Forwarded-For', '10.10.0.3')
      .send(db.TEST_USER);
    assert.equal(login.status, 200, 'test login failed');

    // A Plaid-linked institution with one account, plus a pure manual account
    item = await db.seedPlaidItem(pool, {
      institution: 'Broken Bank',
      plaidItemId: 'item-broken-bank',
    });
    plaidAccount = await db.seedAccount(pool, {
      institution: 'Broken Bank',
      name: 'Chequing',
      plaidAccountId: 'plaid-acc-1',
      plaidItemId: item.id,
    });
    manualAccount = await db.seedAccount(pool, {
      institution: 'Manual Bank',
      name: 'RRSP',
      type: 'rrsp',
      category: 'retirement',
    });
    await db.seedSnapshot(pool, plaidAccount, 1000, db.daysAgo(1), RATE);
  });

  it('excludes Plaid-linked accounts from manual_accounts by default', async () => {
    const res = await agent.get('/api/manual_accounts');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.map(a => a.account_name), ['RRSP']);
  });

  it('reports sync_paused=false on /api/accounts', async () => {
    const res = await agent.get('/api/accounts');
    const chequing = res.body.find(a => a.id === plaidAccount);
    assert.equal(chequing.sync_paused, false);
    assert.equal(chequing.is_plaid_connected, true);
  });

  it('pausing moves the item accounts into manual_accounts', async () => {
    const toggle = await agent
      .post('/api/set_sync_paused')
      .send({ plaid_item_id: item.plaidItemId, sync_paused: true });
    assert.equal(toggle.status, 200);
    assert.equal(toggle.body.sync_paused, true);

    const res = await agent.get('/api/manual_accounts');
    const names = res.body.map(a => a.account_name).sort();
    assert.deepEqual(names, ['Chequing', 'RRSP']);

    // Last balance is carried into the manual update flow
    const chequing = res.body.find(a => a.account_name === 'Chequing');
    assert.equal(parseFloat(chequing.last_balance), 1000);
  });

  it('paused state is exposed on /api/accounts, linkage intact', async () => {
    const res = await agent.get('/api/accounts');
    const chequing = res.body.find(a => a.id === plaidAccount);
    assert.equal(chequing.sync_paused, true);
    assert.equal(chequing.is_plaid_connected, true);
    assert.ok(chequing.sync_paused_at, 'sync_paused_at should be set while paused');
  });

  it('paused accounts respect the category filter', async () => {
    const res = await agent.get('/api/manual_accounts?category=retirement');
    assert.deepEqual(res.body.map(a => a.account_name), ['RRSP']);
  });

  it('manual balance entry works for a paused account', async () => {
    const today = db.daysAgo(0);
    const res = await agent
      .post('/api/refresh_balances')
      .send({ manualBalances: { [plaidAccount]: 1250 }, date: today });
    assert.equal(res.status, 200);
    assert.equal(res.body.manualAccountsUpdated, 1);

    const latest = await pool.query(
      'SELECT balance FROM balance_snapshots WHERE account_id = $1 AND date = $2',
      [plaidAccount, today]
    );
    assert.equal(parseFloat(latest.rows[0].balance), 1250);
  });

  it('resuming removes the accounts from manual_accounts again', async () => {
    const toggle = await agent
      .post('/api/set_sync_paused')
      .send({ plaid_item_id: item.plaidItemId, sync_paused: false });
    assert.equal(toggle.status, 200);

    const res = await agent.get('/api/manual_accounts');
    assert.deepEqual(res.body.map(a => a.account_name), ['RRSP']);
  });

  it('records an audit event for each pause/resume transition', async () => {
    const events = await pool.query(
      'SELECT action FROM sync_events WHERE plaid_item_id = $1 ORDER BY id',
      [item.id]
    );
    assert.deepEqual(events.rows.map(e => e.action), ['paused', 'resumed']);
  });

  it('rejects bad input and unknown items', async () => {
    const missing = await agent.post('/api/set_sync_paused').send({});
    assert.equal(missing.status, 400);

    const notBoolean = await agent
      .post('/api/set_sync_paused')
      .send({ plaid_item_id: item.plaidItemId, sync_paused: 'yes' });
    assert.equal(notBoolean.status, 400);

    const unknown = await agent
      .post('/api/set_sync_paused')
      .send({ plaid_item_id: 'no-such-item', sync_paused: true });
    assert.equal(unknown.status, 404);
  });
});
