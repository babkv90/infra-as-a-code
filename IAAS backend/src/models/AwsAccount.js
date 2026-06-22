import mongoose from 'mongoose';

const awsAccountSchema = new mongoose.Schema(
  {
    workspace: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true, trim: true },
    accountId: { type: String, required: true, trim: true },
    roleArn: { type: String, required: true, trim: true },
    externalId: { type: String, trim: true },
    defaultRegion: { type: String, default: 'ap-south-1' },
    status: { type: String, enum: ['pending', 'connected', 'failed'], default: 'pending' },
    lastSyncAt: Date,
    lastError: String,
    syncSummary: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

awsAccountSchema.index({ workspace: 1, accountId: 1 }, { unique: true });

export const AwsAccount = mongoose.model('AwsAccount', awsAccountSchema);
