// Recurring payments CRUD: create, list (with derived fields and monthly
// totals), update, stop/restart via end_date, and soft delete.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { app } = require('./helpers/setup');
const db = require('./helpers/db');
const { todayInVancouver, addDays } = require('../lib/schedule');

const pool = db.createPool();

after(async () => {
  await pool.end();
});

const MORTGAGE = {
  name: 'Mortgage',
  amount: 2000,
  frequency: 'biweekly',
  anchor_date: '2026-01-02',
};

const TUITION = {
  name: 'Tuition',
  amount: 1200,
  frequency: 'monthly',
  anchor_date: '2026-09-01',
  active_months: [9, 10, 11, 12, 1, 2, 3, 4, 5, 6, 7],
};

const PAYCHEQUE = {
  name: 'Paycheque',
  direction: 'inflow',
  amount: 3000,
  frequency: 'biweekly',
  anchor_date: '2026-01-09',
};

describe('recurring payments API', () => {
  let agent;
  let checkingId;

  before(async () => {
    await db.truncateAll(pool);
    await db.seedUser(pool);
    checkingId = await db.seedAccount(pool, { name: 'Chequing' });

    agent = request.agent(app);
    const login = await agent
      .post('/api/login')
      .set('X-Forwarded-For', '10.20.0.1')
      .send(db.TEST_USER);
    assert.equal(login.status, 200, 'test login failed');
  });

  it('starts empty with zero totals', async () => {
    const res = await agent.get('/api/recurring_payments');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.payments, []);
    assert.deepEqual(res.body.monthly_totals, { must_have: 0, discretionary: 0, income: 0, net: 0 });
  });

  it('creates payments with defaults and derived fields', async () => {
    const res = await agent.post('/api/recurring_payments').send({ ...MORTGAGE, account_id: checkingId });
    assert.equal(res.status, 201);
    const p = res.body.payment;
    assert.equal(p.name, 'Mortgage');
    assert.equal(p.direction, 'outflow');
    assert.equal(p.category, 'must_have');
    assert.equal(p.weekend_rule, 'next');
    assert.equal(p.account_name, 'Chequing');
    assert.equal(p.amount, 2000);
    assert.equal(p.status, 'active');
    assert.equal(p.monthly_equivalent, 4333.33);
    assert.ok(p.next_date >= todayInVancouver(), 'next_date should be today or later');
    assert.equal(p.next_amount, 2000);
  });

  it('defaults inflows to the income category and stores active_months sorted', async () => {
    const pay = await agent.post('/api/recurring_payments').send(PAYCHEQUE);
    assert.equal(pay.status, 201);
    assert.equal(pay.body.payment.category, 'income');

    const tuition = await agent.post('/api/recurring_payments').send(TUITION);
    assert.equal(tuition.status, 201);
    assert.deepEqual(tuition.body.payment.active_months, [1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12]);
    assert.equal(tuition.body.payment.monthly_equivalent, 1100);
  });

  it('lists payments with monthly totals for active payments only', async () => {
    // A payment that hasn't started yet doesn't count towards totals
    const future = await agent.post('/api/recurring_payments').send({
      name: 'Childcare',
      amount: 300,
      frequency: 'weekly',
      anchor_date: addDays(todayInVancouver(), 30),
    });
    assert.equal(future.body.payment.status, 'scheduled');

    const res = await agent.get('/api/recurring_payments');
    assert.equal(res.status, 200);
    assert.equal(res.body.payments.length, 4);
    assert.deepEqual(res.body.monthly_totals, {
      must_have: 5433.33, // mortgage 4333.33 + tuition 1100
      discretionary: 0,
      income: 6500,
      net: 1066.67,
    });
  });

  describe('validation', () => {
    const cases = [
      [{ ...MORTGAGE, name: '' }, /name is required/],
      [{ ...MORTGAGE, name: 'x'.repeat(101) }, /name is required/],
      [{ ...MORTGAGE, amount: -1 }, /amount must be a number/],
      [{ ...MORTGAGE, amount: 'abc' }, /amount must be a number/],
      [{ ...MORTGAGE, amount: undefined }, /amount must be a number/],
      [{ ...MORTGAGE, amount_max: 10 }, /amount_max must be/],
      [{ ...MORTGAGE, frequency: 'daily' }, /frequency must be one of/],
      [{ ...MORTGAGE, direction: 'sideways' }, /direction must be one of/],
      [{ ...MORTGAGE, category: 'luxury' }, /category must be one of/],
      [{ ...MORTGAGE, weekend_rule: 'later' }, /weekend_rule must be one of/],
      [{ ...MORTGAGE, anchor_date: '2026-02-30' }, /anchor_date must be/],
      [{ ...MORTGAGE, anchor_date: 'tomorrow' }, /anchor_date must be/],
      [{ ...TUITION, day_of_month: 32 }, /day_of_month must be/],
      [{ ...TUITION, day_of_month: -8 }, /day_of_month must be/],
      [{ ...TUITION, day_of_month: 0 }, /day_of_month must be/],
      [{ ...MORTGAGE, day_of_month: 15 }, /does not apply to biweekly/],
      [{ ...TUITION, active_months: [0, 13] }, /active_months must contain/],
      [{ ...TUITION, active_months: '9,10' }, /active_months must be an array/],
      [{ ...MORTGAGE, start_date: '2026-13-01' }, /start_date must be/],
      [{ ...MORTGAGE, start_date: '2026-05-01', end_date: '2026-04-01' }, /end_date must be on or after/],
      [{ ...MORTGAGE, account_id: 999999 }, /account_id must be an active account/],
      [{ ...MORTGAGE, account_id: 'abc' }, /account_id must be an active account/],
    ];

    for (const [body, message] of cases) {
      it(`rejects ${JSON.stringify(body).slice(0, 90)}`, async () => {
        const res = await agent.post('/api/recurring_payments').send(body);
        assert.equal(res.status, 400);
        assert.match(res.body.error, message);
      });
    }
  });

  it('updates a payment, replacing the whole rule', async () => {
    const created = await agent.post('/api/recurring_payments').send({
      name: 'Phone',
      amount: 200,
      amount_max: 225,
      frequency: 'monthly',
      anchor_date: '2026-01-30',
      day_of_month: -2,
      notes: 'second-last day of the month',
    });
    const id = created.body.payment.id;

    const res = await agent.put(`/api/recurring_payments/${id}`).send({
      name: 'Phone',
      amount: 185,
      frequency: 'monthly',
      anchor_date: '2026-01-30',
      day_of_month: -2,
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.payment.amount, 185);
    assert.equal(res.body.payment.amount_max, null, 'omitted fields are cleared');
    assert.equal(res.body.payment.notes, null);
    assert.equal(res.body.payment.day_of_month, -2);
  });

  it('stops a payment with end_date and restarts it by clearing it', async () => {
    const created = await agent.post('/api/recurring_payments').send({
      name: 'Weekly childcare',
      amount: 300,
      frequency: 'weekly',
      anchor_date: '2026-01-05',
    });
    const { id } = created.body.payment;
    const body = { name: 'Weekly childcare', amount: 300, frequency: 'weekly', anchor_date: '2026-01-05' };

    const stopped = await agent.put(`/api/recurring_payments/${id}`).send({ ...body, end_date: '2026-02-01' });
    assert.equal(stopped.body.payment.status, 'ended');
    assert.equal(stopped.body.payment.next_date, null);

    const restarted = await agent.put(`/api/recurring_payments/${id}`).send({ ...body, end_date: null });
    assert.equal(restarted.body.payment.status, 'active');
    assert.ok(restarted.body.payment.next_date);
  });

  it('returns 404 for unknown ids and 400 for malformed ones', async () => {
    assert.equal((await agent.put('/api/recurring_payments/999999').send(MORTGAGE)).status, 404);
    assert.equal((await agent.delete('/api/recurring_payments/999999')).status, 404);
    assert.equal((await agent.put('/api/recurring_payments/abc').send(MORTGAGE)).status, 400);
    assert.equal((await agent.delete('/api/recurring_payments/1.5')).status, 400);
  });

  it('soft deletes: the row stays in the DB but leaves the list', async () => {
    const created = await agent.post('/api/recurring_payments').send({ ...MORTGAGE, name: 'Old loan' });
    const { id } = created.body.payment;

    const del = await agent.delete(`/api/recurring_payments/${id}`);
    assert.equal(del.status, 200);

    const list = await agent.get('/api/recurring_payments');
    assert.ok(!list.body.payments.some(p => p.id === id));

    const row = await pool.query('SELECT is_active FROM recurring_payments WHERE id = $1', [id]);
    assert.equal(row.rows[0].is_active, false);

    // Deleted payments can't be edited or deleted again
    assert.equal((await agent.put(`/api/recurring_payments/${id}`).send(MORTGAGE)).status, 404);
    assert.equal((await agent.delete(`/api/recurring_payments/${id}`)).status, 404);
  });

  it('applies overrides to the next occurrence', async () => {
    const created = await agent.post('/api/recurring_payments').send({
      name: 'Hydro',
      amount: 230,
      frequency: 'monthly',
      anchor_date: '2026-01-15',
      weekend_rule: 'none',
    });
    const p = created.body.payment;
    // Phase 2 adds override endpoints; insert one directly for now
    const [y, m] = p.next_date.split('-');
    await pool.query(
      `INSERT INTO recurring_payment_overrides (recurring_payment_id, scheduled_date, override_amount)
       VALUES ($1, $2, 312.40)`,
      [p.id, `${y}-${m}-15`]
    );

    const list = await agent.get('/api/recurring_payments');
    const hydro = list.body.payments.find(x => x.id === p.id);
    assert.equal(hydro.next_amount, 312.4);
    assert.equal(hydro.amount, 230, 'the rule amount is unchanged');
  });
});
