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
  ScanSearch,
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
import { useEffect, useMemo, useRef } from 'react';
import { useState } from 'react';
import { toPng, toSvg } from 'html-to-image';
import { useReactFlow } from 'reactflow';
import CommandPalette, { type PaletteCommand } from './CommandPalette';
import { PageAlert } from './PageAlert';
import { getStoredUser } from '../auth/authClient';
import { groupKinds } from '../data/awsServices';
import { useDiagramStore } from '../store/diagramStore';
import { validateServiceAccess } from '../utils/accessControl';
import { exportTerraform } from '../utils/exportTerraform';
import { diagramStructureKey } from '../utils/graphIndex';
import { normalizeImportedDiagram } from '../utils/importDiagram';
import { sendTerraformPayload } from '../utils/terraformPayloadApi';
import { validateGeneratedTerraform } from '../utils/terraformValidation';
import { validateDiagram } from '../utils/validate';
import type { AwsNode, DiagramDetailMode, DiagramViewMode, GroupKind, RenderLensId, ToolMode } from '../types';
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
  const [isPaletteOpen, setIsPaletteOpen] = useState(false);
  const flow = useReactFlow();
  const nodes = useDiagramStore((state) => state.nodes);
  const edges = useDiagramStore((state) => state.edges);
  const selectedNodeId = useDiagramStore((state) => state.selectedNodeId);
  const selectedEdgeId = useDiagramStore((state) => state.selectedEdgeId);
  const mode = useDiagramStore((state) => state.mode);
  const activeView = useDiagramStore((state) => state.activeView);
  const detailMode = useDiagramStore((state) => state.detailMode);
  const activeRegion = useDiagramStore((state) => state.activeRegion);
  const isDark = useDiagramStore((state) => state.isDark);
  const isValidated = useDiagramStore((state) => state.isValidated);
  const history = useDiagramStore((state) => state.history);
  const future = useDiagramStore((state) => state.future);
  const setMode = useDiagramStore((state) => state.setMode);
  const setActiveView = useDiagramStore((state) => state.setActiveView);
  const setDetailMode = useDiagramStore((state) => state.setDetailMode);
  const addGroupNode = useDiagramStore((state) => state.addGroupNode);
  const isolateSelectedPath = useDiagramStore((state) => state.isolateSelectedPath);
  const resetDiagramFocus = useDiagramStore((state) => state.resetDiagramFocus);
  const undo = useDiagramStore((state) => state.undo);
  const redo = useDiagramStore((state) => state.redo);
  const deleteSelection = useDiagramStore((state) => state.deleteSelection);
  const validate = useDiagramStore((state) => state.validate);
  const importDiagram = useDiagramStore((state) => state.importDiagram);
  const autoArrange = useDiagramStore((state) => state.autoArrange);
  const markSaved = useDiagramStore((state) => state.markSaved);
  const whiteboardMode = useDiagramStore((state) => state.whiteboardMode);
  const architectureViewMode = useDiagramStore((state) => state.architectureViewMode);
  const setWhiteboardMode = useDiagramStore((state) => state.setWhiteboardMode);
  const setArchitectureViewMode = useDiagramStore((state) => state.setArchitectureViewMode);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setIsPaletteOpen((open) => !open);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);
  const selectedCount = nodes.filter((node) => node.selected).length + edges.filter((edge) => edge.selected).length;
  const hasSelection = selectedCount > 0 || Boolean(selectedNodeId) || Boolean(selectedEdgeId);
  const effectiveIsDark = theme ? theme === 'dark' : isDark;
  const user = useMemo(() => getStoredUser(), []);
  // Terraform generation and validation read configuration, never geometry — but `nodes` gets a new
  // identity on every pointer tick of a drag. Keyed on the structure alone, so dragging a node no
  // longer re-runs a full HCL export plus the whole validation suite on every frame.
  const structureKey = useMemo(() => diagramStructureKey(nodes, edges), [nodes, edges]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on structureKey by design.
  const liveTerraform = useMemo(() => exportTerraform(nodes, edges), [structureKey]);
  // Computed live rather than read from the store's `issues` field, which only updates when
  // validate() has actually been called — the Deploy gate needs to be correct even if the user never
  // clicked "Validate" first.
  const liveIssues = useMemo(
    () => [...validateDiagram(nodes, edges, activeRegion), ...validateGeneratedTerraform(liveTerraform), ...validateServiceAccess(nodes, user)],
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on structureKey by design.
    [activeRegion, liveTerraform, structureKey, user],
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

  // How the diagram is drawn, as opposed to which relationships it shows. These were previously
  // buried in a settings page as two independent booleans.
  const renderLenses: Array<{ id: RenderLensId; label: string; hint: string }> = [
    { id: 'diagram', label: 'Diagram', hint: 'Resource cards with configuration and readiness' },
    { id: 'whiteboard', label: 'Whiteboard', hint: 'Paper-style sketch for discussion' },
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

  // Clicking a node used to re-frame the whole canvas automatically. Framing is now something the
  // user asks for, and this is where they ask for it.
  function zoomToSelection() {
    const selectedNodeIds = new Set(nodes.filter((node) => node.selected).map((node) => node.id));
    if (selectedNodeId) selectedNodeIds.add(selectedNodeId);
    for (const edge of edges) {
      if (!edge.selected && edge.id !== selectedEdgeId) continue;
      selectedNodeIds.add(edge.source);
      selectedNodeIds.add(edge.target);
    }

    const targets = Array.from(selectedNodeIds).filter((id) => nodes.some((node) => node.id === id));
    if (!targets.length) return;
    flow.fitView({
      nodes: targets.map((id) => ({ id })),
      padding: targets.length === 1 ? 0.44 : 0.24,
      duration: 260,
      maxZoom: targets.length === 1 ? 1.6 : 1.42,
    });
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


  const paletteCommands = useMemo<PaletteCommand[]>(
    () => [
      { id: 'validate', label: 'Validate diagram', hint: 'Check before deploy', run: () => void handleValidate() },
      { id: 'auto-arrange', label: 'Auto arrange', hint: 'Re-layout the canvas', run: autoLayout },
      { id: 'fit', label: 'Fit view', hint: 'Frame everything', run: () => flow.fitView({ padding: 0.18, duration: 260 }) },
      { id: 'zoom-selection', label: 'Zoom to selection', run: zoomToSelection },
      { id: 'isolate', label: 'Isolate path', hint: 'Upstream and downstream', run: isolateSelectedPath },
      { id: 'reset-focus', label: 'Reset view', run: resetDiagramFocus },
      { id: 'terraform', label: 'Export Terraform', run: exportHcl },
      { id: 'export-json', label: 'Export JSON', run: exportJson },
      { id: 'deploy', label: 'Open deployment', hint: 'Needs a validated diagram', run: () => onOpenDeployment?.() },
      // Render lenses live here rather than in the lens bar, which the wireframe reserves for
      // relationship filters. They were previously reachable only from a settings page.
      ...renderLenses.map((lens) => ({
        id: `lens-${lens.id}`,
        label: `Draw as: ${lens.label}`,
        hint: lens.hint,
        run: () => applyRenderLens(lens.id),
      })),
    ],
    // Deliberately closes over current values; commands read them at the moment they run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [flow, isolateSelectedPath, onOpenDeployment, resetDiagramFocus],
  );

  const renderLens: RenderLensId = whiteboardMode ? 'whiteboard' : 'diagram';

  // Always sets both flags, never just the one being turned on. The architecture skin is no longer
  // offered here, so if anything else leaves it enabled, picking Diagram still returns you to the
  // resource cards rather than stranding you in a lens with no control.
  function applyRenderLens(lens: RenderLensId) {
    setWhiteboardMode(lens === 'whiteboard');
    setArchitectureViewMode(false);
  }

  return (
    <>
      {alertMessage && <PageAlert message={alertMessage} tone="error" onDismiss={() => setAlertMessage('')} />}
      <CommandPalette isOpen={isPaletteOpen} onClose={() => setIsPaletteOpen(false)} commands={paletteCommands} />

      {/* Row 1 — command bar: find, build, undo, then the deploy gate. */}
      <header className="builder-bar">
        <button className="bx-omni" onClick={() => setIsPaletteOpen(true)} type="button">
          <SearchCheck size={14} />
          Search or add a resource
          <kbd className="bx-omni__hint">{isMacPlatform() ? '⌘K' : 'Ctrl K'}</kbd>
        </button>

        <span className="builder-bar__divider" />

        {tools.map((tool) => {
          const Icon = tool.icon;
          return (
            <button
              key={tool.mode}
              className={`bx-button bx-button--icon ${mode === tool.mode ? 'bx-button--active' : ''}`}
              title={tool.label}
              aria-label={tool.label}
              aria-pressed={mode === tool.mode}
              onClick={() => setMode(tool.mode)}
              type="button"
            >
              <Icon size={16} />
            </button>
          );
        })}

        <select
          className="toolbar-select"
          aria-label="Add a boundary"
          title="Add a boundary"
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

        <span className="builder-bar__divider" />

        <button className="bx-button bx-button--icon" title="Undo" aria-label="Undo" disabled={!history.length} onClick={undo} type="button">
          <Undo2 size={16} />
        </button>
        <button className="bx-button bx-button--icon" title="Redo" aria-label="Redo" disabled={!future.length} onClick={redo} type="button">
          <Redo2 size={16} />
        </button>
        <button
          className="bx-button bx-button--icon bx-button--danger"
          title="Delete selected"
          aria-label="Delete selected"
          disabled={!hasSelection}
          onClick={deleteSelection}
          type="button"
        >
          <Trash2 size={16} />
        </button>

        <span className="builder-bar__spacer" />

        {blockingErrorCount > 0 ? (
          <span className="bx-count bx-count--error" title="These must be fixed before Deploy unlocks.">
            {blockingErrorCount} blocking
          </span>
        ) : (
          <span className="bx-count bx-count--ok">No blocking issues</span>
        )}

        <button
          className={`bx-button ${isValidated ? 'bx-button--active' : ''}`}
          onClick={() => void handleValidate()}
          title={isValidated ? 'Diagram validated — re-run any time.' : 'Validate the diagram — required before Deploy unlocks.'}
          type="button"
        >
          {isValidated ? <CheckCircle2 size={15} /> : <SearchCheck size={15} />}
          {isValidated ? 'Validated' : 'Validate'}
        </button>

        <button
          className="bx-button bx-button--primary"
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
          type="button"
        >
          <Rocket size={15} />
          Deploy
        </button>

        <span className="builder-bar__divider" />

        <details className="toolbar-tools-menu toolbar-tools-menu--align-right">
          <summary className="bx-button toolbar-tools-menu__summary">
            <Download size={15} />
            Export
            <ChevronDown size={13} />
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
          className="bx-button"
          title={saveDiagramTitle ?? saveDiagramLabel}
          disabled={!onSaveDiagram || !canSaveDiagram || isSavingDiagram}
          onClick={onSaveDiagram}
          type="button"
        >
          <Save size={15} />
          {isSavingDiagram ? 'Saving...' : saveDiagramLabel}
        </button>

        {onToggleFullscreen && (
          <button
            className="bx-button bx-button--icon"
            title={isFullscreen ? 'Exit full screen' : 'Full screen'}
            aria-label={isFullscreen ? 'Exit full screen' : 'Full screen'}
            onClick={onToggleFullscreen}
            type="button"
          >
            {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>
        )}

        <input ref={fileRef} hidden type="file" accept="application/json" onChange={(event) => importJson(event.target.files?.[0])} />
      </header>

      {/* Row 2 — lens bar: how the diagram is drawn, and which relationships it shows. The render
          lenses used to be reachable only from a settings page, which is why nobody found them. */}
      <div className="builder-bar builder-bar--lens">
        <span className="builder-bar__label">Lens</span>
        {views.map((view) => (
          <button
            key={view.view}
            className={`bx-chip ${activeView === view.view ? 'bx-chip--active' : ''}`}
            aria-pressed={activeView === view.view}
            onClick={() => setActiveView(view.view)}
            type="button"
          >
            {view.label}
          </button>
        ))}

        <span className="builder-bar__divider" />

        <select
          aria-label="Detail level"
          className="toolbar-select toolbar-select--view"
          title="How much of the diagram to draw"
          value={detailMode}
          onChange={(event) => setDetailMode(event.target.value as DiagramDetailMode)}
        >
          {detailModes.map((item) => (
            <option key={item.mode} value={item.mode}>
              {item.label}
            </option>
          ))}
        </select>

        <span className="builder-bar__divider" />

        {/* The render lens has to stay visible. It persists in localStorage, so a Whiteboard or
            Architecture setting from an earlier session survives a reload — and while it was only
            reachable from the command palette, there was no way to see which lens was active or get
            back to the resource cards. */}
        <span className="builder-bar__label">Draw</span>
        <span className="bx-segmented" role="group" aria-label="Render lens">
          {renderLenses.map((lens) => (
            <button
              key={lens.id}
              className={`bx-segmented__option ${renderLens === lens.id ? 'bx-segmented__option--active' : ''}`}
              aria-pressed={renderLens === lens.id}
              title={lens.hint}
              onClick={() => applyRenderLens(lens.id)}
              type="button"
            >
              {lens.label}
            </button>
          ))}
        </span>

        <span className="builder-bar__spacer" />

        <button className="bx-button" title="Frame the whole diagram" onClick={() => flow.fitView({ padding: 0.18, duration: 260 })} type="button">
          Fit
        </button>
        <button className="bx-button" disabled={isArranging || !nodes.length} onClick={autoLayout} type="button">
          <LayoutGrid size={15} />
          {isArranging ? 'Arranging...' : 'Auto arrange'}
        </button>
      </div>
    </>
  );
}

function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
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
