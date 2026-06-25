import mongoose from 'mongoose';

const deploymentSchema = new mongoose.Schema(
  {
    workspace: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    diagram: { type: mongoose.Schema.Types.ObjectId, ref: 'Diagram', required: true },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    awsAccount: { type: mongoose.Schema.Types.ObjectId, ref: 'AwsAccount' },
    name: { type: String, required: true, trim: true },
    status: {
      type: String,
      enum: ['draft', 'validating', 'planned', 'approval_required', 'queued', 'deploying', 'deployed', 'destroying', 'destroyed', 'failed', 'cancelled'],
      default: 'draft',
    },
    resourceCount: { type: Number, default: 0 },
    connectionCount: { type: Number, default: 0 },
    plan: { type: mongoose.Schema.Types.Mixed, default: {} },
    terraform: { type: String, default: '' },
    terraformWorkDir: { type: String, default: '' },
    validationIssues: { type: [mongoose.Schema.Types.Mixed], default: [] },
    startedAt: Date,
    finishedAt: Date,
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
