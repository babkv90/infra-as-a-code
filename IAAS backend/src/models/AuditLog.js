import mongoose from 'mongoose';

const auditLogSchema = new mongoose.Schema(
  {
    workspace: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', index: true },
    actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    action: { type: String, required: true },
    resourceType: { type: String, required: true },
    resourceId: String,
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    ip: String,
  },
  { timestamps: true },
);

export const AuditLog = mongoose.model('AuditLog', auditLogSchema);
