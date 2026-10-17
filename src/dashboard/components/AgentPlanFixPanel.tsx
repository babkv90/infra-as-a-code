// Live view of a "make it pass terraform plan" agent run (kind 'plan_fix'). Unlike
// AgentRunTimeline's fixed routing -> specialists -> synthesis rows, a plan-fix run's shape isn't
// known in advance — the agent decides each step — so this renders the run's own step log as it
// grows: the agent's notes, each batch of draft edits, and each real terraform plan with its result.
// When the run ends it shows the draft's changes for review; nothing reaches the real diagram
// until the user clicks Apply (agentController.js's applyPlanFix).
import { AlertTriangle, CheckCircle2, Circle, GitCommitHorizontal, Loader2, MessageSquareText, Plus, Trash2, XCircle } from 'lucide-react';
import type { AgentRunStatus, AgentStepEvent, AppliedPlanFixChange, PlanRun } from '../agentApi';

type Props = {
  run: AgentRunStatus;
  applying: boolean;
  onApply: () => void;
};

const OP_LABELS: Record<AppliedPlanFixChange['op'], string> = {
  add_node: 'Added resource',
  update_node: 'Updated resource',
  remove_node: 'Removed resource',
  add_edge: 'Added connection',
  update_edge: 'Updated connection',
  remove_edge: 'Removed connection',
};

export function AgentPlanFixPanel({ run, applying, onApply }: Props) {
  const fix = run.fix;
  if (!fix) return null;

  const planRuns = fix.planRuns;
  const isRunning = run.status === 'running';
  const planInFlight = planRuns.some((planRun) => planRun.status === 'running');
  const lastPlan = planRuns[planRuns.length - 1];

  return (
    <div className="agent-planfix">
      <div className="agent-changeplan__header">
        <strong>Make it pass terraform plan · {fix.diagramName}</strong>
        <em className="agent-planfix__budget">
          Plans {planRuns.length}/{fix.limits.maxPlanRuns}
        </em>
      </div>

      <div className="agent-timeline">
        {run.steps.map((step, index) => (
          <StepRow key={`${step.type}-${index}`} planRuns={planRuns} step={step} />
        ))}
        {isRunning && !planInFlight && (
          <div className="agent-timeline__row">
            <Loader2 className="agent-timeline__glyph agent-timeline__glyph--active agent-timeline__spin" size={15} />
            <div className="agent-timeline__row-body">
              <strong>Agent is working out the next step…</strong>
            </div>
          </div>
        )}
      </div>

      {!isRunning && <PlanFixResult applying={applying} fix={fix} lastPlan={lastPlan} onApply={onApply} status={run.status} />}
    </div>
  );
}

function StepRow({ step, planRuns }: { step: AgentStepEvent; planRuns: PlanRun[] }) {
  switch (step.type) {
    case 'fix.started':
      return <Row icon="done" title="Working on a draft copy" detail="Your diagram is not touched until you apply the result." />;
    case 'fix.note':
      return <Row icon="note" title="Agent" detail={step.text} wrap />;
    case 'fix.changes':
      return (
        <Row
          icon="done"
          title={`Edited the draft — ${step.applied ?? 0} change${step.applied === 1 ? '' : 's'}`}
          detail={step.rejected ? `${step.rejected} rejected by the guardrails and sent back to the agent` : undefined}
        />
      );
    case 'plan.started': {
      const planRun = planRuns[step.index ?? -1];
      const running = planRun?.status === 'running';
      return (
        <Row
          icon={running ? 'running' : 'done'}
          title={`terraform plan #${(step.index ?? 0) + 1}`}
          detail={running ? `Running on ${planRun?.executor === 'github-actions' ? 'GitHub Actions' : 'the backend'} — usually 1–3 minutes` : undefined}
          link={planRun?.githubRunUrl ?? undefined}
        />
      );
    }
    case 'plan.finished':
      if (step.status === 'passed') {
        const summary = step.changeSummary;
        return (
          <Row
            icon="passed"
            title={`Plan #${(step.index ?? 0) + 1} passed`}
            detail={summary ? `${summary.add} to add, ${summary.change} to change, ${summary.remove} to destroy` : undefined}
          />
        );
      }
      return (
        <Row
          icon="failed"
          title={step.status === 'error' ? `Plan #${(step.index ?? 0) + 1} could not run` : `Plan #${(step.index ?? 0) + 1} failed — ${step.errorCount ?? 0} error${step.errorCount === 1 ? '' : 's'}`}
          detail={step.firstError ?? undefined}
          wrap
        />
      );
    case 'fix.finished':
      return <Row icon={step.outcome === 'passed' ? 'passed' : 'failed'} title={step.outcome === 'passed' ? 'Done — terraform plan passes' : 'Agent stopped without a passing plan'} />;
    case 'fix.failed':
      return <Row icon="failed" title="Run failed" />;
    default:
      return null;
  }
}

type RowIcon = 'done' | 'running' | 'passed' | 'failed' | 'note' | 'pending';

function Row({ icon, title, detail, wrap, link }: { icon: RowIcon; title: string; detail?: string; wrap?: boolean; link?: string }) {
  return (
    <div className={`agent-timeline__row${icon === 'failed' ? ' agent-timeline__row--error' : ''}`}>
      <RowGlyph icon={icon} />
      <div className={`agent-timeline__row-body${wrap ? ' agent-timeline__row-body--wrap' : ''}`}>
        <strong>{title}</strong>
        {detail && <span>{detail}</span>}
        {link && (
          <a className="agent-planfix__link" href={link} rel="noreferrer" target="_blank">
            View run on GitHub
          </a>
        )}
      </div>
    </div>
  );
}

function RowGlyph({ icon }: { icon: RowIcon }) {
  if (icon === 'passed' || icon === 'done') return <CheckCircle2 className="agent-timeline__glyph agent-timeline__glyph--success" size={15} />;
  if (icon === 'running') return <Loader2 className="agent-timeline__glyph agent-timeline__glyph--active agent-timeline__spin" size={15} />;
  if (icon === 'failed') return <XCircle className="agent-timeline__glyph agent-planfix__glyph--failed" size={15} />;
  if (icon === 'note') return <MessageSquareText className="agent-timeline__glyph agent-timeline__glyph--active" size={15} />;
  return <Circle className="agent-timeline__glyph agent-timeline__glyph--pending" size={15} />;
}

function PlanFixResult({
  fix,
  lastPlan,
  status,
  applying,
  onApply,
}: {
  fix: NonNullable<AgentRunStatus['fix']>;
  lastPlan?: PlanRun;
  status: AgentRunStatus['status'];
  applying: boolean;
  onApply: () => void;
}) {
  const passed = fix.outcome === 'passed';
  const changes = fix.appliedChanges;
  const remainingErrors = !passed && lastPlan?.status === 'failed' ? lastPlan.diagnostics : [];

  return (
    <div className="agent-changeplan">
      {fix.summary && <p className="agent-changeplan__summary">{fix.summary}</p>}

      {remainingErrors.length > 0 && (
        <div className="agent-changeplan__items">
          <strong className="agent-planfix__section">Still failing</strong>
          {remainingErrors.map((diagnostic, index) => (
            <div className="agent-changeplan__item agent-changeplan__item--blocked" key={`${diagnostic.summary}-${index}`}>
              <AlertTriangle size={13} />
              <div className="agent-changeplan__item-body">
                <strong>
                  {diagnostic.summary}
                  {(diagnostic.nodeId || diagnostic.address) && <em>{diagnostic.nodeId ?? diagnostic.address}</em>}
                </strong>
                {diagnostic.detail && <span>{diagnostic.detail}</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {changes.length > 0 && (
        <div className="agent-changeplan__items">
          <strong className="agent-planfix__section">Changes in the draft</strong>
          {changes.map((change, index) => (
            <div className={`agent-changeplan__item agent-changeplan__item--${change.op.startsWith('remove_') ? 'blocked' : change.op.startsWith('add_') ? 'ready' : 'warning'}`} key={`${change.op}-${index}`}>
              {change.op.startsWith('add_') ? <Plus size={13} /> : change.op.startsWith('remove_') ? <Trash2 size={13} /> : <GitCommitHorizontal size={13} />}
              <div className="agent-changeplan__item-body">
                <strong>
                  {OP_LABELS[change.op]}
                  <em>{change.createdId ?? change.target ?? change.serviceId}</em>
                </strong>
                <span>{change.rationale}</span>
                {change.data && Object.keys(change.data).length > 0 && <code className="agent-planfix__patch">{JSON.stringify(change.data)}</code>}
              </div>
            </div>
          ))}
        </div>
      )}

      {status === 'completed' && changes.length > 0 && (
        fix.appliedToDiagramAt ? (
          <p className="agent-changeplan__note">Applied to “{fix.diagramName}”. Open it in the builder to review or deploy.</p>
        ) : (
          <div className="agent-planfix__actions">
            <button className="agent-planfix__apply" disabled={applying} onClick={onApply} type="button">
              {applying ? <Loader2 className="agent-timeline__spin" size={14} /> : <CheckCircle2 size={14} />}
              Apply {changes.length} change{changes.length === 1 ? '' : 's'} to “{fix.diagramName}”
            </button>
            <span className="agent-changeplan__note">
              {passed ? 'terraform plan passes with these changes.' : 'Partial fix — terraform plan still fails. Applying keeps the progress so far.'}
            </span>
          </div>
        )
      )}
    </div>
  );
}
