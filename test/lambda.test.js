// Lambda adapter tests: requests go through lambda.js (serverless-express)
// exactly as API Gateway delivers them in production. supertest can't catch
// these bugs because it uses a real socket — Express's built-in finalhandler
// only crashes ("ee.on is not a function") under serverless-express.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

require('./helpers/setup');
const { handler } = require('../lambda');

// Minimal API Gateway HTTP API (payload format 2.0) event
function httpEvent(method, path, { body, headers = {} } = {}) {
  return {
    version: '2.0',
    routeKey: '$default',
    rawPath: path,
    rawQueryString: '',
    headers: {
      host: 'app.example.com',
      'x-forwarded-proto': 'https',
      'x-forwarded-for': '203.0.113.10',
      ...headers,
    },
    requestContext: {
      http: { method, path, protocol: 'HTTP/1.1', sourceIp: '203.0.113.10', userAgent: 'test' },
      requestId: 'test-request',
      routeKey: '$default',
      stage: '$default',
      domainName: 'app.example.com',
      timeEpoch: Date.now(),
    },
    body,
    isBase64Encoded: false,
  };
}

describe('bot probes get clean responses under Lambda', () => {
  const probes = [
    ['GET', '/.env', 404],
    ['GET', '/wp-login.php', 404],
    ['POST', '/xmlrpc.php', 404, { body: '<methodCall/>', headers: { 'content-type': 'text/xml' } }],
    ['POST', '/wp-login.php', 404, { body: 'log=admin&pwd=x', headers: { 'content-type': 'application/x-www-form-urlencoded' } }],
    ['GET', '/api/accounts', 403, { headers: { origin: 'https://evil.example' } }],
    ['POST', '/api/login', 400, { body: '{not json', headers: { 'content-type': 'application/json' } }],
  ];

  for (const [method, path, expected, opts] of probes) {
    it(`${method} ${path} -> ${expected}`, async () => {
      const res = await handler(httpEvent(method, path, opts), {});
      assert.equal(res.statusCode, expected);
      assert.doesNotMatch(String(res.body), /ee\.on|TypeError/);
    });
  }
});
