// Renders a `mermaid` code block (see timelineScanner.js's parser — a fenced ```mermaid block is
// otherwise indistinguishable from any other code block) as a real interactive SVG diagram rather
// than a wall of diagram-description text. Re-renders whenever the site theme changes, since
// mermaid bakes its color choices into the SVG at render time rather than via CSS variables.
import { Minus, Plus, RotateCcw } from 'lucide-react';
import { type PointerEvent, useEffect, useRef, useState } from 'react';
import type { ThemeMode } from '../../theme';

let mermaidIdCounter = 0;
const MIN_SCALE = 0.5;
const MAX_SCALE = 3;

export function MermaidDiagram({ code, theme }: { code: string; theme: ThemeMode }) {
  const [svg, setSvg] = useState('');
  const [error, setError] = useState('');
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragState = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);

  useEffect(() => {
    let isCurrent = true;
    setScale(1);
    setOffset({ x: 0, y: 0 });

    // Loaded dynamically: mermaid is a sizeable dependency and only the article pages that
    // actually contain a mermaid block need to pay for it.
    import('mermaid').then(async ({ default: mermaid }) => {
      if (!isCurrent) return;
      mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: theme === 'dark' ? 'dark' : 'default', fontFamily: 'Inter, sans-serif' });

      try {
        const { svg: renderedSvg } = await mermaid.render(`timeline-mermaid-${++mermaidIdCounter}`, code);
        if (isCurrent) {
          setSvg(renderedSvg);
          setError('');
        }
      } catch (renderError) {
        if (isCurrent) setError(renderError instanceof Error ? renderError.message : 'Unable to render this diagram.');
      }
    });

    return () => {
      isCurrent = false;
    };
  }, [code, theme]);

  function zoomBy(delta: number) {
    setScale((current) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, Number((current + delta).toFixed(2)))));
  }

  function reset() {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (scale <= 1) return;
    dragState.current = { startX: event.clientX, startY: event.clientY, originX: offset.x, originY: offset.y };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!dragState.current) return;
    setOffset({ x: dragState.current.originX + (event.clientX - dragState.current.startX), y: dragState.current.originY + (event.clientY - dragState.current.startY) });
  }

  function onPointerUp() {
    dragState.current = null;
  }

  if (error) {
    return (
      <div className="timeline-diagram timeline-diagram--error">
        <p>Unable to render this diagram.</p>
      </div>
    );
  }

  return (
    <div className="timeline-diagram">
      <div
        className="timeline-diagram__viewport"
        onPointerDown={onPointerDown}
        onPointerLeave={onPointerUp}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        {svg ? (
          // Mermaid's own render() output — generated server-side by this same app from a trusted
          // docs folder, not arbitrary third-party HTML, and rendered with securityLevel: 'strict'.
          <div
            className="timeline-diagram__canvas"
            dangerouslySetInnerHTML={{ __html: svg }}
            style={{ cursor: scale > 1 ? 'grab' : 'default', transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }}
          />
        ) : (
          <div className="timeline-diagram__loading">Rendering diagram...</div>
        )}
      </div>
      <div className="timeline-diagram__controls">
        <button aria-label="Zoom out" disabled={scale <= MIN_SCALE} onClick={() => zoomBy(-0.25)} type="button">
          <Minus size={14} />
        </button>
        <button aria-label="Reset zoom" onClick={reset} type="button">
          <RotateCcw size={14} />
        </button>
        <button aria-label="Zoom in" disabled={scale >= MAX_SCALE} onClick={() => zoomBy(0.25)} type="button">
          <Plus size={14} />
        </button>
      </div>
    </div>
  );
}
