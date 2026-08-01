import assert from 'node:assert/strict';
import test from 'node:test';
import { Deployment } from '../src/models/Deployment.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { revealDeploymentOutputSecret } from '../src/controllers/deploymentSecretController.js';
import { redactOutputsForResponse } from '../src/utils/secretRedaction.js';
import { resolveServiceId, sensitiveKeysForServiceId } from '../src/utils/sensitiveOutputKeys.js';

// --- masking behavior (redactOutputsForResponse) ---------------------------------------------

test('redacts sensitive fields already migrated to Secrets Manager into a reveal-path marker', () => {
  const outputs = {
    web_server: {
      label: 'Web server',
      service: 'EC2',
      service_id: 'ec2',
      id: 'i-123',
      arn: 'arn:aws:ec2:...:instance/i-123',
      ssh_private_key_pem: { __secretRef: true },
    },
  };
  const secretRefs = { web_server: { ssh_private_key_pem: { arn: 'arn:aws:secretsmanager:...:secret:foo' } } };

  const redacted = redactOutputsForResponse(outputs, secretRefs, '/deployments/abc/secrets');

  // Non-sensitive fields pass through untouched.
  assert.equal(redacted.web_server.id, 'i-123');
  assert.equal(redacted.web_server.arn, 'arn:aws:ec2:...:instance/i-123');
  // Sensitive field never carries a value — only a reveal path the broker endpoint resolves.
  assert.deepEqual(redacted.web_server.ssh_private_key_pem, {
    __secretPlaceholder: true,
    revealPath: '/deployments/abc/secrets/output/web_server/ssh_private_key_pem',
  });
});

test('masks legacy plaintext sensitive values with no reveal path when there is no secretRefs entry', () => {
  const outputs = { db: { service: 'RDS', service_id: 'rds', endpoint: 'db.example.rds.amazonaws.com:5432', address: 'db.example' } };

  const redacted = redactOutputsForResponse(outputs, {}, '/deployments/abc/secrets');

  assert.deepEqual(redacted.db.endpoint, { __secretPlaceholder: true, revealPath: null });
  assert.deepEqual(redacted.db.address, { __secretPlaceholder: true, revealPath: null });
});

test('does not redact a same-named field on a service not in the sensitive list (e.g. eks.endpoint)', () => {
  const outputs = { cluster: { service: 'EKS', service_id: 'eks', endpoint: 'https://eks.example.amazonaws.com', arn: 'arn:aws:eks:...' } };

  const redacted = redactOutputsForResponse(outputs, {}, '/deployments/abc/secrets');

  assert.equal(redacted.cluster.endpoint, 'https://eks.example.amazonaws.com');
});

test('resolveServiceId falls back to the display-name map for output groups captured before service_id existed', () => {
  assert.equal(resolveServiceId({ service: 'RDS' }), 'rds');
  assert.equal(resolveServiceId({ service: 'DocumentDB Cluster' }), 'docdb');
  assert.equal(resolveServiceId({ service_id: 'redshift', service: 'Redshift' }), 'redshift');
  assert.equal(resolveServiceId({ service: 'Some Unknown Thing' }), undefined);
});

test('sensitiveKeysForServiceId returns [] for services with no sensitive output fields', () => {
  assert.deepEqual(sensitiveKeysForServiceId('s3'), []);
  assert.deepEqual(sensitiveKeysForServiceId('ec2'), ['ssh_private_key_pem']);
});

// --- broker endpoint: auth/ownership (revealDeploymentOutputSecret) --------------------------
// Deployment.findOne/AuditLog.create are Mongoose model statics — swapped out for the duration of
// each test (restored in `finally`) since there's no test database wired up in this repo yet
// (see test/diagramSchema.test.js for the same pure-function-only pattern this file extends).
// asyncHandler (src/utils/asyncHandler.js) never throws/rejects itself — it always resolves and
// forwards failures to `next(error)`, so every case below is asserted through the `next` spy.

function fakeRes() {
  return {
    statusCode: 200,
    body: undefined,
    json(payload) {
      this.body = payload;
    },
  };
}

// asyncHandler's wrapper (src/utils/asyncHandler.js) is fire-and-forget: it does
// `Promise.resolve(fn(...)).catch(next)` without returning that promise, so `await`ing the handler's
// own return value resolves immediately — before the controller's actual async body (and any
// next(error) call) has run. Waiting on next()/res.json() directly, not the handler's return value,
// is what actually observes the outcome.
function invokeHandler(handler, req, res) {
  return new Promise((resolve) => {
    const originalJson = res.json.bind(res);
    res.json = (payload) => {
      originalJson(payload);
      resolve({ type: 'json', payload });
    };
    void handler(req, res, (error) => resolve({ type: 'next', error }));
  });
}

async function withMocks({ findOneResult, auditLogCalls = [] }, run) {
  const originalFindOne = Deployment.findOne;
  const originalAuditCreate = AuditLog.create;
  Deployment.findOne = async (query) => {
    auditLogCalls.lastFindOneQuery = query;
    return findOneResult;
  };
  AuditLog.create = async (doc) => {
    auditLogCalls.push(doc);
    return doc;
  };
  try {
    await run();
  } finally {
    Deployment.findOne = originalFindOne;
    AuditLog.create = originalAuditCreate;
  }
}

test('reveal broker 404s (does not leak whether the id exists) when the deployment is not owned by the caller workspace', async () => {
  const calls = [];
  await withMocks({ findOneResult: null, auditLogCalls: calls }, async () => {
    const req = { params: { id: 'dep1', resourceKey: 'web_server', fieldKey: 'ssh_private_key_pem' }, user: { _id: 'user1', workspace: 'workspace1' } };
    const res = fakeRes();
    const result = await invokeHandler(revealDeploymentOutputSecret, req, res);

    assert.equal(result.type, 'next');
    assert.equal(result.error?.statusCode, 404);
    // The ownership check is the query itself — scoped to the caller's workspace, same as every
    // other deployment route (getDeployment, etc.).
    assert.deepEqual(calls.lastFindOneQuery, { _id: 'dep1', workspace: 'workspace1' });
  });
});

test('reveal broker 404s when the deployment exists but has no secretRefs entry for that field', async () => {
  const calls = [];
  const deployment = { _id: 'dep1', secretRefs: {} };
  await withMocks({ findOneResult: deployment, auditLogCalls: calls }, async () => {
    const req = { params: { id: 'dep1', resourceKey: 'web_server', fieldKey: 'ssh_private_key_pem' }, user: { _id: 'user1', workspace: 'workspace1' } };
    const res = fakeRes();
    const result = await invokeHandler(revealDeploymentOutputSecret, req, res);

    assert.equal(result.type, 'next');
    assert.equal(result.error?.statusCode, 404);
  });
});

test('reveal broker returns a clear 502 (not a crash) when Secrets Manager is unreachable/disabled, and audits the failed attempt', async () => {
  const calls = [];
  const deployment = { _id: 'dep1', secretRefs: { web_server: { ssh_private_key_pem: { arn: 'arn:aws:secretsmanager:us-east-1:1:secret:x' } } } };
  await withMocks({ findOneResult: deployment, auditLogCalls: calls }, async () => {
    const req = { params: { id: 'dep1', resourceKey: 'web_server', fieldKey: 'ssh_private_key_pem' }, user: { _id: 'user1', workspace: 'workspace1' } };
    const res = fakeRes();
    const result = await invokeHandler(revealDeploymentOutputSecret, req, res);

    assert.equal(result.type, 'next');
    assert.equal(result.error?.statusCode, 502);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].action, 'deployment.secret_reveal_failed');
  });
});
