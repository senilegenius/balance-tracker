// Security tests: authentication, session handling, injection resistance,
// rate limiting, and security headers.
//
// Note on X-Forwarded-For: the app sets `trust proxy`, and the login rate
// limiter buckets by client IP. Each test group uses a distinct fake IP so
// rate-limit state from one group can't bleed into another.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { app } = require('./helpers/setup');
const db = require('./helpers/db');

const pool = db.createPool();

before(async () => {
  await db.truncateAll(pool);
  await db.seedUser(pool);
  await db.seedExchangeRate(pool);
});

after(async () => {
  await pool.end();
});

describe('unauthenticated access is blocked', () => {
  const protectedGets = [
    '/api/exchange_rate',
    '/api/accounts',
    '/api/manual_accounts',
    '/api/latest_balances',
    '/api/historical_balances',
    '/api/summary',
    '/api/trend_data',
    '/api/account_history/1',
    '/api/retirement_balances',
    '/api/retirement_summary',
    '/api/retirement_trend_data',
  ];

  const protectedPosts = [
    '/api/accounts/manual',
    '/api/refresh_balances',
    '/api/create_link_token',
    '/api/create_link_token_update',
    '/api/clear_item_error',
    '/api/set_sync_paused',
    '/api/exchange_public_token',
  ];

  for (const path of protectedGets) {
    it(`GET ${path} returns 401 without a session`, async () => {
      const res = await request(app).get(path);
      assert.equal(res.status, 401);
    });
  }

  for (const path of protectedPosts) {
    it(`POST ${path} returns 401 without a session`, async () => {
      const res = await request(app).post(path).send({});
      assert.equal(res.status, 401);
    });
  }

  it('protected HTML pages redirect to login', async () => {
    for (const page of ['/', '/index.html', '/connect.html']) {
      const res = await request(app).get(page);
      assert.equal(res.status, 302, `${page} should redirect`);
      assert.equal(res.headers.location, '/login.html');
    }
  });

  it('login page itself is reachable without a session', async () => {
    const res = await request(app).get('/login.html');
    assert.equal(res.status, 200);
  });

  it('/api/check-auth reports unauthenticated without leaking details', async () => {
    const res = await request(app).get('/api/check-auth');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { authenticated: false });
  });
});

describe('login endpoint', () => {
  it('requires both username and password', async () => {
    const res = await request(app)
      .post('/api/login')
      .set('X-Forwarded-For', '10.1.0.1')
      .send({ username: db.TEST_USER.username });
    assert.equal(res.status, 400);
  });

  it('does not reveal whether the username or the password was wrong', async () => {
    const unknownUser = await request(app)
      .post('/api/login')
      .set('X-Forwarded-For', '10.1.0.2')
      .send({ username: 'no-such-user', password: 'whatever' });

    const wrongPassword = await request(app)
      .post('/api/login')
      .set('X-Forwarded-For', '10.1.0.3')
      .send({ username: db.TEST_USER.username, password: 'wrong-password' });

    assert.equal(unknownUser.status, 401);
    assert.equal(wrongPassword.status, 401);
    // Identical responses prevent user enumeration
    assert.deepEqual(unknownUser.body, wrongPassword.body);
  });

  it('is not vulnerable to SQL injection in the username', async () => {
    const payloads = [
      "' OR '1'='1",
      "admin'--",
      "'; DROP TABLE users; --",
    ];

    for (const payload of payloads) {
      const res = await request(app)
        .post('/api/login')
        .set('X-Forwarded-For', '10.1.0.4')
        .send({ username: payload, password: 'x' });
      // Must be a clean rejection — not a 500 (SQL error) and not a login
      assert.equal(res.status, 401, `payload should be rejected: ${payload}`);
    }

    // users table must still exist and still contain the seeded user
    const users = await pool.query('SELECT COUNT(*)::int AS n FROM users');
    assert.equal(users.rows[0].n, 1);
  });

  it('valid credentials log in and grant API access', async () => {
    const agent = request.agent(app);

    const login = await agent
      .post('/api/login')
      .set('X-Forwarded-For', '10.1.0.5')
      .send(db.TEST_USER);
    assert.equal(login.status, 200);
    assert.equal(login.body.success, true);

    const accounts = await agent.get('/api/accounts');
    assert.equal(accounts.status, 200);
  });

  it('rate limits repeated login attempts from the same IP', async () => {
    const attackerIp = '10.99.99.99';
    let lastStatus;

    for (let i = 0; i < 6; i++) {
      const res = await request(app)
        .post('/api/login')
        .set('X-Forwarded-For', attackerIp)
        .send({ username: db.TEST_USER.username, password: `guess-${i}` });
      lastStatus = res.status;
    }

    assert.equal(lastStatus, 429, 'sixth attempt should be rate limited');
  });
});

describe('session handling', () => {
  it('session cookie is HttpOnly (not readable by page JavaScript)', async () => {
    const res = await request(app)
      .post('/api/login')
      .set('X-Forwarded-For', '10.2.0.1')
      .send(db.TEST_USER);

    const cookie = res.headers['set-cookie']?.[0] ?? '';
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /Expires=/i, 'cookie should expire (idle timeout)');
  });

  it('logout destroys the session', async () => {
    const agent = request.agent(app);
    await agent
      .post('/api/login')
      .set('X-Forwarded-For', '10.2.0.2')
      .send(db.TEST_USER);

    // Sanity check: authenticated
    assert.equal((await agent.get('/api/accounts')).status, 200);

    const logout = await agent.post('/api/logout');
    assert.equal(logout.status, 200);

    // Session must be gone
    assert.equal((await agent.get('/api/accounts')).status, 401);
    const check = await agent.get('/api/check-auth');
    assert.equal(check.body.authenticated, false);
  });

  it('a forged session cookie is rejected', async () => {
    const res = await request(app)
      .get('/api/accounts')
      .set('Cookie', 'connect.sid=s%3Aforged-session-id.fakesignature');
    assert.equal(res.status, 401);
  });
});

describe('security headers', () => {
  it('responses carry helmet security headers', async () => {
    const res = await request(app).get('/login.html');

    assert.ok(
      res.headers['content-security-policy']?.includes("default-src 'self'"),
      'CSP should restrict default sources to self'
    );
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.ok(res.headers['x-frame-options'], 'clickjacking protection missing');
  });

  it('input validation rejects a malformed account id', async () => {
    const agent = request.agent(app);
    await agent
      .post('/api/login')
      .set('X-Forwarded-For', '10.3.0.1')
      .send(db.TEST_USER);

    for (const bad of ['abc', '-1', '0']) {
      const res = await agent.get(`/api/account_history/${bad}`);
      assert.equal(res.status, 400, `account id "${bad}" should be rejected`);
    }
  });
});
