// Renders a completed run's proposed ChangePlan (M2) as a read-only review list — see
// services/agents/app/changeplan.py for how it's generated and mechanically validated against
// real node/edge ids and the closed AWS service vocabulary. Purely presentational: no diagramStore
// import, no mutation of any diagram. Row styling follows DeploymentModal.tsx's
// deployment-step/deployment-issues convention (tone-suffixed classes, op badge + rationale).
import { ClipboardCopy, GitCommitHorizontal, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { ChangeItem, ChangeOp, ChangePlan } from '../agentApi';

const OP_LABELS: Record<ChangeOp, string> = {
  add_node: 'Add resource',
  update_node: 'Update resource',
  remove_node: 'Remove resource',
  add_edge: 'Add connection',
  update_edge: 'Update connection',
  remove_edge: 'Remove connection',
};

function OpIcon({ op }: { op: ChangeOp }) {
  if (op.startsWith('add_')) return <Plus size={13} />;
  if (op.startsWith('remove_')) return <Trash2 size={13} />;
  return <GitCommitHorizontal size={13} />;
}

function opTone(op: ChangeOp): 'ready' | 'warning' | 'blocked' {
  if (op.startsWith('add_')) return 'ready';
  if (op.startsWith('remove_')) return 'blocked';
  return 'warning';
}

export function AgentChangePlanPanel({ plan }: { plan: ChangePlan | null }) {
  const [copied, setCopied] = useState(false);

  if (!plan || plan.items.length === 0) return null;

  async function copyPlan() {
    try {
      await navigator.clipboard.writeText(JSON.stringify(plan, null, 2));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard access can be denied by the browser — the panel still works without it
    }
  }

  return (
    <div className="agent-changeplan">
      <div className="agent-changeplan__header">
        <strong>Proposed changes</strong>
        <button className="agent-changeplan__copy" onClick={() => void copyPlan()} type="button">
          <ClipboardCopy size={13} />
          {copied ? 'Copied' : 'Copy as JSON'}
        </button>
      </div>
      {plan.summary && <p className="agent-changeplan__summary">{plan.summary}</p>}
      <div className="agent-changeplan__items">
        {plan.items.map((item, index) => (
          <ChangePlanRow item={item} key={`${item.op}-${item.target ?? item.serviceId ?? index}`} />
        ))}
      </div>
      <p className="agent-changeplan__note">
        Nothing here has been applied. Review these on your own canvas before making any change.
      </p>
    </div>
  );
}

function ChangePlanRow({ item }: { item: ChangeItem }) {
  const subject = item.serviceId ?? item.target ?? '';
  return (
    <div className={`agent-changeplan__item agent-changeplan__item--${opTone(item.op)}`}>
      <OpIcon op={item.op} />
      <div className="agent-changeplan__item-body">
        <strong>
          {OP_LABELS[item.op]}
          {subject && <em>{subject}</em>}
        </strong>
        <span>{item.rationale}</span>
      </div>
    </div>
  );
}
