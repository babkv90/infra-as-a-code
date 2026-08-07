import type React from 'react';
import { memo, useMemo, useState } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import * as Icons from 'lucide-react';
import { whiteboardOutlineServiceIds } from '../../data/awsServices';
import { useDiagramStore } from '../../store/diagramStore';
import type { AwsNodeData } from '../../types';
import { buildHandleId, type ConnectionSide } from '../../utils/connectionRouting';
import { getServiceRequirement } from '../../utils/resourceRequirements';
import { terraformTypeForService } from '../../utils/resourceRegistry';
import { useLodBand, useRelationshipBadges } from '../canvasGraphContext';

const iconFallback = Icons.Cloud;
const connectionSides: ConnectionSide[] = ['left', 'right', 'top', 'bottom'];
const reactFlowPositionBySide = {
  left: Position.Left,
  right: Position.Right,
  top: Position.Top,
  bottom: Position.Bottom,
} satisfies Record<ConnectionSide, Position>;

/** Config lines shown on the card face: the fields that actually gate deployment, worst first. */
const SUMMARY_LINE_COUNT = 2;

type SummaryLine = { key: string; value: string; missing: boolean };

function buildSummaryLines(data: AwsNodeData): SummaryLine[] {
  const requirement = getServiceRequirement(data.serviceId);
  const config = data.config ?? {};
  const seen = new Set<string>();
  const lines: SummaryLine[] = [];

  // Required fields first — a card should show what is stopping it from deploying before it shows
  // what is merely configured.
  for (const key of [...requirement.required, ...(requirement.recommended ?? [])]) {
    if (seen.has(key)) continue;
    seen.add(key);
    const value = String(config[key] ?? '').trim();
    const isRequired = requirement.required.includes(key);
    if (!value && !isRequired) continue;
    lines.push({ key, value, missing: isRequired && !value });
  }

  return lines.sort((left, right) => Number(right.missing) - Number(left.missing)).slice(0, SUMMARY_LINE_COUNT);
}

function AwsServiceNode({ id, data, selected }: NodeProps<AwsNodeData>) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const updateNodeData = useDiagramStore((state) => state.updateNodeData);
  const duplicateSelection = useDiagramStore((state) => state.duplicateSelection);
  const deleteSelection = useDiagramStore((state) => state.deleteSelection);
  const setSelection = useDiagramStore((state) => state.setSelection);
  const whiteboardMode = useDiagramStore((state) => state.whiteboardMode);
  const architectureViewMode = useDiagramStore((state) => state.architectureViewMode);
  const relationshipBadges = useRelationshipBadges(id);
  const lodBand = useLodBand();

  const Icon = ((Icons as unknown as Record<string, typeof iconFallback>)[data.icon] ?? iconFallback);
  // The whiteboard and architecture lenses keep the original compact tile — they exist to show shape
  // and flow, and a detailed card would defeat that. The card is the default lens only.
  const isCompact = whiteboardMode || architectureViewMode;
  const isWhiteboardOutline = whiteboardMode && (data.serviceId ? whiteboardOutlineServiceIds.has(data.serviceId) : false);

  const summaryLines = useMemo(() => (isCompact || lodBand !== 'full' ? [] : buildSummaryLines(data)), [data, isCompact, lodBand]);
  const terraformType = terraformTypeForService(data.serviceId);
  const blockingCount = summaryLines.filter((line) => line.missing).length;

  function closeMenu() {
    setMenu(null);
  }

  const handles = (
    <>
      {data.ports.inputs.length > 0 &&
        connectionSides.map((side) => (
          <Handle
            type="target"
            position={reactFlowPositionBySide[side]}
            id={buildHandleId('in', side, data.ports.inputs[0])}
            className={`port-handle port-handle--in port-handle--${side}`}
            key={`input-${side}`}
          />
        ))}
      {data.ports.outputs.length > 0 &&
        connectionSides.map((side) => (
          <Handle
            type="source"
            position={reactFlowPositionBySide[side]}
            id={buildHandleId('out', side, data.ports.outputs[0])}
            className={`port-handle port-handle--out port-handle--${side}`}
            key={`output-${side}`}
          />
        ))}
    </>
  );

  const contextMenu = menu && (
    <div className="context-menu nowheel" style={{ left: menu.x, top: menu.y }} onMouseLeave={closeMenu}>
      <button
        onClick={() => {
          duplicateSelection();
          closeMenu();
        }}
      >
        Duplicate
      </button>
      <button
        onClick={() => {
          navigator.clipboard?.writeText(data.arn);
          closeMenu();
        }}
      >
        Copy ARN
      </button>
      <button
        onClick={() => {
          updateNodeData(id, { note: data.note || 'Review IAM access, network exposure, and encryption settings.' });
          closeMenu();
        }}
      >
        Add note
      </button>
      <button
        className="danger"
        onClick={() => {
          deleteSelection();
          closeMenu();
        }}
      >
        Delete
      </button>
    </div>
  );

  const openContextMenu = (event: React.MouseEvent) => {
    event.preventDefault();
    setSelection(id, undefined);
    setMenu({ x: event.clientX, y: event.clientY });
  };

  if (isCompact) {
    return (
      <div
        className={`aws-node aws-node--compact ${whiteboardMode ? 'aws-node--whiteboard' : ''} ${architectureViewMode ? 'aws-node--architecture' : ''} ${selected ? 'selected' : ''} ${data.warning ? 'warning' : ''}`}
        onContextMenu={openContextMenu}
      >
        <div
          className={`aws-node__tile ${whiteboardMode ? `aws-node__tile--whiteboard ${isWhiteboardOutline ? 'aws-node__tile--outline' : 'aws-node__tile--badge'}` : ''} ${architectureViewMode ? 'aws-node__tile--architecture' : ''}`}
          style={((whiteboardMode && !isWhiteboardOutline) || architectureViewMode) ? ({ '--aws-node-badge-color': data.color } as React.CSSProperties) : undefined}
        >
          <div className={`aws-node__status aws-node__status--${data.status}`} />
          <div
            className="aws-node__icon"
            style={{ color: whiteboardMode ? (isWhiteboardOutline ? '#111111' : '#ffffff') : '#ffffff' }}
          >
            <Icon size={24} strokeWidth={1.8} />
          </div>
          {handles}
        </div>
        <div className={`aws-node__label ${whiteboardMode ? 'aws-node__label--whiteboard' : ''} ${architectureViewMode ? 'aws-node__label--architecture' : ''}`}>
          <span>{data.label}</span>
        </div>
        {data.warning && <div className="node-warning">{data.warning}</div>}
        {contextMenu}
      </div>
    );
  }

  // Level of detail (Fix 5): at low zoom the full card's attribute rows are illegible and just add
  // spacing pressure, so density steps down in two bands below the unchanged full card at >0.8 zoom.
  // Reuses the full card's own classes/markup for its head section rather than inventing new ones, so
  // whatever styling already applies there (font size, truncation, icon color) carries over exactly.
  if (lodBand === 'icon') {
    return (
      <div
        className={`aws-node aws-node--card aws-node--lod-icon ${selected ? 'selected' : ''} ${data.warning ? 'warning' : ''}`}
        onContextMenu={openContextMenu}
        title={data.label}
      >
        <div className="aws-card aws-card--lod-icon">
          <div className="aws-card__stripe" style={{ background: data.color }} />
          {handles}
          <span className="aws-card__icon aws-card__icon--lod" style={{ color: data.color }}>
            <Icon size={20} strokeWidth={2} />
          </span>
        </div>
        {data.warning && <div className="node-warning">{data.warning}</div>}
        {contextMenu}
      </div>
    );
  }

  if (lodBand === 'compact') {
    return (
      <div
        className={`aws-node aws-node--card aws-node--lod-compact ${selected ? 'selected' : ''} ${data.warning ? 'warning' : ''}`}
        onContextMenu={openContextMenu}
      >
        <div className="aws-card aws-card--lod-compact">
          <div className="aws-card__stripe" style={{ background: data.color }} />
          {handles}
          <div className="aws-card__head">
            <span className="aws-card__icon" style={{ color: data.color }}>
              <Icon size={18} strokeWidth={2.1} />
            </span>
            <span className="aws-card__identity">
              <span className="aws-card__name" title={data.label}>
                {data.label}
              </span>
              <span className="aws-card__type">{terraformType ?? data.serviceName}</span>
            </span>
          </div>
        </div>
        {data.warning && <div className="node-warning">{data.warning}</div>}
        {contextMenu}
      </div>
    );
  }

  return (
    <div
      className={`aws-node aws-node--card ${selected ? 'selected' : ''} ${data.warning || blockingCount ? 'warning' : ''}`}
      onContextMenu={openContextMenu}
    >
      <div className="aws-card">
        <div className="aws-card__stripe" style={{ background: data.color }} />
        {handles}

        <div className="aws-card__head">
          <span className="aws-card__icon" style={{ color: data.color }}>
            <Icon size={18} strokeWidth={2.1} />
          </span>
          <span className="aws-card__identity">
            <span className="aws-card__name" title={data.label}>
              {data.label}
            </span>
            <span className="aws-card__type">{terraformType ?? data.serviceName}</span>
          </span>
        </div>

        {summaryLines.length > 0 && (
          <dl className="aws-card__meta">
            {summaryLines.map((line) => (
              <div className={`aws-card__meta-row ${line.missing ? 'aws-card__meta-row--missing' : ''}`} key={line.key}>
                <dt>{line.key}</dt>
                <dd>{line.missing ? 'required' : line.value}</dd>
              </div>
            ))}
          </dl>
        )}

        <div className="aws-card__foot">
          <span className={`aws-card__readiness aws-card__readiness--${blockingCount ? 'blocked' : 'ready'}`}>
            <i className="aws-card__dot" />
            {blockingCount ? `${blockingCount} blocking field${blockingCount === 1 ? '' : 's'}` : 'Ready'}
          </span>
          <span className="aws-card__region">{data.region}</span>
        </div>

        {(relationshipBadges.security > 0 || relationshipBadges.monitoring > 0 || relationshipBadges.deployment > 0) && (
          <div className="aws-card__badges" aria-label="Secondary relationships">
            {relationshipBadges.security > 0 && <span className="aws-card__badge aws-card__badge--security">sec {relationshipBadges.security}</span>}
            {relationshipBadges.monitoring > 0 && <span className="aws-card__badge aws-card__badge--monitoring">mon {relationshipBadges.monitoring}</span>}
            {relationshipBadges.deployment > 0 && <span className="aws-card__badge aws-card__badge--deployment">dep {relationshipBadges.deployment}</span>}
          </div>
        )}
      </div>

      {data.warning && <div className="node-warning">{data.warning}</div>}
      {contextMenu}
    </div>
  );
}

export default memo(AwsServiceNode);
