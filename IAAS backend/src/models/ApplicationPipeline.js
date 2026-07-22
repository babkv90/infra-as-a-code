import mongoose from 'mongoose';

const generatedFileSchema = new mongoose.Schema(
  {
    path: { type: String, required: true },
    content: { type: String, required: true },
    language: { type: String, default: 'text' },
    purpose: { type: String, default: '' },
  },
  { _id: false },
);

const applicationPipelineSchema = new mongoose.Schema(
  {
    workspace: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    deployment: { type: mongoose.Schema.Types.ObjectId, ref: 'Deployment' },
    name: { type: String, required: true, trim: true },
    appType: {
      type: String,
      enum: ['react-app', 'static-spa', 'node-container', 'python-api', 'java-service', 'serverless-api', 'kubernetes-service'],
      default: 'react-app',
    },
    environment: {
      type: String,
      enum: ['development', 'staging', 'production'],
      default: 'development',
      index: true,
    },
    repository: {
      provider: { type: String, enum: ['github'], default: 'github' },
      url: { type: String, default: '' },
      branch: { type: String, default: 'main' },
      workflowPath: { type: String, default: '.github/workflows/infraflow-development-deploy.yml' },
      lastSyncedAt: Date,
      lastSyncCommit: { type: String, default: '' },
    },
    commands: {
      install: { type: String, default: 'npm ci' },
      test: { type: String, default: 'npm test -- --watch=false' },
      build: { type: String, default: 'npm run build' },
      start: { type: String, default: 'npm start' },
    },
    target: {
      type: { type: String, default: 'ecs' },
      region: { type: String, default: 'ap-south-1' },
      ecrRepository: { type: String, default: '' },
      serviceName: { type: String, default: '' },
      clusterName: { type: String, default: '' },
      bucketName: { type: String, default: '' },
      lambdaFunctionName: { type: String, default: '' },
      namespace: { type: String, default: 'default' },
    },
    generatedFiles: { type: [generatedFileSchema], default: [] },
    checklist: { type: [String], default: [] },
    status: { type: String, enum: ['draft', 'ready'], default: 'ready' },
    awsDeployRole: {
      arn: { type: String, default: '' },
      roleName: { type: String, default: '' },
      status: { type: String, enum: ['unprovisioned', 'provisioned', 'failed', 'skipped'], default: 'unprovisioned' },
      error: { type: String, default: '' },
      provisionedAt: Date,
    },
  },
  { timestamps: true },
);

export const ApplicationPipeline = mongoose.model('ApplicationPipeline', applicationPipelineSchema);
