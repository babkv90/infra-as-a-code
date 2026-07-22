import mongoose from 'mongoose';

const githubConnectionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
    githubId: { type: String, required: true, index: true },
    githubUsername: { type: String, required: true, trim: true },
    githubName: { type: String, default: '' },
    avatarUrl: { type: String, default: '' },
    scopes: { type: [String], default: [] },
    accessTokenEncrypted: { type: String, required: true, select: false },
    connectedAt: { type: Date, default: Date.now },
    lastUsedAt: Date,
  },
  { timestamps: true },
);

githubConnectionSchema.methods.toSafeProfile = function toSafeProfile() {
  return {
    connected: true,
    githubId: this.githubId,
    login: this.githubUsername,
    username: this.githubUsername,
    name: this.githubName,
    avatarUrl: this.avatarUrl,
    scopes: this.scopes,
    connectedAt: this.connectedAt,
  };
};

export const GitHubConnection = mongoose.model('GitHubConnection', githubConnectionSchema);
