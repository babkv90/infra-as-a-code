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
