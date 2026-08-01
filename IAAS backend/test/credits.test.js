import assert from 'node:assert/strict';
import test from 'node:test';
import { User } from '../src/models/User.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { hasCredits, assertHasCredits, chargeCredit } from '../src/utils/credits.js';

// --- pure helpers ------------------------------------------------------------------------------

test('hasCredits: superadmin is always true, regardless of balance', () => {
  assert.equal(hasCredits({ role: 'superadmin', demoCredits: 0 }), true);
  assert.equal(hasCredits({ role: 'superadmin', demoCredits: 999 }), true);
});

test('hasCredits: non-superadmin is true iff demoCredits > 0', () => {
  assert.equal(hasCredits({ role: 'viewer', demoCredits: 5 }), true);
  assert.equal(hasCredits({ role: 'owner', demoCredits: 0 }), false);
  assert.equal(hasCredits({ role: 'devops' }), false);
});

test('hasCredits: null/undefined user is false', () => {
  assert.equal(hasCredits(null), false);
  assert.equal(hasCredits(undefined), false);
});

test('assertHasCredits: does not throw for superadmin or a positive balance', () => {
  assert.doesNotThrow(() => assertHasCredits({ role: 'superadmin', demoCredits: 0 }));
  assert.doesNotThrow(() => assertHasCredits({ role: 'viewer', demoCredits: 1 }));
});

test('assertHasCredits: throws a 402 ApiError for a zero-balance non-superadmin', () => {
  try {
    assertHasCredits({ role: 'viewer', demoCredits: 0 });
    assert.fail('expected assertHasCredits to throw');
  } catch (error) {
    assert.equal(error.statusCode, 402);
  }
});

// --- chargeCredit: mocked Mongoose calls, no real DB -------------------------------------------

async function withMocks({ findOneAndUpdateResult, findOneAndUpdateError, auditCreateError }, run) {
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const originalAuditCreate = AuditLog.create;

  const calls = { findOneAndUpdate: [], auditCreate: [] };

  User.findOneAndUpdate = (filter, update) => {
    calls.findOneAndUpdate.push({ filter, update });
    return {
      select: async () => {
        if (findOneAndUpdateError) throw findOneAndUpdateError;
        return findOneAndUpdateResult;
      },
    };
  };
  AuditLog.create = async (doc) => {
    calls.auditCreate.push(doc);
    if (auditCreateError) throw auditCreateError;
    return doc;
  };

  try {
    return await run(calls);
  } finally {
    User.findOneAndUpdate = originalFindOneAndUpdate;
    AuditLog.create = originalAuditCreate;
  }
}

test('chargeCredit: on a successful decrement, uses the exact atomic filter/update and writes an audit entry', async () => {
  await withMocks({ findOneAndUpdateResult: { demoCredits: 4 } }, async (calls) => {
    const result = await chargeCredit('user1', { workspace: 'ws1', action: 'deploy', resourceType: 'Deployment', resourceId: 'dep1' });

    assert.deepEqual(result, { charged: true, remaining: 4 });
    assert.equal(calls.findOneAndUpdate.length, 1);
    assert.deepEqual(calls.findOneAndUpdate[0].filter, { _id: 'user1', role: { $ne: 'superadmin' }, demoCredits: { $gt: 0 } });
    assert.deepEqual(calls.findOneAndUpdate[0].update, { $inc: { demoCredits: -1 } });

    assert.equal(calls.auditCreate.length, 1);
    assert.equal(calls.auditCreate[0].action, 'credits.charge.deploy');
    assert.equal(calls.auditCreate[0].resourceType, 'Deployment');
    assert.equal(calls.auditCreate[0].resourceId, 'dep1');
    assert.deepEqual(calls.auditCreate[0].metadata, { remaining: 4 });
  });
});

test('chargeCredit: no-ops (no audit entry) when the update matches nothing — superadmin or already-zero', async () => {
  await withMocks({ findOneAndUpdateResult: null }, async (calls) => {
    const result = await chargeCredit('user1', { workspace: 'ws1', action: 'destroy', resourceType: 'Deployment', resourceId: 'dep1' });

    assert.deepEqual(result, { charged: false, remaining: null });
    assert.equal(calls.auditCreate.length, 0);
  });
});

test('chargeCredit: a failed audit write is swallowed, not propagated — the charge still counts', async () => {
  await withMocks({ findOneAndUpdateResult: { demoCredits: 9 }, auditCreateError: new Error('audit db down') }, async () => {
    const result = await chargeCredit('user1', { workspace: 'ws1', action: 'drift_sync', resourceType: 'Deployment', resourceId: 'dep1' });
    assert.deepEqual(result, { charged: true, remaining: 9 });
  });
});
