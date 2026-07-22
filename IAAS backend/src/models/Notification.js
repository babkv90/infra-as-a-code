import mongoose from 'mongoose';

const notificationSchema = new mongoose.Schema(
  {
    workspace: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    type: { type: String, enum: ['deployment', 'destroy', 'pipeline', 'ticket'], required: true },
    status: { type: String, enum: ['success', 'failed'], required: true },
    title: { type: String, required: true, trim: true },
    message: { type: String, default: '' },
    errorLog: { type: String, default: '' },
    resourceType: { type: String, enum: ['Deployment', 'ApplicationPipeline', 'Ticket'], required: true },
    resourceId: { type: mongoose.Schema.Types.ObjectId, required: true },
    resourceName: { type: String, default: '' },
    read: { type: Boolean, default: false },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

export const Notification = mongoose.model('Notification', notificationSchema);
