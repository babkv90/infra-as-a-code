import {
  Download,
  FileCode2,
  FileJson,
  ImageDown,
  Maximize2,
  Minimize2,
  Network,
  Redo2,
  Rocket,
  Save,
  ScanLine,
  SearchCheck,
  ShieldCheck,
  SquareDashedMousePointer,
  Tags,
  TerminalSquare,
  Trash2,
  Undo2,
  Upload,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useRef } from 'react';
import { toPng, toSvg } from 'html-to-image';
import { useReactFlow, useViewport } from 'reactflow';
import { groupKinds } from '../data/awsServices';
import { useDiagramStore } from '../store/diagramStore';
import { exportTerraform } from '../utils/exportTerraform';
import { applyEnterpriseLayout, normalizeImportedDiagram } from '../utils/importDiagram';
import { sendTerraformPayload } from '../utils/terraformPayloadApi';
import type { AwsNode, DiagramViewMode, GroupKind, ToolMode } from '../types';
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
  const flow = useReactFlow();
  const viewport = useViewport();
  const {
    nodes,
    edges,
    selectedNodeId,
    selectedEdgeId,
    mode,
    activeView,
    activeRegion,
    isDark,
    issues,
    history,
    future,
    setMode,
    setActiveView,
    addGroupNode,
    undo,
    redo,
    deleteSelection,
    resetDiagramFocus,
    validate,
    importDiagram,
    markSaved,
  } = useDiagramStore();
  const selectedCount = nodes.filter((node) => node.selected).length + edges.filter((edge) => edge.selected).length;
  const hasSelection = selectedCount > 0 || Boolean(selectedNodeId) || Boolean(selectedEdgeId);
  const effectiveIsDark = theme ? theme === 'dark' : isDark;

  const tools: Array<{ mode: ToolMode; label: string; icon: typeof ScanLine }> = [
    { mode: 'select', label: 'Select', icon: ScanLine },
    { mode: 'connect', label: 'Connect', icon: Network },
    { mode: 'group', label: 'Group', icon: SquareDashedMousePointer },
    { mode: 'label', label: 'Label', icon: Tags },
  ];

  const views: Array<{ view: DiagramViewMode; label: string; icon: typeof Network }> = [
    { view: 'topology', label: 'Topology', icon: Network },
    { view: 'dependencies', label: 'Dependencies', icon: TerminalSquare },
    { view: 'security', label: 'Security', icon: ShieldCheck },
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
        window.alert(message);
      } finally {
        if (fileRef.current) fileRef.current.value = '';
      }
    };
    reader.onerror = () => {
      window.alert('Unable to read this JSON file.');
      if (fileRef.current) fileRef.current.value = '';
    };
    reader.readAsText(file);
  }

  function autoLayout() {
    useDiagramStore.setState({ nodes: applyEnterpriseLayout(nodes, edges) });
    requestAnimationFrame(() => flow.fitView({ padding: 0.18 }));
  }

  async function handleValidate() {
    validate();

    try {
      const result = await sendTerraformPayload({ nodes, edges, activeRegion });
      if (result.data?.nodes?.length && hasAmiUpdates(nodes, result.data.nodes)) {
        importDiagram({ nodes: result.data.nodes, edges: result.data.edges ?? edges });
      }
      console.info(result.message);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to send terraform payload.';
      window.alert(message);
    }
  }

  return (
    <>
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
          onChange={(event) => addGroupNode(event.target.value as GroupKind)}
          defaultValue=""
        >
          <option value="" disabled>
            Boundary
          </option>
          {groupKinds.map((kind) => (
            <option value={kind} key={kind}>
              {kind}
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
        <button
          className="text-button"
          onClick={() => {
            resetDiagramFocus();
            requestAnimationFrame(() => flow.fitView({ padding: 0.12, maxZoom: 1.1 }));
          }}
        >
          <Maximize2 size={16} />
          Full diagram
        </button>
      </div>
      <div className="toolbar__section toolbar__section--grow">
        <div className="view-switcher" aria-label="Diagram view">
          {views.map((view) => {
            const Icon = view.icon;
            return (
              <button
                className={activeView === view.view ? 'active' : ''}
                key={view.view}
                onClick={() => setActiveView(view.view)}
                title={`${view.label} view`}
                type="button"
              >
                <Icon size={15} />
                {view.label}
              </button>
            );
          })}
        </div>
        <button className="text-button" onClick={autoLayout}>
          Auto-layout
        </button>
        <button className="text-button" onClick={() => void handleValidate()}>
          <SearchCheck size={16} />
          Validate
        </button>
        <button className="text-button" onClick={exportHcl}>
          <TerminalSquare size={16} />
          Generate Terraform
        </button>
        <button
          className="text-button deploy-toolbar-button"
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
        <button className="icon-button" title="Import JSON" onClick={() => fileRef.current?.click()}>
          <Upload size={18} />
        </button>
        <button className="icon-button" title="Export JSON" onClick={exportJson}>
          <FileJson size={18} />
        </button>
        <button className="icon-button" title="Export Terraform" onClick={exportHcl}>
          <FileCode2 size={18} />
        </button>
        <button className="icon-button" title="Export PNG" onClick={() => exportImage('png')}>
          <ImageDown size={18} />
        </button>
        <button className="icon-button" title="Export SVG" onClick={() => exportImage('svg')}>
          <Download size={18} />
        </button>
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

function hasAmiUpdates(currentNodes: AwsNode[], nextNodes: AwsNode[]): boolean {
  return nextNodes.some((node, index) => String(currentNodes[index]?.data?.config?.ami ?? '') !== String(node.data?.config?.ami ?? ''));
}

export default Toolbar;
