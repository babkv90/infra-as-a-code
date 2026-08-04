import {
  CheckCircle2,
  ChevronDown,
  Download,
  FileCode2,
  FileJson,
  ImageDown,
  LayoutGrid,
  Maximize2,
  Minimize2,
  Focus,
  Network,
  Redo2,
  Rocket,
  Save,
  ScanLine,
  SearchCheck,
  SquareDashedMousePointer,
  Tags,
  TerminalSquare,
  Trash2,
  Undo2,
  Upload,
  Wand2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useMemo, useRef } from 'react';
import { useState } from 'react';
import { toPng, toSvg } from 'html-to-image';
import { useReactFlow, useViewport } from 'reactflow';
import { PageAlert } from './PageAlert';
import { getStoredUser } from '../auth/authClient';
import { groupKinds } from '../data/awsServices';
import { useDiagramStore } from '../store/diagramStore';
import { validateServiceAccess } from '../utils/accessControl';
import { exportTerraform } from '../utils/exportTerraform';
import { normalizeImportedDiagram } from '../utils/importDiagram';
import { sendTerraformPayload } from '../utils/terraformPayloadApi';
import { validateGeneratedTerraform } from '../utils/terraformValidation';
import { validateDiagram } from '../utils/validate';
import type { AwsNode, DiagramDetailMode, DiagramViewMode, GroupKind, ToolMode } from '../types';
import type { ThemeMode } from '../theme';

function Toolbar({
  theme,
  isFullscreen = false,
  onToggleFullscreen,
  onOpenDeployment,
  onSaveDiagram,
  canSaveDiagram = true,
  isSavingDiagram = false,
  saveDiagramLabel = 'Save',
  saveDiagramTitle,
}: {
  theme?: ThemeMode;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
  onOpenDeployment?: () => void;
  onSaveDiagram?: () => void;
  canSaveDiagram?: boolean;
  isSavingDiagram?: boolean;
  saveDiagramLabel?: string;
  saveDiagramTitle?: string;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [boundaryKind, setBoundaryKind] = useState('');
  const [alertMessage, setAlertMessage] = useState('');
  const [isArranging, setIsArranging] = useState(false);
  const flow = useReactFlow();
  const viewport = useViewport();
  const {
    nodes,
    edges,
    selectedNodeId,
    selectedEdgeId,
    mode,
    activeView,
    detailMode,
    activeRegion,
    isDark,
    isValidated,
    history,
    future,
    setMode,
    setActiveView,
    setDetailMode,
    addGroupNode,
    isolateSelectedPath,
    resetDiagramFocus,
    undo,
    redo,
    deleteSelection,
    validate,
    importDiagram,
    autoArrange,
    markSaved,
  } = useDiagramStore();
  const selectedCount = nodes.filter((node) => node.selected).length + edges.filter((edge) => edge.selected).length;
  const hasSelection = selectedCount > 0 || Boolean(selectedNodeId) || Boolean(selectedEdgeId);
  const effectiveIsDark = theme ? theme === 'dark' : isDark;
  const user = useMemo(() => getStoredUser(), []);
  const liveTerraform = useMemo(() => exportTerraform(nodes, edges), [nodes, edges]);
  // Computed live rather than read from the store's `issues` field, which only updates when
  // validate() has actually been called — the Deploy gate needs to be correct even if the user never
  // clicked "Validate" first.
  const liveIssues = useMemo(
    () => [...validateDiagram(nodes, edges, activeRegion), ...validateGeneratedTerraform(liveTerraform), ...validateServiceAccess(nodes, user)],
    [activeRegion, liveTerraform, nodes, edges, user],
  );
  const blockingErrorCount = liveIssues.filter((issue) => issue.severity === 'error').length;

  const tools: Array<{ mode: ToolMode; label: string; icon: typeof ScanLine }> = [
    { mode: 'select', label: 'Select', icon: ScanLine },
    { mode: 'connect', label: 'Connect', icon: Network },
    { mode: 'group', label: 'Group', icon: SquareDashedMousePointer },
    { mode: 'label', label: 'Label', icon: Tags },
  ];

  const views: Array<{ view: DiagramViewMode; label: string }> = [
    { view: 'dependencies', label: 'All Connections' },
    { view: 'application-flow', label: 'Application Flow' },
    { view: 'network', label: 'Network' },
    { view: 'security', label: 'Security' },
    { view: 'monitoring', label: 'Monitoring' },
    { view: 'deployment', label: 'Deployment' },
  ];

  const detailModes: Array<{ mode: DiagramDetailMode; label: string }> = [
    { mode: 'overview', label: 'Overview' },
    { mode: 'architecture', label: 'Architecture' },
    { mode: 'full-topology', label: 'Full Topology' },
  ];

  function download(name: string, content: string, type: string) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    URL.revokeObjectURL(url);
    markSaved();
  }

  async function exportImage(format: 'png' | 'svg') {
    const element = document.querySelector('.react-flow') as HTMLElement | null;
    if (!element) return;
    const dataUrl = format === 'png' ? await toPng(element, { backgroundColor: effectiveIsDark ? '#0f172a' : '#f8fafc' }) : await toSvg(element);
    const link = document.createElement('a');
    link.download = `aws-architecture.${format}`;
    link.href = dataUrl;
    link.click();
    markSaved();
  }

  function exportJson() {
    download('aws-architecture.json', JSON.stringify({ nodes, edges }, null, 2), 'application/json');
  }

  function exportHcl() {
    download('architecture.tf', exportTerraform(nodes, edges), 'text/plain');
  }

  function importJson(file?: File) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        const snapshot = normalizeImportedDiagram(parsed);
        importDiagram(snapshot);
        requestAnimationFrame(() => flow.fitView({ padding: 0.16 }));
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unable to import this JSON file.';
        setAlertMessage(message);
      } finally {
        if (fileRef.current) fileRef.current.value = '';
      }
    };
    reader.onerror = () => {
      setAlertMessage('Unable to read this JSON file.');
      if (fileRef.current) fileRef.current.value = '';
    };
    reader.readAsText(file);
  }

  function autoLayout() {
    if (isArranging) return;
    setIsArranging(true);
    // Scoped to this one action (not a global rule) so ordinary node dragging and boundary
    // resizing stay perfectly 1:1 with the pointer — only an auto-layout reflow animates.
    const canvasShell = document.querySelector('.canvas-shell');
    canvasShell?.classList.add('canvas-shell--layout-transition');
    window.setTimeout(() => {
      void autoArrange().finally(() => {
      window.setTimeout(() => {
        canvasShell?.classList.remove('canvas-shell--layout-transition');
        setIsArranging(false);
      }, 420);
      });
    }, 0);
  }

  async function handleValidate() {
    validate();

    try {
      const result = await sendTerraformPayload({ nodes, edges, activeRegion });
      if (result.data?.nodes?.length && hasConfigUpdates(nodes, result.data.nodes)) {
        importDiagram({ nodes: result.data.nodes, edges: result.data.edges ?? edges });
      }
      console.info(result.message);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to send terraform payload.';
      setAlertMessage(message);
    }
  }

  return (
    <>
    {alertMessage && <PageAlert message={alertMessage} tone="error" onDismiss={() => setAlertMessage('')} />}
    <header className="toolbar">
      <div className="toolbar__section">
        {tools.map((tool) => {
          const Icon = tool.icon;
          return (
            <button key={tool.mode} className={`icon-button ${mode === tool.mode ? 'active' : ''}`} title={tool.label} onClick={() => setMode(tool.mode)}>
              <Icon size={18} />
            </button>
          );
        })}
        <select
          className="toolbar-select"
          title="Boundary type"
          value={boundaryKind}
          onChange={(event) => {
            const nextKind = event.target.value as GroupKind;
            setBoundaryKind('');
            addGroupNode(nextKind);
          }}
        >
          <option value="" disabled>
            Boundary
          </option>
          {groupKinds.map((kind) => (
            <option value={kind} key={kind}>
              {boundaryLabel(kind)}
            </option>
          ))}
        </select>
      </div>
      <div className="toolbar__section">
        <button className="icon-button" title="Undo" disabled={!history.length} onClick={undo}>
          <Undo2 size={18} />
        </button>
        <button className="icon-button" title="Redo" disabled={!future.length} onClick={redo}>
          <Redo2 size={18} />
        </button>
        <button className="icon-button danger-button" title="Delete selected" aria-label="Delete selected services" disabled={!hasSelection} onClick={deleteSelection}>
          <Trash2 size={18} />
        </button>
      </div>
      <div className="toolbar__section">
        <button className="icon-button" title="Zoom out" onClick={() => flow.zoomOut()}>
          <ZoomOut size={18} />
        </button>
        <span className="zoom-readout">{Math.round(viewport.zoom * 100)}%</span>
        <button className="icon-button" title="Zoom in" onClick={() => flow.zoomIn()}>
          <ZoomIn size={18} />
        </button>
        <button className="icon-button" title="Fit view — frame the whole diagram (separate from Auto-layout, which also repositions nodes)" onClick={() => flow.fitView({ padding: 0.18, duration: 320 })}>
          <Focus size={18} />
        </button>
      </div>
      <div className="toolbar__section toolbar__section--grow">
        <select
          aria-label="Diagram view"
          className="toolbar-select toolbar-select--view"
          title="Relationship filter"
          value={activeView}
          onChange={(event) => setActiveView(event.target.value as DiagramViewMode)}
        >
          {views.map((view) => (
            <option key={view.view} value={view.view}>
              {view.label}
            </option>
          ))}
        </select>
        <select
          aria-label="Diagram detail"
          className="toolbar-select toolbar-select--view"
          title="Diagram detail mode"
          value={detailMode}
          onChange={(event) => setDetailMode(event.target.value as DiagramDetailMode)}
        >
          {detailModes.map((mode) => (
            <option key={mode.mode} value={mode.mode}>
              {mode.label}
            </option>
          ))}
        </select>
        <details className="toolbar-tools-menu">
          <summary className="text-button toolbar-tools-menu__summary">
            <Wand2 size={16} />
            Diagram Tools
            <ChevronDown size={14} />
          </summary>
          <div className="toolbar-tools-menu__content">
            <button disabled={isArranging || !nodes.length} onClick={autoLayout} type="button">
              <LayoutGrid size={15} />
              {isArranging ? 'Arranging...' : 'Auto arrange'}
            </button>
            <button disabled={!selectedNodeId} onClick={isolateSelectedPath} type="button">
              <Focus size={15} />
              Isolate Path
            </button>
            <button onClick={resetDiagramFocus} type="button">
              <Focus size={15} />
              Reset View
            </button>
            <button onClick={exportHcl} type="button">
              <TerminalSquare size={15} />
              Generate Terraform
            </button>
          </div>
        </details>
        <button
          className={`text-button toolbar-validate-button ${isValidated ? 'toolbar-validate-button--ok' : ''}`}
          onClick={() => void handleValidate()}
          title={isValidated ? 'Diagram validated — re-run any time.' : 'Validate the diagram — required before Deploy unlocks.'}
          type="button"
        >
          {isValidated ? <CheckCircle2 size={15} /> : <SearchCheck size={15} />}
          {isValidated ? 'Validated' : 'Validate'}
        </button>
        <button
          className="text-button deploy-toolbar-button"
          disabled={!isValidated || blockingErrorCount > 0}
          title={
            blockingErrorCount > 0
              ? `${blockingErrorCount} blocking error${blockingErrorCount === 1 ? '' : 's'} must be fixed first — click Validate to see them.`
              : !isValidated
                ? 'Click Validate first — Deploy unlocks once the diagram has been validated with no blocking errors.'
                : undefined
          }
          onClick={() => {
            validate();
            onOpenDeployment?.();
          }}
        >
          <Rocket size={16} />
          Deploy
        </button>
        {onToggleFullscreen && (
          <button className="text-button" onClick={onToggleFullscreen}>
            {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            {isFullscreen ? 'Exit Full Screen' : 'Full Screen'}
          </button>
        )}
      </div>
      <div className="toolbar__section">
        <details className="toolbar-tools-menu toolbar-tools-menu--align-right">
          <summary className="text-button toolbar-tools-menu__summary">
            <Download size={16} />
            Export
            <ChevronDown size={14} />
          </summary>
          <div className="toolbar-tools-menu__content">
            <button onClick={() => fileRef.current?.click()} type="button">
              <Upload size={15} />
              Import JSON
            </button>
            <button onClick={exportJson} type="button">
              <FileJson size={15} />
              Export JSON
            </button>
            <button onClick={exportHcl} type="button">
              <FileCode2 size={15} />
              Export Terraform
            </button>
            <button onClick={() => exportImage('png')} type="button">
              <ImageDown size={15} />
              Export PNG
            </button>
            <button onClick={() => exportImage('svg')} type="button">
              <Download size={15} />
              Export SVG
            </button>
          </div>
        </details>
        <button
          className="text-button save-toolbar-button"
          title={saveDiagramTitle ?? saveDiagramLabel}
          disabled={!onSaveDiagram || !canSaveDiagram || isSavingDiagram}
          onClick={onSaveDiagram}
        >
          <Save size={16} />
          {isSavingDiagram ? 'Saving...' : saveDiagramLabel}
        </button>
        <input ref={fileRef} hidden type="file" accept="application/json" onChange={(event) => importJson(event.target.files?.[0])} />
      </div>
    </header>
    </>
  );
}

function boundaryLabel(kind: GroupKind): string {
  if (kind === 'VPC') return 'VPC boundary';
  if (kind === 'Public Subnet') return 'Public subnet boundary';
  if (kind === 'Private Subnet') return 'Private subnet boundary';
  if (kind === 'Security Group') return 'Security group boundary';
  if (kind === 'Availability Zone') return 'Availability zone boundary';
  return kind;
}

function hasConfigUpdates(currentNodes: AwsNode[], nextNodes: AwsNode[]): boolean {
  return nextNodes.some((node, index) => JSON.stringify(currentNodes[index]?.data?.config ?? {}) !== JSON.stringify(node.data?.config ?? {}));
}

export default Toolbar;
