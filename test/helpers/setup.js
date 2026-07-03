// Test environment bootstrap.
//
// This module MUST be required before server.js. It pins every required
// environment variable to a test-safe value *before* dotenv runs — dotenv
// never overrides variables that are already set, so values from .env
// (real database, real Plaid credentials) can never leak into a test run.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL || 'postgresql://localhost/balance_tracker_test';
process.env.SESSION_SECRET = 'test-session-secret';
process.env.DB_ENCRYPTION_KEY = 'test-encryption-key';
process.env.PLAID_CLIENT_ID = 'test-plaid-client-id';
process.env.PLAID_SECRET = 'test-plaid-secret';
process.env.PLAID_ENV = 'sandbox';
process.env.ALLOWED_ORIGIN = 'http://localhost:3000';

if (!process.env.DATABASE_URL.includes('test')) {
  throw new Error(
    `Refusing to run tests against non-test database: ${process.env.DATABASE_URL}`
  );
}

const { app, refreshBalances } = require('../../server');

module.exports = { app, refreshBalances };
