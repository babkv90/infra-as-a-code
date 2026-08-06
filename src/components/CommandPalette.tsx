import { useEffect, useMemo, useRef, useState } from 'react';
import { useReactFlow } from 'reactflow';
import { awsServices } from '../data/awsServices';
import { useDiagramStore } from '../store/diagramStore';
import { getStoredUser } from '../auth/authClient';
import { isServiceAllowedForUser } from '../utils/accessControl';

export type PaletteCommand = {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
};

type PaletteEntry =
  | { kind: 'service'; id: string; label: string; group: string; color: string; meta: string; run: () => void }
  | { kind: 'command'; id: string; label: string; group: string; meta: string; run: () => void };

/**
 * Keyboard path to the things the toolbar exposes by mouse: place a resource at the centre of the
 * viewport, jump to a node already on the canvas, or run a builder command.
 */
function CommandPalette({ isOpen, onClose, commands }: { isOpen: boolean; onClose: () => void; commands: PaletteCommand[] }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const reactFlow = useReactFlow();
  const nodes = useDiagramStore((state) => state.nodes);
  const addServiceNode = useDiagramStore((state) => state.addServiceNode);
  const setSelection = useDiagramStore((state) => state.setSelection);
  const user = useMemo(() => getStoredUser(), []);

  useEffect(() => {
    if (!isOpen) return;
    setQuery('');
    setActiveIndex(0);
    // Focus after the element exists; autoFocus alone loses the race with the backdrop mount.
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [isOpen]);

  const entries = useMemo<PaletteEntry[]>(() => {
    const normalized = query.trim().toLowerCase();
    const matches = (text: string) => !normalized || text.toLowerCase().includes(normalized);

    const commandEntries: PaletteEntry[] = commands
      .filter((command) => matches(command.label))
      .map((command) => ({ kind: 'command', id: command.id, label: command.label, group: 'Commands', meta: command.hint ?? '', run: command.run }));

    const serviceEntries: PaletteEntry[] = awsServices
      .filter((service) => isServiceAllowedForUser(service.id, user))
      .filter((service) => matches(`${service.name} ${service.category} ${service.shortName}`))
      .map((service) => ({
        kind: 'service',
        id: `service-${service.id}`,
        label: service.name,
        group: 'Add resource',
        color: service.color,
        meta: service.category,
        run: () => {
          // Place at the centre of what the user is actually looking at.
          const { x, y, zoom } = reactFlow.getViewport();
          const bounds = document.querySelector('.canvas-shell')?.getBoundingClientRect();
          const centerX = bounds ? bounds.width / 2 : 480;
          const centerY = bounds ? bounds.height / 2 : 320;
          addServiceNode(service.id, { x: (centerX - x) / zoom, y: (centerY - y) / zoom });
        },
      }));

    const nodeEntries: PaletteEntry[] = normalized
      ? nodes
          .filter((node) => node.type === 'awsService' && matches(node.data.label || node.data.serviceName))
          .slice(0, 6)
          .map((node) => ({
            kind: 'command',
            id: `node-${node.id}`,
            label: node.data.label || node.data.serviceName,
            group: 'Go to',
            meta: node.data.serviceName,
            run: () => {
              setSelection(node.id, undefined);
              reactFlow.fitView({ nodes: [{ id: node.id }], padding: 0.44, duration: 260, maxZoom: 1.6 });
            },
          }))
      : [];

    return [...commandEntries, ...nodeEntries, ...serviceEntries].slice(0, 40);
  }, [addServiceNode, commands, nodes, query, reactFlow, setSelection, user]);

  useEffect(() => {
    setActiveIndex((index) => Math.min(index, Math.max(0, entries.length - 1)));
  }, [entries.length]);

  if (!isOpen) return null;

  function runEntry(entry: PaletteEntry) {
    entry.run();
    onClose();
  }

  const groups = entries.reduce<Array<{ group: string; items: PaletteEntry[] }>>((accumulator, entry) => {
    const last = accumulator[accumulator.length - 1];
    if (last && last.group === entry.group) last.items.push(entry);
    else accumulator.push({ group: entry.group, items: [entry] });
    return accumulator;
  }, []);

  return (
    <div className="bx-palette-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="bx-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Builder command palette"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <input
          ref={inputRef}
          className="bx-palette__input"
          placeholder="Search resources and commands"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              onClose();
            } else if (event.key === 'ArrowDown') {
              event.preventDefault();
              setActiveIndex((index) => (entries.length ? (index + 1) % entries.length : 0));
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setActiveIndex((index) => (entries.length ? (index - 1 + entries.length) % entries.length : 0));
            } else if (event.key === 'Enter') {
              event.preventDefault();
              const entry = entries[activeIndex];
              if (entry) runEntry(entry);
            }
          }}
        />

        {entries.length === 0 ? (
          <p className="bx-palette__empty">Nothing matches “{query}”.</p>
        ) : (
          <ul className="bx-palette__list" role="listbox">
            {groups.map((group) => (
              <li key={group.group}>
                <div className="bx-palette__group">{group.group}</div>
                <ul role="presentation" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                  {group.items.map((entry) => {
                    const index = entries.indexOf(entry);
                    return (
                      <li key={entry.id} role="presentation">
                        <button
                          className="bx-palette__item"
                          role="option"
                          aria-selected={index === activeIndex}
                          type="button"
                          onMouseEnter={() => setActiveIndex(index)}
                          onClick={() => runEntry(entry)}
                        >
                          {entry.kind === 'service' && <span className="bx-palette__swatch" style={{ background: entry.color }} />}
                          <span>{entry.label}</span>
                          {entry.meta && <span className="bx-palette__item-meta">{entry.meta}</span>}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default CommandPalette;
