// The AI Cloud Agent chat UI — the dashboard page a user actually types questions into. Sends
// messages through agentApi.ts (which hits Express's /agent/* routes), then polls the run this
// backend kicks off via AgentRunTimeline until it completes and the assistant reply lands in
// `conversation.messages`. This component never talks to the Python multi-agent service directly.
import { ArrowRight, FilePlus2, Sparkles, Wrench } from 'lucide-react';
import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import { getStoredUser } from '../../auth/authClient';
import { PageAlert } from '../../components/PageAlert';
import { canUseAiAgent } from '../../utils/accessControl';
import { applyPlanFix, createAgentConversation, getAgentRunStatus, sendAgentMessage, startPlanFix, type AgentConversation } from '../agentApi';
import { AgentChangePlanPanel } from '../components/AgentChangePlanPanel';
import { AgentPlanFixPanel } from '../components/AgentPlanFixPanel';
import { AgentRunTimeline } from '../components/AgentRunTimeline';
import { EmptyState, Panel } from '../components/DashPrimitives';
import { agentActions } from '../dashboardData';

// Same interval family as DeploymentLiveMonitor.tsx's POLL_MS (2500) — a run's per-turn wall-clock
// budget is much shorter (see MAX_WALL_SECONDS in services/agents/app/runner.py), so this polls a
// little faster.
const RUN_POLL_MS = 1500;
// Buffer over the backend's own MAX_WALL_SECONDS (60s) — a client-side backstop so a run can never
// leave the UI polling forever, even if some failure mode Express/Python don't already guard
// against (a lost callback, a crashed process) leaves an AgentRun stuck at 'running'.
const MAX_POLL_MS = 90_000;
// A plan-fix run pauses for each real terraform plan (1–3 minutes, up to 5 of them), so it gets a
// far longer backstop and a gentler poll rate than a one-shot chat run.
const PLAN_FIX_POLL_MS = 3000;
const PLAN_FIX_MAX_POLL_MS = 30 * 60_000;

type RunKind = 'chat' | 'plan_fix';

export function AgentPage() {
  const user = getStoredUser();
  const hasAgentAccess = canUseAiAgent(user);
  const [conversation, setConversation] = useState<AgentConversation | null>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [activeRunKind, setActiveRunKind] = useState<RunKind>('chat');
  // Outlives activeRunId (cleared once polling stops) so a finished plan-fix run can still be applied.
  const [lastRunId, setLastRunId] = useState<string | null>(null);
  const [isApplying, setIsApplying] = useState(false);
  const [runStatus, setRunStatus] = useState<Awaited<ReturnType<typeof getAgentRunStatus>> | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [conversation?.messages.length, activeRunId, runStatus]);

  // Polls the agent run this app just kicked off, the same way DeploymentLiveMonitor.tsx polls a
  // deployment's status — no SSE/EventSource in this codebase, this reuses that established
  // pattern instead of introducing a new one.
  useEffect(() => {
    if (!activeRunId) return;
    let isMounted = true;
    const deadline = Date.now() + (activeRunKind === 'plan_fix' ? PLAN_FIX_MAX_POLL_MS : MAX_POLL_MS);

    async function poll() {
      if (Date.now() > deadline) {
        setError('This run is taking much longer than expected and may be stuck — try again.');
        setActiveRunId(null);
        return;
      }

      try {
        const status = await getAgentRunStatus(activeRunId as string);
        if (!isMounted) return;
        setRunStatus(status);
        setConversation(status.conversation);
        if (status.status !== 'running') {
          setActiveRunId(null);
        }
      } catch (pollError) {
        if (!isMounted) return;
        setError(pollError instanceof Error ? pollError.message : 'Unable to check the agent run status.');
        setActiveRunId(null);
      }
    }

    void poll();
    const timer = window.setInterval(() => void poll(), activeRunKind === 'plan_fix' ? PLAN_FIX_POLL_MS : RUN_POLL_MS);
    return () => {
      isMounted = false;
      window.clearInterval(timer);
    };
  }, [activeRunId, activeRunKind]);

  async function submitMessage(message: string) {
    const cleanMessage = message.trim();
    if (!cleanMessage || activeRunId) return;

    setDraft('');
    setError('');
    setRunStatus(null);

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
      const result =
        conversation && conversation._id !== 'pending'
          ? await sendAgentMessage(conversation._id, cleanMessage)
          : await createAgentConversation(cleanMessage);
      setConversation(result.conversation);
      if (result.runId) startPolling(result.runId, 'chat');
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : 'Unable to send message to the AI agent.');
    }
  }

  function startPolling(runId: string, kind: RunKind) {
    setActiveRunKind(kind);
    setLastRunId(runId);
    setActiveRunId(runId);
  }

  // Starts the open-ended plan-fix agent on the current conversation's diagram (or the most recent
  // one). Its result lands in this same thread; nothing touches the diagram until handleApplyFix.
  async function startPlanFixRun() {
    if (activeRunId) return;
    setError('');
    setRunStatus(null);
    try {
      const result = await startPlanFix(conversation?._id);
      setConversation(result.conversation);
      if (result.runId) startPolling(result.runId, 'plan_fix');
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : 'Unable to start the plan fix.');
    }
  }

  async function handleApplyFix() {
    if (!lastRunId || isApplying) return;
    setIsApplying(true);
    setError('');
    try {
      await applyPlanFix(lastRunId);
      setRunStatus(await getAgentRunStatus(lastRunId));
    } catch (applyError) {
      setError(applyError instanceof Error ? applyError.message : 'Unable to apply the changes to the diagram.');
    } finally {
      setIsApplying(false);
    }
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submitMessage(draft);
  }

  async function startNewChat() {
    if (activeRunId) return;
    setConversation(null);
    setDraft('');
    setError('');
    setRunStatus(null);
    setLastRunId(null);
  }

  const isBusy = activeRunId !== null;

  return (
    <div className="dash-page dash-page--agent">
      {error && <PageAlert message={error} tone="error" onDismiss={() => setError('')} />}
      <div className="dash-agent-layout">
        <Panel title="AI Cloud Agent" action={hasAgentAccess ? 'Multi-agent' : 'Paid plan'}>
          {hasAgentAccess ? (
            <>
              <div className="dash-agent-question-suggestions" aria-label="Suggested questions">
                {agentActions.map((action) => (
                  <button disabled={isBusy} key={action} onClick={() => void submitMessage(action)} type="button">
                    <Sparkles size={15} />
                    {action}
                  </button>
                ))}
                <button disabled={isBusy} onClick={() => void startPlanFixRun()} type="button">
                  <Wrench size={15} />
                  Make it pass terraform plan
                </button>
                <button disabled={isBusy} onClick={() => void startNewChat()} type="button">
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
                  <EmptyState>Ask the AI Cloud Agent a question about your architecture, cost, or security.</EmptyState>
                )}
                {runStatus?.kind === 'plan_fix' ? (
                  <AgentPlanFixPanel applying={isApplying} onApply={() => void handleApplyFix()} run={runStatus} />
                ) : (
                  <>
                    {runStatus && <AgentRunTimeline route={runStatus.route} status={runStatus.status} steps={runStatus.steps} />}
                    {runStatus?.status === 'completed' && <AgentChangePlanPanel plan={runStatus.changePlan} />}
                  </>
                )}
                <div ref={chatEndRef} />
              </div>
              <form className="dash-chat-input" onSubmit={handleSubmit}>
                <input
                  disabled={isBusy}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder="Ask about your architecture, Terraform, cost, or security..."
                  value={draft}
                />
                <button disabled={isBusy || !draft.trim()} type="submit">
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
  );
}

function formatAgentSource(metadata?: Record<string, unknown>) {
  const pages = Array.isArray(metadata?.pages) ? metadata.pages.join('-') : undefined;
  const source = typeof metadata?.source === 'string' ? metadata.source.split(/[\\/]/).pop() : 'wellarchitected-framework.pdf';

  return pages ? `${source}, pages ${pages}` : source;
}
