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
    // 'chat' is the original one-shot multi-agent Q&A run. 'plan_fix' is the open-ended "make it
    // pass terraform plan" agent loop (services/agentPlanFix.js) — it spans several agent
    // invocations, pausing while each real `terraform plan` runs and resuming on its result.
    kind: { type: String, enum: ['chat', 'plan_fix'], default: 'chat' },
    status: { type: String, enum: ['running', 'completed', 'failed'], default: 'running' },
    route: { type: [String], default: [] },
    steps: { type: [mongoose.Schema.Types.Mixed], default: [] },
    findings: { type: [mongoose.Schema.Types.Mixed], default: [] },
    // A proposed, read-only ChangePlan (M2) — never applied automatically. See
    // services/agents/app/changeplan.py for how it's generated and mechanically validated.
    changePlan: { type: mongoose.Schema.Types.Mixed, default: null },
    // plan_fix runs only. Everything the loop needs to survive between agent invocations: the
    // draft copy of the diagram the agent edits (never the real Diagram until a user applies it),
    // every plan run and its diagnostics, and the agent's own paused conversation. Shape is owned
    // by services/agentPlanFix.js — Mixed because it's rewritten as a whole on every transition.
    fix: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true },
);

export const AgentRun = mongoose.model('AgentRun', agentRunSchema);
