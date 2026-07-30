import mongoose from 'mongoose';

const deploymentSchema = new mongoose.Schema(
  {
    workspace: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    diagram: { type: mongoose.Schema.Types.ObjectId, ref: 'Diagram', required: true },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    awsAccount: { type: mongoose.Schema.Types.ObjectId, ref: 'AwsAccount' },
    name: { type: String, required: true, trim: true },
    // Set once, at creation, from env.DEPLOYMENT_EXECUTOR — never re-derived afterward. A deployment
    // is executed by whichever runner it was created with for its entire lifecycle (including future
    // updates/destroys), even if the platform default later changes. This is what makes flipping the
    // default safe: it only ever affects deployments created after the flip, never retroactively
    // moves an existing deployment (and its local Terraform state) onto a different executor.
    executor: { type: String, enum: ['local', 'github-actions'], default: 'local' },
    status: {
      type: String,
      // 'merged' is terminal and only ever reached by a SOURCE deployment consumed by a merge (see
      // mergeDeploymentFromCanvas in deploymentController.js): its nodes were copied into another
      // deployment's diagram and it must never be independently applied/updated/destroyed again,
      // since it was never actually applied to AWS itself (only pre-apply deployments are eligible
      // as a merge source) and doing so would create duplicate resources for the same nodes.
      enum: ['draft', 'validating', 'planned', 'approval_required', 'queued', 'deploying', 'deployed', 'destroying', 'destroyed', 'failed', 'cancelled', 'merged'],
      default: 'draft',
    },
    // Set once a deployment is consumed as a merge source. Points at the deployment whose diagram
    // now contains this deployment's (remapped) nodes. Purely informational/audit — the actual lock
    // is the 'merged' status.
    mergedInto: { type: mongoose.Schema.Types.ObjectId, ref: 'Deployment' },
    resourceCount: { type: Number, default: 0 },
    connectionCount: { type: Number, default: 0 },
    plan: { type: mongoose.Schema.Types.Mixed, default: {} },
    terraform: { type: String, default: '' },
    terraformWorkDir: { type: String, default: '' },
    lambdaZipUploadIds: { type: [String], default: [] },
    outputs: { type: mongoose.Schema.Types.Mixed, default: {} },
    drift: {
      checkedAt: Date,
      status: { type: String, enum: ['unknown', 'in_sync', 'drifted', 'error'], default: 'unknown' },
      summary: {
        total: { type: Number, default: 0 },
        changed: { type: Number, default: 0 },
        updated: { type: Number, default: 0 },
        deleted: { type: Number, default: 0 },
        replaced: { type: Number, default: 0 },
        created: { type: Number, default: 0 },
        noOp: { type: Number, default: 0 },
      },
      resources: { type: [mongoose.Schema.Types.Mixed], default: [] },
      region: String,
      unmanagedResourceNote: String,
      message: String,
      error: String,
    },
    validationIssues: { type: [mongoose.Schema.Types.Mixed], default: [] },
    startedAt: Date,
    finishedAt: Date,
    // Latest result reported by terraform-deploy.yml's callback step for the github-actions executor
    // (see terraformDeployCallbackController.js / githubTerraformRunner.js). Persisted here rather
    // than held in the backend process's memory so a callback that arrives while the backend happens
    // to be mid-restart isn't lost, and so the poll loop picking this back up after a restart reads
    // the same durable source any other process/instance would. runId is checked by the reader on
    // every poll so a stale value left over from a previous run is never mistaken for the current one.
    githubRun: {
      runId: String,
      action: { type: String, enum: ['apply', 'destroy'] },
      outcome: { type: String, enum: ['success', 'failure'] },
      outputs: mongoose.Schema.Types.Mixed,
      hasState: Boolean,
      logExcerpt: String,
      receivedAt: Date,
    },
    // Set the moment a run actually starts (status flips to deploying/destroying), cleared the moment
    // it reaches a terminal outcome. Exists so a backend restart can be recovered from instead of
    // leaving a deployment stuck forever — see deploymentReconciliation.js, run once at server
    // startup: any deployment still in an active status when the process boots fresh was, by
    // definition, interrupted (no in-flight async work survives a restart), and this is what
    // reconciliation needs to know to handle it correctly — isUpdate specifically, since an update
    // failure must never trigger auto-destroy of infrastructure that was working before it started.
    activeRun: {
      action: { type: String, enum: ['apply', 'destroy'] },
      isUpdate: Boolean,
      githubRunId: String,
      startedAt: Date,
    },
    logs: {
      type: [
        {
          message: String,
          level: { type: String, enum: ['info', 'warning', 'error'], default: 'info' },
          at: { type: Date, default: Date.now },
        },
      ],
      default: [],
    },
  },
  { timestamps: true },
);

export const Deployment = mongoose.model('Deployment', deploymentSchema);
