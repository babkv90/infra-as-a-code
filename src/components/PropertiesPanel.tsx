import { AlertTriangle, FileCode2, Link2, Plus, ShieldCheck, Trash2, X } from 'lucide-react';
import type React from 'react';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { awsServices, serviceById } from '../data/awsServices';
import { useDiagramStore } from '../store/diagramStore';
import type { AwsEdgeData, EdgeConnectionType, NodeBindingSourceKind, NodeBindingTargetKind } from '../types';
import { exportTerraform } from '../utils/exportTerraform';

const connectionTypes: EdgeConnectionType[] = ['data', 'event', 'security', 'monitoring'];
const bindingTargetKinds: NodeBindingTargetKind[] = ['env', 'property', 'iam', 'connection'];
const bindingSourceKinds: NodeBindingSourceKind[] = ['secret', 'ssm', 'variable', 'local', 'resourceAttr', 'output'];
type PopupPosition = { left: number; top: number; side: 'left' | 'right'; arrowTop: number };

function PropertiesPanel() {
  const [terraform, setTerraform] = useState('');
  const [review, setReview] = useState('');
  const [popupPosition, setPopupPosition] = useState<PopupPosition>();
  const [bindingTargetPath, setBindingTargetPath] = useState('DB_PASSWORD');
  const [bindingTargetKind, setBindingTargetKind] = useState<NodeBindingTargetKind>('env');
  const [bindingSourceKind, setBindingSourceKind] = useState<NodeBindingSourceKind>('secret');
  const [bindingSourceId, setBindingSourceId] = useState('');
  const [bindingSourceAttribute, setBindingSourceAttribute] = useState('arn');
  const [bindingRequired, setBindingRequired] = useState(true);
  const [bindingSensitive, setBindingSensitive] = useState(true);
  const panelRef = useRef<HTMLElement>(null);
  const { nodes, edges, inspectorNodeId, inspectorEdgeId, closeInspector, updateNodeData, updateNodeConfig, addNodeBinding, updateNodeBinding, deleteNodeBinding, updateEdgeData } = useDiagramStore();
  const selectedNode = nodes.find((node) => node.id === inspectorNodeId);
  const selectedEdge = edges.find((edge) => edge.id === inspectorEdgeId);
  const service = selectedNode?.data.serviceId ? serviceById[selectedNode.data.serviceId] : undefined;
  const bindingSourceNodes = useMemo(
    () => nodes.filter((node) => node.type !== 'groupBox' && node.id !== selectedNode?.id && ['secrets', 'iam', 'kms'].includes(node.data.serviceId ?? '')),
    [nodes, selectedNode?.id],
  );

  const connections = useMemo(() => {
    if (!selectedNode) return { inbound: [], outbound: [] };
    return {
      inbound: edges.filter((edge) => edge.target === selectedNode.id),
      outbound: edges.filter((edge) => edge.source === selectedNode.id),
    };
  }, [edges, selectedNode]);

  function securityReview() {
    if (!selectedNode) return;
    const points = [
      selectedNode.data.serviceId === 'rds' ? 'Keep database subnets private and deny public access.' : undefined,
      selectedNode.data.serviceId === 's3' ? 'Enable bucket encryption, block public access, and prefer least-privilege bucket policies.' : undefined,
      selectedNode.data.serviceId === 'lambda' ? 'Attach a dedicated IAM role and limit outbound network permissions.' : undefined,
      !connections.outbound.some((edge) => edge.data?.connectionType === 'monitoring') ? 'Add CloudWatch or X-Ray telemetry for operational visibility.' : undefined,
      'Check IAM actions, encryption-at-rest, TLS-only ingress, and secret rotation before deployment.',
    ].filter(Boolean);
    setReview(points.join('\n'));
  }

  function addBinding() {
    if (!selectedNode) return;
    const sourceId = bindingSourceId.trim() || bindingSourceNodes[0]?.id || defaultBindingSourceId(bindingSourceKind);
    const targetPath = bindingTargetPath.trim();
    if (!sourceId || !targetPath) return;

    addNodeBinding(selectedNode.id, {
      targetPath,
      targetKind: bindingTargetKind,
      source: {
        kind: bindingSourceKind,
        id: sourceId,
        attribute: bindingSourceAttribute.trim() || undefined,
      },
      required: bindingRequired,
      sensitive: bindingSensitive,
    });
    setBindingTargetPath('');
  }

  useLayoutEffect(() => {
    if (!selectedNode && !selectedEdge) return undefined;

    let frame = 0;

    function updatePosition() {
      const panel = panelRef.current;
      const workspace = panel?.closest('.workspace');
      if (!(panel instanceof HTMLElement) || !(workspace instanceof HTMLElement)) return;

      const workspaceRect = workspace.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      const nodeElement = selectedNode ? document.querySelector<HTMLElement>(`.react-flow__node[data-id="${selectedNode.id}"]`) : undefined;
      const target = nodeElement?.querySelector<HTMLElement>('.aws-node__tile') ?? nodeElement;
      const targetRect = target?.getBoundingClientRect();
      const margin = 12;
      const gap = 14;

      const targetCenterY = targetRect ? targetRect.top - workspaceRect.top + targetRect.height / 2 : workspaceRect.height / 2;
      let side: PopupPosition['side'] = 'right';
      let left = targetRect ? targetRect.right - workspaceRect.left + gap : workspaceRect.width / 2 - panelRect.width / 2;
      let top = targetCenterY - 34;
      const maxLeft = Math.max(margin, workspaceRect.width - panelRect.width - margin);
      const maxTop = Math.max(margin, workspaceRect.height - panelRect.height - margin);

      if (targetRect && left > maxLeft) {
        side = 'left';
        left = targetRect.left - workspaceRect.left - panelRect.width - gap;
      }

      top = Math.min(Math.max(top, margin), maxTop);

      setPopupPosition({
        left: Math.min(Math.max(left, margin), maxLeft),
        top,
        side,
        arrowTop: Math.min(Math.max(targetCenterY - top, 22), panelRect.height - 22),
      });
    }

    function schedulePositionUpdate() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(updatePosition);
    }

    schedulePositionUpdate();
    window.addEventListener('resize', schedulePositionUpdate);
    window.addEventListener('scroll', schedulePositionUpdate, true);
    window.addEventListener('wheel', schedulePositionUpdate, true);
    window.addEventListener('pointerup', schedulePositionUpdate, true);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', schedulePositionUpdate);
      window.removeEventListener('scroll', schedulePositionUpdate, true);
      window.removeEventListener('wheel', schedulePositionUpdate, true);
      window.removeEventListener('pointerup', schedulePositionUpdate, true);
    };
  }, [selectedEdge, selectedNode, nodes]);

  if (!selectedNode && !selectedEdge) {
    return null;
  }

  const popupStyle: React.CSSProperties = popupPosition
    ? ({ left: popupPosition.left, top: popupPosition.top, '--properties-arrow-top': `${popupPosition.arrowTop}px` } as React.CSSProperties)
    : { visibility: 'hidden' };

  return (
    <aside
      className={`properties-panel properties-panel--${popupPosition?.side ?? 'right'}`}
      ref={panelRef}
      style={popupStyle}
      aria-label={selectedNode ? `${selectedNode.data.serviceName} configuration` : 'Connection configuration'}
    >
      {selectedNode && (
        <>
          <div className="panel-heading">
            <div>
              <span className="eyebrow">Node</span>
              <h2>{selectedNode.data.serviceName}</h2>
            </div>
            <div className="panel-heading__actions">
              <span className={`status-pill status-pill--${selectedNode.data.status}`}>{selectedNode.data.status}</span>
              <button className="icon-button" onClick={closeInspector} title="Close configuration" type="button">
                <X size={16} />
              </button>
            </div>
          </div>

          <Field label="Name">
            <input value={selectedNode.data.label} onChange={(event) => updateNodeData(selectedNode.id, { label: event.target.value })} />
          </Field>

          {(service?.fields ?? awsServices[0].fields).map((field) => (
            <Field label={field.label} key={field.key}>
              {field.type === 'select' ? (
                <select
                  value={String(selectedNode.data.config[field.key] ?? '')}
                  onChange={(event) => updateNodeConfig(selectedNode.id, field.key, event.target.value)}
                >
                  <option value="">Select...</option>
                  {field.options?.map((option) => (
                    <option value={option} key={option}>
                      {option}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type={field.type}
                  value={String(selectedNode.data.config[field.key] ?? '')}
                  onChange={(event) =>
                    updateNodeConfig(selectedNode.id, field.key, field.type === 'number' && event.target.value !== '' ? Number(event.target.value) : event.target.value)
                  }
                />
              )}
            </Field>
          ))}

          <Field label="ARN">
            <input value={selectedNode.data.arn} onChange={(event) => updateNodeData(selectedNode.id, { arn: event.target.value })} />
          </Field>

          <Field label="Note">
            <textarea value={selectedNode.data.note ?? ''} onChange={(event) => updateNodeData(selectedNode.id, { note: event.target.value })} />
          </Field>

          {selectedNode.data.warning && (
            <div className="warning-box">
              <AlertTriangle size={16} />
              {selectedNode.data.warning}
            </div>
          )}

          <ConnectionList title="Inbound" items={connections.inbound.map((edge) => `${nodeName(nodes, edge.source)} - ${edge.data?.label || 'connection'}`)} />
          <ConnectionList title="Outbound" items={connections.outbound.map((edge) => `${edge.data?.label || 'connection'} - ${nodeName(nodes, edge.target)}`)} />

          <section className="binding-section">
            <div className="connection-list__title">
              <Link2 size={13} />
              Bindings
            </div>
            {(selectedNode.data.bindings ?? []).length ? (
              <div className="binding-list">
                {(selectedNode.data.bindings ?? []).map((binding) => (
                  <div className="binding-card" key={binding.id}>
                    <div>
                      <strong>{binding.targetPath}</strong>
                      <span>
                        {binding.targetKind} from {binding.source.kind}:{' '}
                        {bindingSourceLabel(nodes, binding.source.id)}
                        {binding.source.attribute ? `.${binding.source.attribute}` : ''}
                      </span>
                    </div>
                    <div className="binding-card__flags">
                      <label>
                        <input
                          checked={Boolean(binding.required)}
                          type="checkbox"
                          onChange={(event) => updateNodeBinding(selectedNode.id, binding.id, { required: event.target.checked })}
                        />
                        required
                      </label>
                      <label>
                        <input
                          checked={Boolean(binding.sensitive)}
                          type="checkbox"
                          onChange={(event) => updateNodeBinding(selectedNode.id, binding.id, { sensitive: event.target.checked })}
                        />
                        sensitive
                      </label>
                      <button className="icon-button danger-button" title="Remove binding" type="button" onClick={() => deleteNodeBinding(selectedNode.id, binding.id)}>
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="muted">No bindings yet.</div>
            )}

            <div className="binding-form">
              <Field label="Target">
                <input placeholder="DB_PASSWORD or config.environment.API_KEY" value={bindingTargetPath} onChange={(event) => setBindingTargetPath(event.target.value)} />
              </Field>
              <Field label="Target kind">
                <select value={bindingTargetKind} onChange={(event) => setBindingTargetKind(event.target.value as NodeBindingTargetKind)}>
                  {bindingTargetKinds.map((kind) => (
                    <option value={kind} key={kind}>
                      {bindingTargetLabel(kind)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Source kind">
                <select
                  value={bindingSourceKind}
                  onChange={(event) => {
                    const nextKind = event.target.value as NodeBindingSourceKind;
                    setBindingSourceKind(nextKind);
                    setBindingSensitive(nextKind === 'secret' || nextKind === 'ssm');
                    setBindingSourceAttribute(nextKind === 'secret' ? 'arn' : nextKind === 'resourceAttr' ? 'id' : '');
                  }}
                >
                  {bindingSourceKinds.map((kind) => (
                    <option value={kind} key={kind}>
                      {bindingSourceKindLabel(kind)}
                    </option>
                  ))}
                </select>
              </Field>
              {bindingSourceKind === 'secret' ? (
                <Field label="Secret node">
                  <select value={bindingSourceId} onChange={(event) => setBindingSourceId(event.target.value)}>
                    <option value="">{bindingSourceNodes.length ? 'Select source node' : 'No secret source node'}</option>
                    {bindingSourceNodes.map((node) => (
                      <option value={node.id} key={node.id}>
                        {node.data.label}
                      </option>
                    ))}
                  </select>
                </Field>
              ) : (
                <Field label="Source id">
                  <input value={bindingSourceId} placeholder={sourcePlaceholder(bindingSourceKind)} onChange={(event) => setBindingSourceId(event.target.value)} />
                </Field>
              )}
              <Field label="Attribute">
                <input value={bindingSourceAttribute} placeholder="arn, id, value, name" onChange={(event) => setBindingSourceAttribute(event.target.value)} />
              </Field>
              <div className="binding-flags">
                <label>
                  <input checked={bindingRequired} type="checkbox" onChange={(event) => setBindingRequired(event.target.checked)} />
                  required
                </label>
                <label>
                  <input checked={bindingSensitive} type="checkbox" onChange={(event) => setBindingSensitive(event.target.checked)} />
                  sensitive
                </label>
              </div>
              <button className="text-button binding-add-button" type="button" onClick={addBinding} disabled={!bindingTargetPath.trim()}>
                <Plus size={15} />
                Add binding
              </button>
            </div>
          </section>

          <div className="panel-actions">
            <button onClick={() => setTerraform(exportTerraform(nodes, edges, selectedNode.id))}>
              <FileCode2 size={16} />
              Export as Terraform
            </button>
            <button onClick={securityReview}>
              <ShieldCheck size={16} />
              Security review
            </button>
          </div>
        </>
      )}

      {selectedEdge && (
        <>
          <div className="panel-heading">
            <div>
              <span className="eyebrow">Connection</span>
              <h2>{nodeName(nodes, selectedEdge.source)} to {nodeName(nodes, selectedEdge.target)}</h2>
            </div>
            <button className="icon-button" onClick={closeInspector} title="Close configuration" type="button">
              <X size={16} />
            </button>
          </div>
          <Field label="Label">
            <input value={selectedEdge.data?.label ?? ''} onChange={(event) => updateEdgeData(selectedEdge.id, { label: event.target.value })} />
          </Field>
          <Field label="Type">
            <select
              value={selectedEdge.data?.connectionType ?? 'data'}
              onChange={(event) => updateEdgeData(selectedEdge.id, { connectionType: event.target.value as EdgeConnectionType })}
            >
              {connectionTypes.map((type) => (
                <option value={type} key={type}>
                  {type}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Protocol">
            <input value={selectedEdge.data?.protocol ?? ''} onChange={(event) => updateEdgeData(selectedEdge.id, { protocol: event.target.value })} />
          </Field>
          <Field label="Port">
            <input value={selectedEdge.data?.port ?? ''} onChange={(event) => updateEdgeData(selectedEdge.id, { port: event.target.value })} />
          </Field>
        </>
      )}

      {!!terraform && <Modal title="Terraform HCL" value={terraform} onClose={() => setTerraform('')} />}
      {!!review && <Modal title="Security Review" value={review} onClose={() => setReview('')} />}
    </aside>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function ConnectionList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="connection-list">
      <div className="connection-list__title">{title}</div>
      {items.length ? items.map((item) => <div key={item}>{item}</div>) : <div className="muted">None</div>}
    </div>
  );
}

function Modal({ title, value, onClose }: { title: string; value: string; onClose: () => void }) {
  return (
    <div className="modal-backdrop">
      <div className="modal">
        <div className="modal__header">
          <h3>{title}</h3>
          <button className="icon-button" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <pre>{value}</pre>
      </div>
    </div>
  );
}

function nodeName(nodes: Array<{ id: string; data: { label: string } }>, id: string): string {
  return nodes.find((node) => node.id === id)?.data.label ?? id;
}

function bindingSourceLabel(nodes: Array<{ id: string; data: { label: string } }>, id: string): string {
  return nodes.find((node) => node.id === id)?.data.label ?? id;
}

function bindingTargetLabel(kind: NodeBindingTargetKind): string {
  if (kind === 'env') return 'Environment variable';
  if (kind === 'property') return 'Node property';
  if (kind === 'iam') return 'IAM permission';
  return 'Connection';
}

function bindingSourceKindLabel(kind: NodeBindingSourceKind): string {
  if (kind === 'secret') return 'Secrets Manager';
  if (kind === 'ssm') return 'SSM Parameter';
  if (kind === 'variable') return 'Terraform variable';
  if (kind === 'local') return 'Terraform local';
  if (kind === 'resourceAttr') return 'Resource attribute';
  return 'Terraform output';
}

function defaultBindingSourceId(kind: NodeBindingSourceKind): string {
  if (kind === 'variable') return 'var.runtime_config';
  if (kind === 'local') return 'local.runtime_config';
  if (kind === 'ssm') return '/app/config/value';
  if (kind === 'output') return 'module.shared.output';
  return '';
}

function sourcePlaceholder(kind: NodeBindingSourceKind): string {
  if (kind === 'variable') return 'var.db_host';
  if (kind === 'local') return 'local.service_name';
  if (kind === 'ssm') return '/prod/app/config';
  if (kind === 'resourceAttr') return 'aws_db_instance.main';
  if (kind === 'output') return 'module.network.vpc_id';
  return 'source id';
}

export default PropertiesPanel;
