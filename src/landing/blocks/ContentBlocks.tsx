// Renders the article body's block list into rich, dedicated components — the successor to the
// old flat heading/paragraph/list-item-only renderer. One block type maps to one renderer here;
// see timelineApi.ts's TimelineBlock union for the full set this has to handle.
import { AlertTriangle, Info, Lightbulb, Link as LinkIcon, ShieldAlert } from 'lucide-react';
import { Fragment, useState } from 'react';
import type { ThemeMode } from '../../theme';
import { CodeBlock } from './CodeBlock';
import { renderInlineMarkdown } from './inlineMarkdown';
import { MermaidDiagram } from './MermaidDiagram';
import type { TimelineBlock } from '../timelineApi';

// --- Heading anchors: one slug per heading block, computed once and shared between the in-body
// anchor links and the table-of-contents outline so the two can never drift apart. ---

function slugify(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 64);
}

/** One id per block (empty string for non-heading blocks), deduped against repeated heading text. */
export function computeHeadingIds(blocks: TimelineBlock[]): string[] {
  const seen = new Map<string, number>();
  return blocks.map((block) => {
    if (block.type !== 'heading') return '';
    const base = slugify(block.text) || 'section';
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}-${count + 1}`;
  });
}

export type HeadingOutlineEntry = { id: string; text: string; level: number };

export function getHeadingOutline(blocks: TimelineBlock[]): HeadingOutlineEntry[] {
  const ids = computeHeadingIds(blocks);
  return blocks
    .map((block, index) => (block.type === 'heading' && block.level <= 3 ? { id: ids[index], text: block.text, level: block.level } : null))
    .filter((entry): entry is HeadingOutlineEntry => entry !== null);
}

// --- Blockquote / callout ---

const CALLOUT_META = {
  note: { Icon: Info, label: 'Note' },
  tip: { Icon: Lightbulb, label: 'Tip' },
  important: { Icon: ShieldAlert, label: 'Important' },
  warning: { Icon: AlertTriangle, label: 'Warning' },
  caution: { Icon: AlertTriangle, label: 'Caution' },
} as const;

function BlockquoteBlock({ block }: { block: Extract<TimelineBlock, { type: 'blockquote' }> }) {
  if (block.calloutType) {
    const { Icon, label } = CALLOUT_META[block.calloutType];
    return (
      <div className={`timeline-callout timeline-callout--${block.calloutType}`}>
        <Icon className="timeline-callout__icon" size={17} />
        <div>
          <strong className="timeline-callout__label">{label}</strong>
          <p>{renderInlineMarkdown(block.text)}</p>
        </div>
      </div>
    );
  }
  return (
    <blockquote className="timeline-quote">
      <p>{renderInlineMarkdown(block.text)}</p>
    </blockquote>
  );
}

// --- Table ---

function TableBlock({ block }: { block: Extract<TimelineBlock, { type: 'table' }> }) {
  return (
    <div className="timeline-table-wrap">
      <table className="timeline-table">
        <thead>
          <tr>
            {block.headers.map((header, index) => (
              <th key={index}>{renderInlineMarkdown(header)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => (
                <td key={cellIndex}>{renderInlineMarkdown(cell)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// --- Image ---

function ImageBlock({ block }: { block: Extract<TimelineBlock, { type: 'image' }> }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <figure className="timeline-figure">
      <img alt={block.alt} className={`timeline-figure__img${loaded ? ' timeline-figure__img--loaded' : ''}`} loading="lazy" onLoad={() => setLoaded(true)} src={block.src} />
      {block.caption && <figcaption>{block.caption}</figcaption>}
    </figure>
  );
}

// --- Lists: consecutive list-item blocks of the same kind (ordered vs unordered, task vs plain)
// group into one <ol>/<ul> rather than one list per item. ---

type ListItemBlock = Extract<TimelineBlock, { type: 'list-item' }>;
type BlockGroup = { type: 'list'; ordered: boolean; items: ListItemBlock[]; key: number } | { type: 'single'; block: TimelineBlock; index: number; key: number };

function groupBlocks(blocks: TimelineBlock[]): BlockGroup[] {
  const groups: BlockGroup[] = [];
  blocks.forEach((block, index) => {
    const last = groups[groups.length - 1];
    if (block.type === 'list-item' && last?.type === 'list' && last.ordered === Boolean(block.ordered)) {
      last.items.push(block);
    } else if (block.type === 'list-item') {
      groups.push({ type: 'list', ordered: Boolean(block.ordered), items: [block], key: groups.length });
    } else {
      groups.push({ type: 'single', block, index, key: groups.length });
    }
  });
  return groups;
}

function ListGroup({ group }: { group: Extract<BlockGroup, { type: 'list' }> }) {
  const ListTag = group.ordered ? 'ol' : 'ul';
  return (
    <ListTag>
      {group.items.map((item, index) =>
        typeof item.checked === 'boolean' ? (
          <li className="timeline-task-item" key={index}>
            <span aria-hidden="true" className={`timeline-task-item__box${item.checked ? ' timeline-task-item__box--checked' : ''}`} />
            <span className={item.checked ? 'timeline-task-item__text--done' : ''}>{renderInlineMarkdown(item.text)}</span>
          </li>
        ) : (
          <li key={index}>{renderInlineMarkdown(item.text)}</li>
        ),
      )}
    </ListTag>
  );
}

// --- Top-level renderer ---

const HEADING_TAGS = ['h1', 'h2', 'h3', 'h4'] as const;

export function ArticleBody({ blocks, headingIds, theme }: { blocks: TimelineBlock[]; headingIds: string[]; theme: ThemeMode }) {
  return (
    <div className="timeline-article__body">
      {groupBlocks(blocks).map((group) => {
        if (group.type === 'list') return <ListGroup group={group} key={group.key} />;

        const { block, index } = group;
        switch (block.type) {
          case 'heading': {
            const Tag = HEADING_TAGS[Math.min(block.level, 4) - 1];
            const id = headingIds[index];
            return (
              <Tag className="timeline-heading" id={id} key={group.key}>
                {renderInlineMarkdown(block.text)}
                {id && (
                  <a aria-label="Link to this section" className="timeline-heading__anchor" href={`#${id}`}>
                    <LinkIcon size={15} />
                  </a>
                )}
              </Tag>
            );
          }
          case 'paragraph':
            return <p key={group.key}>{renderInlineMarkdown(block.text)}</p>;
          case 'code':
            return block.language === 'mermaid' ? (
              <MermaidDiagram code={block.code} key={group.key} theme={theme} />
            ) : (
              <CodeBlock code={block.code} key={group.key} language={block.language} />
            );
          case 'table':
            return <TableBlock block={block} key={group.key} />;
          case 'blockquote':
            return <BlockquoteBlock block={block} key={group.key} />;
          case 'image':
            return <ImageBlock block={block} key={group.key} />;
          default:
            return <Fragment key={group.key} />;
        }
      })}
    </div>
  );
}
