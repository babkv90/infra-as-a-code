import mongoose from 'mongoose';

// Technical backlog item, often surfaced by a change log entry (identifiedDuring links back to it).
// The inverse link lives on ChangeLogEntry.relatedBacklogItems, so the two can be navigated in both
// directions.
const backlogItemSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 160 },
    description: { type: String, default: '' },
    severity: { type: String, enum: ['critical', 'high', 'medium', 'low'], required: true },
    status: { type: String, enum: ['open', 'in-progress', 'resolved', 'wontfix'], default: 'open' },
    identifiedDuring: { type: mongoose.Schema.Types.ObjectId, ref: 'ChangeLogEntry' },
    // Free text on purpose ("before scale-up", "next sprint", "nice-to-have") — a fixed enum would
    // fight the informal way phases actually get named.
    targetPhase: { type: String, default: '' },
    author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

export const BacklogItem = mongoose.model('BacklogItem', backlogItemSchema);
