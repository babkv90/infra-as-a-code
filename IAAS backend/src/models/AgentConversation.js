// One document per AI Cloud Agent chat thread — what AgentPage.tsx renders as the message list.
// `context` pins the thread to the diagram/AWS account it was opened against, so every agent run
// launched from it (see agentController.js, utils/agentBridge.js) grounds on the same diagram.
// `messages` is the full transcript, both user turns and assistant replies appended by
// internalAgentToolsController.js's postRunComplete once a run finishes.
import mongoose from 'mongoose';

const agentConversationSchema = new mongoose.Schema(
  {
    workspace: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, default: 'New cloud agent conversation' },
    context: {
      diagram: { type: mongoose.Schema.Types.ObjectId, ref: 'Diagram' },
      awsAccount: { type: mongoose.Schema.Types.ObjectId, ref: 'AwsAccount' },
    },
    messages: {
      type: [
        {
          role: { type: String, enum: ['user', 'assistant', 'system'], required: true },
          content: { type: String, required: true },
          metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
          createdAt: { type: Date, default: Date.now },
        },
      ],
      default: [],
    },
  },
  { timestamps: true },
);

export const AgentConversation = mongoose.model('AgentConversation', agentConversationSchema);
