import mongoose from 'mongoose';

// One document per multi-agent run — the browser polls GET /agent/runs/:id/status against this,
// and the Python service (services/agents) is the only writer, via the authenticated callbacks in
// internalAgentToolsController.js's postRunStep/postRunComplete. Mongo's own _id doubles as the
// runId embedded in the machine JWT (agentIdentity.js) — no separate id scheme.
const agentRunSchema = new mongoose.Schema(
  {
    workspace: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    conversation: { type: mongoose.Schema.Types.ObjectId, ref: 'AgentConversation', required: true, index: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, enum: ['running', 'completed', 'failed'], default: 'running' },
    route: { type: [String], default: [] },
    steps: { type: [mongoose.Schema.Types.Mixed], default: [] },
    findings: { type: [mongoose.Schema.Types.Mixed], default: [] },
  },
  { timestamps: true },
);

export const AgentRun = mongoose.model('AgentRun', agentRunSchema);
