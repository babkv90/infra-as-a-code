// Renders one in-flight/completed agent run's progress as a vertical list: routing -> each routed
// specialist -> synthesizing. Purely presentational — derives all of its rows from the `steps`
// array AgentPage.tsx got back from polling GET /agent/runs/:id/status (see agentApi.ts), no
// fetching of its own.
import { AlertTriangle, CheckCircle2, Circle, Loader2 } from 'lucide-react';
import type { AgentName, AgentRunStatus } from '../agentApi';

// Same color language as edgeColors in src/components/edges/FlowEdge.tsx (security/dependency/
// deployment categories) — a red security finding on the canvas and a red security row here mean
// the same thing everywhere in the product.
const AGENT_COLORS: Record<AgentName, string> = {
  architect: '#7c3aed',
  terraform: '#16a34a',
  cost: '#d97706',
  security: '#dc2626',
};

const AGENT_LABELS: Record<AgentName, string> = {
  architect: 'Architect',
  terraform: 'Terraform',
  cost: 'Cost',
  security: 'Security',
};

type AgentRowState = 'queued' | 'running' | 'done';

// Modeled directly on DeploymentLiveMonitor.tsx's list-of-steps rendering (same status-glyph
// vocabulary), applied to agent runs instead of Terraform resource events — the AgentRunTimeline
// the plan calls for, built from the polling status this app already uses everywhere else instead
// of a new SSE pattern.
export function AgentRunTimeline({ status, route, steps }: Pick<AgentRunStatus, 'status' | 'route' | 'steps'>) {
  const routeStep = steps.find((step) => step.type === 'route.decided');
  const finishedByAgent = new Map(
    steps.filter((step): step is typeof step & { agent: AgentName } => step.type === 'agent.finished' && !!step.agent).map((step) => [step.agent, step]),
  );

  const rows: Array<{ agent: AgentName; state: AgentRowState; summary?: string; findingsCount?: number }> = route.map((agent) => {
    const finished = finishedByAgent.get(agent);
    return finished
      ? { agent, state: 'done', summary: finished.summary, findingsCount: finished.findingsCount }
      : { agent, state: 'running' };
  });

  const allAgentsDone = rows.length > 0 && rows.every((row) => row.state === 'done');

  return (
    <div className="agent-timeline">
      <div className="agent-timeline__row">
        <RowGlyph state={routeStep ? 'done' : 'running'} />
        <div className="agent-timeline__row-body">
          <strong>Routing</strong>
          {routeStep?.reason && <span>{routeStep.reason}</span>}
        </div>
      </div>

      {rows.map((row) => (
        <div className="agent-timeline__row" key={row.agent}>
          <RowGlyph state={row.state} />
          <div className="agent-timeline__row-body">
            <strong>
              <span className="agent-timeline__chip" style={{ background: AGENT_COLORS[row.agent] }} />
              {AGENT_LABELS[row.agent]}
              {typeof row.findingsCount === 'number' && row.findingsCount > 0 && (
                <em>
                  {row.findingsCount} finding{row.findingsCount === 1 ? '' : 's'}
                </em>
              )}
            </strong>
            {row.summary && <span>{row.summary}</span>}
          </div>
        </div>
      ))}

      {rows.length > 0 && (
        <div className="agent-timeline__row">
          <RowGlyph state={status === 'completed' ? 'done' : allAgentsDone ? 'running' : 'queued'} />
          <div className="agent-timeline__row-body">
            <strong>Synthesizing answer</strong>
          </div>
        </div>
      )}

      {status === 'failed' && (
        <div className="agent-timeline__row agent-timeline__row--error">
          <AlertTriangle size={15} />
          <div className="agent-timeline__row-body">
            <strong>Run failed</strong>
          </div>
        </div>
      )}
    </div>
  );
}

function RowGlyph({ state }: { state: AgentRowState }) {
  if (state === 'done') return <CheckCircle2 className="agent-timeline__glyph agent-timeline__glyph--success" size={15} />;
  if (state === 'running') return <Loader2 className="agent-timeline__glyph agent-timeline__glyph--active agent-timeline__spin" size={15} />;
  return <Circle className="agent-timeline__glyph agent-timeline__glyph--pending" size={15} />;
}
