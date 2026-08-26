// Turns the raw markdown inline syntax that survives in block text (see timelineScanner.js's
// parseMarkdownBlocks — it deliberately does NOT strip inline markdown) into styled React nodes:
// `code spans`, **bold**, _italic_/*italic*, and [links](url). Deliberately not a full markdown
// parser — no nesting, no escaping rules — just the handful of inline forms these documents
// actually use.
import type { ReactNode } from 'react';

const INLINE_PATTERN = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[[^\]]+\]\([^)]+\))|(_[^_]+_|\*[^*]+\*)/g;

export function renderInlineMarkdown(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;

  for (const match of text.matchAll(INLINE_PATTERN)) {
    const [full, code, bold, link, italic] = match;
    const index = match.index ?? 0;
    if (index > lastIndex) nodes.push(text.slice(lastIndex, index));

    if (code) {
      nodes.push(
        <code className="timeline-inline-code" key={key++}>
          {code.slice(1, -1)}
        </code>,
      );
    } else if (bold) {
      nodes.push(<strong key={key++}>{bold.slice(2, -2)}</strong>);
    } else if (link) {
      const linkMatch = link.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      nodes.push(
        linkMatch ? (
          <a className="timeline-inline-link" href={linkMatch[2]} key={key++} rel="noreferrer" target="_blank">
            {linkMatch[1]}
          </a>
        ) : (
          full
        ),
      );
    } else if (italic) {
      nodes.push(<em key={key++}>{italic.slice(1, -1)}</em>);
    }

    lastIndex = index + full.length;
  }

  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}
