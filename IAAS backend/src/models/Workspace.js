import mongoose from 'mongoose';

const workspaceSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    plan: { type: String, enum: ['demo', 'free', 'pro', 'enterprise'], default: 'free' },
    settings: {
      defaultRegion: { type: String, default: 'ap-south-1' },
      deploymentMode: { type: String, enum: ['plan-only', 'manual-approval', 'auto-apply'], default: 'manual-approval' },
    },
  },
  { timestamps: true },
);

export const Workspace = mongoose.model('Workspace', workspaceSchema);
