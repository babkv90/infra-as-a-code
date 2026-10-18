import assert from 'node:assert/strict';
import test from 'node:test';

const { isAllowedCorsOrigin, corsHeaders } = await import('../src/utils/cors.js');

test('isAllowedCorsOrigin: listed frontends are allowed', () => {
  assert.equal(isAllowedCorsOrigin('https://d3pgg5abvvdatt.cloudfront.net'), true);
  assert.equal(isAllowedCorsOrigin('https://codemanus.in/'), true);
  assert.equal(isAllowedCorsOrigin('http://127.0.0.1:5173'), true);
});

// Every allowed origin gets credentials, and the deployed refresh cookie is SameSite=None — a page
// on someone else's CloudFront/Vercel/API Gateway host must not be able to call /auth/refresh as you.
test('isAllowedCorsOrigin: unlisted hosts on shared platforms are refused', () => {
  assert.equal(isAllowedCorsOrigin('https://attacker.cloudfront.net'), false);
  assert.equal(isAllowedCorsOrigin('https://attacker.vercel.app'), false);
  assert.equal(isAllowedCorsOrigin('https://abc123.execute-api.us-east-1.amazonaws.com'), false);
  assert.equal(corsHeaders('https://attacker.vercel.app')['Access-Control-Allow-Origin'], undefined);
});

test('isAllowedCorsOrigin: requests without an Origin header (same-origin, curl) pass', () => {
  assert.equal(isAllowedCorsOrigin(undefined), true);
});
