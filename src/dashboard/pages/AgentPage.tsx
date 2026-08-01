import { ArrowRight, BrainCircuit, Cpu, FilePlus2, Sparkles } from 'lucide-react';
import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import { getStoredUser } from '../../auth/authClient';
import { PageAlert } from '../../components/PageAlert';
import { canUseAiAgent } from '../../utils/accessControl';
import { createAgentConversation, sendAgentMessage, type AgentConversation } from '../agentApi';
import { EmptyState, Panel } from '../components/DashPrimitives';
import { agentActions } from '../dashboardData';

export function AgentPage() {
  const user = getStoredUser();
  const hasAgentAccess = canUseAiAgent(user);
  const [conversation, setConversation] = useState<AgentConversation | null>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [isSending, setIsSending] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [conversation?.messages.length, isSending]);

  async function submitMessage(message: string) {
    const cleanMessage = message.trim();
    if (!cleanMessage || isSending) return;

    setDraft('');
    setError('');
    setIsSending(true);

    const optimisticConversation: AgentConversation = conversation ?? {
      _id: 'pending',
      title: cleanMessage.slice(0, 72),
      messages: [],
    };

    setConversation({
      ...optimisticConversation,
      messages: [...optimisticConversation.messages, { role: 'user', content: cleanMessage }],
    });

    try {
      const updatedConversation =
        conversation && conversation._id !== 'pending'
          ? await sendAgentMessage(conversation._id, cleanMessage)
          : await createAgentConversation(cleanMessage);
      setConversation(updatedConversation);
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : 'Unable to send message to the RAG agent.');
    } finally {
      setIsSending(false);
    }
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submitMessage(draft);
  }

  async function startNewChat() {
    if (isSending) return;
    setConversation(null);
    setDraft('');
    setError('');
  }

  return (
    <div className="dash-page dash-page--agent dash-page--agent-coming-soon">
      <div className="dash-agent-preview" aria-hidden="true">
        {error && <PageAlert message={error} tone="error" onDismiss={() => setError('')} />}
        <div className="dash-agent-layout">
          <Panel title="AWS Well-Architected RAG agent" action={hasAgentAccess ? 'Live RAG' : 'Paid plan'}>
            {hasAgentAccess ? (
              <>
                <div className="dash-agent-question-suggestions" aria-label="Suggested questions">
                  {agentActions.map((action) => (
                    <button disabled={isSending} key={action} onClick={() => void submitMessage(action)} type="button">
                      <Sparkles size={15} />
                      {action}
                    </button>
                  ))}
                  <button disabled={isSending} onClick={() => void startNewChat()} type="button">
                    <FilePlus2 size={15} />
                    New chat
                  </button>
                </div>
                <div className="dash-chat">
                  {conversation?.messages.length ? (
                    conversation.messages.map((message, index) => (
                      <div className={`dash-chat-bubble dash-chat-bubble--${message.role === 'assistant' ? 'agent' : message.role}`} key={`${message.role}-${index}-${message.createdAt ?? message.content}`}>
                        <p>{message.content}</p>
                        {message.role === 'assistant' && message.metadata?.contexts?.length ? (
                          <div className="dash-chat-sources">
                            {message.metadata.contexts.slice(0, 3).map((context, sourceIndex) => (
                              <span key={context.id}>
                                Source {sourceIndex + 1}: {formatAgentSource(context.metadata)} - score {context.score.toFixed(2)}
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ))
                  ) : (
                    <EmptyState>Ask the AWS Well-Architected RAG agent a question.</EmptyState>
                  )}
                  {isSending && (
                    <div className="dash-chat-bubble dash-chat-bubble--agent">
                      <p>Retrieving AWS Well-Architected context...</p>
                    </div>
                  )}
                  <div ref={chatEndRef} />
                </div>
                <form className="dash-chat-input" onSubmit={handleSubmit}>
                  <input
                    disabled={isSending}
                    onChange={(event) => setDraft(event.target.value)}
                    placeholder="Ask about reliability, security, cost, operations, or Well-Architected best practices..."
                    value={draft}
                  />
                  <button disabled={isSending || !draft.trim()} type="submit">
                    <ArrowRight size={16} />
                  </button>
                </form>
              </>
            ) : (
              <EmptyState>AI support is available for Pro, Enterprise, and Super admin accounts.</EmptyState>
            )}
          </Panel>
        </div>
      </div>
      <section className="dash-agent-coming-soon-card" aria-labelledby="agent-coming-soon-title">
        <div className="dash-agent-orb" aria-hidden="true">
          <BrainCircuit size={42} />
          <Cpu size={18} />
        </div>
        <span className="dash-eyebrow">AI Cloud Agent Runtime</span>
        <h2 id="agent-coming-soon-title">Inference orchestration is being hardened for production.</h2>
        <p>
          We are finalizing retrieval isolation, tenant-aware AWS context binding, prompt-evaluation gates, and deployment-safe
          action boundaries. The agent interface will be live soon after the reliability and security checks clear.
        </p>
        <div className="dash-agent-coming-soon-grid" aria-label="AI Cloud Agent launch checklist">
          <span>RAG index validation</span>
          <span>Workspace-scoped context</span>
          <span>Action guardrails</span>
          <span>Latency budget tuning</span>
        </div>
      </section>
    </div>
  );
}

function formatAgentSource(metadata?: Record<string, unknown>) {
  const pages = Array.isArray(metadata?.pages) ? metadata.pages.join('-') : undefined;
  const source = typeof metadata?.source === 'string' ? metadata.source.split(/[\\/]/).pop() : 'wellarchitected-framework.pdf';

  return pages ? `${source}, pages ${pages}` : source;
}
