import assert from 'node:assert/strict';
import test from 'node:test';
import { Deployment } from '../src/models/Deployment.js';
import { AwsAccount } from '../src/models/AwsAccount.js';
import { Diagram } from '../src/models/Diagram.js';
import { acceptDeploymentDrift, addressToNodeLookup, buildDeploymentDriftResult, diffResourceAttributes } from '../src/services/terraformDeploymentRunner.js';

// --- pure helpers ------------------------------------------------------------------------------

test('diffResourceAttributes only reports keys whose value actually changed', () => {
  const changes = diffResourceAttributes({ instance_type: 't3.micro', ami: 'ami-1', tags: { a: 1 } }, { instance_type: 't3.large', ami: 'ami-1', tags: { a: 1 } });
  assert.deepEqual(changes, [{ field: 'instance_type', before: 't3.micro', after: 't3.large' }]);
});

test('diffResourceAttributes handles fields only present on one side (created/deleted attrs)', () => {
  const changes = diffResourceAttributes({ a: 1 }, { a: 1, b: 2 });
  assert.deepEqual(changes, [{ field: 'b', before: null, after: 2 }]);
});

test('diffResourceAttributes returns [] when before/after are missing (create/delete-only drift)', () => {
  assert.deepEqual(diffResourceAttributes(null, { a: 1 }), []);
  assert.deepEqual(diffResourceAttributes({ a: 1 }, null), []);
});

test('addressToNodeLookup maps terraform_address -> {nodeId, label} from deployment.outputs', () => {
  const outputs = {
    web_server: { label: 'Web server', terraform_address: 'aws_instance.web_server', node_id: 'node-1' },
    not_a_resource: { label: 'no address here' },
  };
  const lookup = addressToNodeLookup(outputs);
  assert.deepEqual(lookup, { 'aws_instance.web_server': { nodeId: 'node-1', label: 'Web server' } });
});

test('buildDeploymentDriftResult enriches each resource_drift entry with changes + nodeId, without altering existing fields', () => {
  const planJson = {
    resource_drift: [
      {
        address: 'aws_instance.web_server',
        type: 'aws_instance',
        name: 'web_server',
        provider_name: 'registry.terraform.io/hashicorp/aws',
        change: { actions: ['update'], before: { instance_type: 't3.micro' }, after: { instance_type: 't3.large' } },
      },
    ],
  };
  const outputs = { web_server: { label: 'Web server', terraform_address: 'aws_instance.web_server', node_id: 'node-1' } };

  const result = buildDeploymentDriftResult(planJson, 'ap-south-1', new Date('2026-01-01'), outputs);

  assert.equal(result.status, 'drifted');
  assert.equal(result.summary.changed, 1);
  assert.equal(result.resources.length, 1);
  const [resource] = result.resources;
  assert.equal(resource.address, 'aws_instance.web_server');
  assert.equal(resource.status, 'updated');
  assert.equal(resource.nodeId, 'node-1');
  assert.equal(resource.label, 'Web server');
  assert.deepEqual(resource.changes, [{ field: 'instance_type', before: 't3.micro', after: 't3.large' }]);
});

test('buildDeploymentDriftResult still works with no outputs passed (nodeId/label simply absent)', () => {
  const planJson = { resource_drift: [{ address: 'aws_s3_bucket.x', change: { actions: ['no-op'] } }] };
  const result = buildDeploymentDriftResult(planJson, 'ap-south-1', new Date());
  assert.equal(result.status, 'in_sync');
  assert.equal(result.resources[0].nodeId, undefined);
});

// --- acceptDeploymentDrift: paths reachable without a real Terraform/AWS call ------------------

async function withMocks({ deploymentDoc, awsAccountDoc, diagramDoc }, run) {
  const originalDeploymentFindById = Deployment.findById;
  const originalAwsAccountFindById = AwsAccount.findById;
  const originalDiagramFindById = Diagram.findById;

  // Mongoose's real findById(id) returns a thenable Query, not a Promise directly — chaining
  // .populate() on it before awaiting is what the real code does, so the mock has to support that
  // same shape: a plain object (not yet a Promise) whose .populate() resolves to the doc.
  Deployment.findById = () => ({
    populate: async () => ({ ...deploymentDoc }),
  });
  AwsAccount.findById = async () => awsAccountDoc;
  Diagram.findById = async () => diagramDoc;

  try {
    await run();
  } finally {
    Deployment.findById = originalDeploymentFindById;
    AwsAccount.findById = originalAwsAccountFindById;
    Diagram.findById = originalDiagramFindById;
  }
}

test('acceptDeploymentDrift refuses to run on a Lambda-hosted backend, before touching any model', async () => {
  const original = process.env.AWS_LAMBDA_FUNCTION_NAME;
  process.env.AWS_LAMBDA_FUNCTION_NAME = 'infraflow-test-fn';
  let findByIdCalled = false;
  const originalFindById = Deployment.findById;
  Deployment.findById = async () => {
    findByIdCalled = true;
    return null;
  };
  try {
    await assert.rejects(() => acceptDeploymentDrift('dep1', [{ nodeId: 'node-1', fields: ['instance_type'] }], 'user1'), /Lambda-hosted backend/);
    assert.equal(findByIdCalled, false);
  } finally {
    Deployment.findById = originalFindById;
    if (original === undefined) delete process.env.AWS_LAMBDA_FUNCTION_NAME;
    else process.env.AWS_LAMBDA_FUNCTION_NAME = original;
  }
});

test('acceptDeploymentDrift rejects when no drift has been synced yet', async () => {
  await withMocks(
    {
      deploymentDoc: { _id: 'dep1', awsAccount: 'acc1', terraform: 'resource "x" {}', drift: undefined },
      awsAccountDoc: { _id: 'acc1', defaultRegion: 'ap-south-1' },
      diagramDoc: { nodes: [] },
    },
    async () => {
      await assert.rejects(() => acceptDeploymentDrift('dep1', [{ nodeId: 'node-1', fields: ['instance_type'] }], 'user1'), /Sync AWS drift.*first/);
    },
  );
});

test('acceptDeploymentDrift rejects a field that is not already a tracked key in the node\'s config (the safety filter)', async () => {
  await withMocks(
    {
      deploymentDoc: {
        _id: 'dep1',
        awsAccount: 'acc1',
        terraform: 'resource "aws_instance" "web_server" {}',
        drift: {
          resources: [
            {
              address: 'aws_instance.web_server',
              nodeId: 'node-1',
              changes: [{ field: 'instance_type', before: 't3.micro', after: 't3.large' }],
            },
          ],
        },
      },
      awsAccountDoc: { _id: 'acc1', defaultRegion: 'ap-south-1' },
      // Node's config does NOT have `instance_type` as a key — e.g. it was left blank/unset —
      // so the safety filter must reject it even though the drift data has a value for it.
      diagramDoc: { nodes: [{ id: 'node-1', data: { label: 'Web server', config: { ami: 'ami-1' } } }] },
    },
    async () => {
      await assert.rejects(() => acceptDeploymentDrift('dep1', [{ nodeId: 'node-1', fields: ['instance_type'] }], 'user1'), /None of the selected fields could be accepted/);
    },
  );
});
