import mongoose from 'mongoose';

// Human-authored record of a major architecture change over the project's lifecycle. Deliberately
// separate from AuditLog: AuditLog captures auto-generated machine events (role changes, credit
// grants), while this is narrative content with an impact rating and links to backlog items. The
// category enum is drawn from this project's own history (storage-adapter work, the local -> GitHub
// Actions runner migration, the Terraform validation pipeline, restart reconciliation) rather than a
// generic list.
const CATEGORIES = ['architecture', 'storage', 'execution-pipeline', 'validation', 'reliability', 'performance', 'security', 'ui-ux'];

const changeLogEntrySchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 160 },
    description: { type: String, default: '' },
    category: { type: String, enum: CATEGORIES, required: true },
    direction: { type: String, enum: ['positive', 'negative', 'neutral'], required: true },
    // Magnitude of the change's effect, independent of direction (a big regression and a big
    // improvement both rate 5).
    impactRating: { type: Number, min: 1, max: 5, required: true },
    occurredAt: { type: Date, default: Date.now },
    author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    relatedBacklogItems: [{ type: mongoose.Schema.Types.ObjectId, ref: 'BacklogItem' }],
    // The first three metrics are computed from live Deployment data at creation time (so they're
    // real, not typed-in guesses); diskUsageMb is optional/manual since nothing persists it.
    performanceSnapshot: {
      deploymentSuccessRate: Number,
      avgDeployTimeSec: Number,
      totalDeployments: Number,
      diskUsageMb: Number,
      capturedAt: Date,
    },
  },
  { timestamps: true },
);

export const CHANGE_LOG_CATEGORIES = CATEGORIES;
export const ChangeLogEntry = mongoose.model('ChangeLogEntry', changeLogEntrySchema);
