import assert from 'node:assert/strict';
import test from 'node:test';
import { applyChangeItems, normalizePlanDiagnostics, parsePlanJsonLines } from '../src/services/agentPlanFix.js';

function serviceNode(id, serviceId, label, config = {}) {
  return { id, type: 'awsService', position: { x: 100, y: 50 }, data: { serviceId, serviceName: serviceId, label, config } };
}

const DRAFT = {
  nodes: [serviceNode('db-1', 'rds', 'Orders DB', { engine: 'postgres', instance_class: 'db.t3.micro' }), serviceNode('fn-1', 'lambda', 'Api Fn')],
  edges: [{ id: 'edge-1', source: 'fn-1', target: 'db-1', type: 'flowEdge', data: { label: 'data', connectionType: 'data', protocol: 'TCP', port: '5432' } }],
  activeRegion: 'ap-south-1',
};

test('update_node merges config keys, deletes nulls, and never mutates the input draft', () => {
  const { draft, applied, rejected } = applyChangeItems(DRAFT, [
    { op: 'update_node', target: 'db-1', data: { config: { allocated_storage: 20, instance_class: null } }, rationale: 'plan requires storage' },
  ]);

  assert.equal(rejected.length, 0);
  assert.equal(applied.length, 1);
  assert.deepEqual(draft.nodes[0].data.config, { engine: 'postgres', allocated_storage: 20 });
  assert.equal(DRAFT.nodes[0].data.config.instance_class, 'db.t3.micro');
});

test('flat config patches are accepted the same as { config }', () => {
  const { draft } = applyChangeItems(DRAFT, [{ op: 'update_node', target: 'fn-1', data: { runtime: 'python3.12', label: 'API' }, rationale: 'x' }]);
  assert.equal(draft.nodes[1].data.config.runtime, 'python3.12');
  assert.equal(draft.nodes[1].data.label, 'API');
});

test('remove_node is always rejected — deleting the failing resource is not a fix', () => {
  const { draft, applied, rejected } = applyChangeItems(DRAFT, [{ op: 'remove_node', target: 'db-1', rationale: 'plan fails on it' }]);
  assert.equal(applied.length, 0);
  assert.match(rejected[0].reason, /Removing resources isn't allowed/);
  assert.equal(draft.nodes.length, 2);
});

test('sensitive values cannot be invented, but can be cleared', () => {
  const invent = applyChangeItems(DRAFT, [{ op: 'update_node', target: 'db-1', data: { password: 'hunter2' }, rationale: 'required' }]);
  assert.equal(invent.applied.length, 0);
  assert.match(invent.rejected[0].reason, /sensitive/);

  const clear = applyChangeItems(DRAFT, [{ op: 'update_node', target: 'db-1', data: { password: null }, rationale: 'remove literal' }]);
  assert.equal(clear.applied.length, 1);
});

test('bad items are rejected individually without blocking good ones', () => {
  const { applied, rejected } = applyChangeItems(DRAFT, [
    { op: 'update_node', target: 'ghost', data: { a: 1 }, rationale: 'x' },
    { op: 'update_node', target: 'db-1', data: { a: 1 } },
    { op: 'update_node', target: 'db-1', data: { multi_az: false }, rationale: 'x' },
  ]);
  assert.deepEqual(rejected.map((entry) => entry.index), [0, 1]);
  assert.deepEqual(applied.map((entry) => entry.index), [2]);
});

test('add_node uses catalog defaults and returns the new id; unknown services are rejected', () => {
  const { draft, applied, rejected } = applyChangeItems(DRAFT, [
    { op: 'add_node', service_id: 'sqs', data: { label: 'Dead letters' }, rationale: 'x' },
    { op: 'add_node', service_id: 'made-up', rationale: 'x' },
  ]);
  assert.equal(applied[0].createdId, 'agent-sqs');
  assert.equal(rejected[0].index, 1);
  const added = draft.nodes.find((node) => node.id === 'agent-sqs');
  assert.equal(added.data.serviceId, 'sqs');
  assert.equal(added.data.label, 'Dead letters');
  assert.equal(added.position.x, 380);
});

test('add_edge requires real distinct endpoints and no duplicate', () => {
  const { applied, rejected } = applyChangeItems(DRAFT, [
    { op: 'add_edge', data: { source: 'db-1', target: 'fn-1' }, rationale: 'x' },
    { op: 'add_edge', data: { source: 'fn-1', target: 'db-1' }, rationale: 'duplicate' },
    { op: 'add_edge', data: { source: 'fn-1', target: 'ghost' }, rationale: 'x' },
  ]);
  assert.equal(applied.length, 1);
  assert.deepEqual(rejected.map((entry) => entry.index), [1, 2]);
});

test('update_edge only touches whitelisted keys; remove_edge removes', () => {
  const ok = applyChangeItems(DRAFT, [{ op: 'update_edge', target: 'edge-1', data: { port: 3306 }, rationale: 'x' }]);
  assert.equal(ok.draft.edges[0].data.port, '3306');

  const bad = applyChangeItems(DRAFT, [{ op: 'update_edge', target: 'edge-1', data: { source: 'db-1' }, rationale: 'x' }]);
  assert.equal(bad.applied.length, 0);

  const removed = applyChangeItems(DRAFT, [{ op: 'remove_edge', target: 'edge-1', rationale: 'x' }]);
  assert.equal(removed.draft.edges.length, 0);
});

test('parsePlanJsonLines extracts diagnostics and the change summary, skipping noise', () => {
  const output = [
    '{"@level":"info","type":"version","terraform":"1.9.8"}',
    'not json at all',
    '{"@level":"error","type":"diagnostic","diagnostic":{"severity":"error","summary":"Missing required argument","detail":"\\"allocated_storage\\" is required","range":{"filename":"main.tf","start":{"line":12}}}}',
    '{"type":"change_summary","changes":{"add":3,"change":0,"remove":0,"operation":"plan"}}',
  ].join('\n');

  const parsed = parsePlanJsonLines(output);
  assert.equal(parsed.diagnostics.length, 1);
  assert.deepEqual(parsed.changeSummary, { add: 3, change: 0, remove: 0 });
});

test('normalizePlanDiagnostics maps a diagnostic line to its resource block and diagram node', () => {
  const terraform = [
    'provider "aws" {', '  region = "ap-south-1"', '}', '',
    'resource "aws_lambda_function" "api_fn" {', '  function_name = "x"', '}', '',
    'resource "aws_db_instance" "orders_db" {', '  engine = "postgres"', '  instance_class = "db.t3.micro"', '  username = "app"', '}',
  ].join('\n');
  const diagnostics = [
    { severity: 'error', summary: 'Missing required argument', detail: 'allocated_storage is required', range: { start: { line: 11 } } },
    { severity: 'warning', summary: 'Deprecated attribute' },
    { severity: 'error', summary: 'Invalid runtime', address: 'aws_lambda_function.api_fn' },
  ];

  const result = normalizePlanDiagnostics(diagnostics, { terraform, nodes: DRAFT.nodes, suffix: 'abc' });
  assert.equal(result.length, 2);
  assert.equal(result[0].address, 'aws_db_instance.orders_db');
  assert.equal(result[0].nodeId, 'db-1');
  assert.equal(result[1].nodeId, 'fn-1');
});

// The gates below must hold before anything is saved — these fake runs have no database behind
// them, so a gate that let a request through would throw on save().
function fakeRun(fixOverrides = {}) {
  return {
    steps: [],
    fix: {
      revision: 2,
      planRuns: [],
      appliedChanges: [],
      limits: { maxPlanRuns: 3, maxChangeItems: 40, maxAgentTurns: 40 },
      agent: { messages: [], pendingToolCallId: null, turns: 0 },
      ...fixOverrides,
    },
    markModified() {},
    async save() {
      throw new Error('gate let the request through to save()');
    },
  };
}

test('finish "passed" is rejected without a passing plan on the current revision', async () => {
  const { finishPlanFix } = await import('../src/services/agentPlanFix.js');

  const noPlan = await finishPlanFix(fakeRun(), { outcome: 'passed', summary: 'done' });
  assert.equal(noPlan.accepted, false);

  const failed = await finishPlanFix(fakeRun({ planRuns: [{ index: 0, revision: 2, status: 'failed' }] }), { outcome: 'passed', summary: 'done' });
  assert.equal(failed.accepted, false);

  const stale = await finishPlanFix(fakeRun({ planRuns: [{ index: 0, revision: 1, status: 'passed' }] }), { outcome: 'passed', summary: 'done' });
  assert.equal(stale.accepted, false);
  assert.match(stale.reason, /changed/);
});

test('plan requests are refused when over budget, already running, or nothing changed', async () => {
  const { requestPlanRun } = await import('../src/services/agentPlanFix.js');
  const args = { messages: [], toolCallId: 'call_1', turns: 3 };

  const overBudget = fakeRun({ planRuns: [0, 1, 2].map((index) => ({ index, revision: index, status: 'failed' })) });
  assert.match((await requestPlanRun(overBudget, args)).error, /budget exhausted/);

  const running = fakeRun({ planRuns: [{ index: 0, revision: 1, status: 'running' }] });
  assert.match((await requestPlanRun(running, args)).error, /already running/);

  const unchanged = fakeRun({ planRuns: [{ index: 0, revision: 2, status: 'failed' }] });
  assert.match((await requestPlanRun(unchanged, args)).error, /Nothing changed/);
});

test('a batch that would exceed the change budget is rejected whole', async () => {
  const { recordAgentChanges } = await import('../src/services/agentPlanFix.js');
  const run = fakeRun({ appliedChanges: Array.from({ length: 39 }, () => ({})), limits: { maxPlanRuns: 3, maxChangeItems: 40, maxAgentTurns: 40 } });
  run.fix.draft = DRAFT;
  run.fix.diagramId = 'abc';

  const result = await recordAgentChanges(run, [
    { op: 'update_node', target: 'db-1', data: { a: 1 }, rationale: 'x' },
    { op: 'update_node', target: 'db-1', data: { b: 1 }, rationale: 'x' },
  ]);
  assert.equal(result.applied.length, 0);
  assert.equal(result.rejected.length, 2);
  assert.match(result.rejected[0].reason, /budget/);
});
