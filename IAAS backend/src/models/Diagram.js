import mongoose from 'mongoose';

const diagramSchema = new mongoose.Schema(
  {
    workspace: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    activeRegion: { type: String, default: 'ap-south-1' },
    nodes: { type: [mongoose.Schema.Types.Mixed], default: [] },
    edges: { type: [mongoose.Schema.Types.Mixed], default: [] },
    config: { type: mongoose.Schema.Types.Mixed, default: {} },
    tags: { type: [String], default: [] },
    lastValidatedAt: Date,
    validationIssues: { type: [mongoose.Schema.Types.Mixed], default: [] },
  },
  { timestamps: true },
);

export const Diagram = mongoose.model('Diagram', diagramSchema);
