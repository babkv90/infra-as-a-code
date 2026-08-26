// Sticky "on this page" outline for the article reader — only rendered/visible on wide viewports
// (see the .timeline-toc media query) since there's no room for it without shrinking the reading
// column, which the width-parity requirement with the list page rules out. Tracks which section is
// current via IntersectionObserver rather than a scroll-position calculation.
import { useEffect, useState } from 'react';
import type { HeadingOutlineEntry } from './ContentBlocks';

export function TableOfContents({ headings }: { headings: HeadingOutlineEntry[] }) {
  const [activeId, setActiveId] = useState('');

  useEffect(() => {
    const elements = headings.map((heading) => document.getElementById(heading.id)).filter((el): el is HTMLElement => el !== null);
    if (!elements.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting);
        if (visible.length > 0) {
          setActiveId(visible[0].target.id);
        }
      },
      { rootMargin: '-96px 0px -70% 0px', threshold: 0 },
    );

    elements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [headings]);

  if (headings.length < 3) return null;

  return (
    <nav aria-label="On this page" className="timeline-toc">
      <span className="timeline-toc__label">On this page</span>
      <ul>
        {headings.map((heading) => (
          <li className={`timeline-toc__level-${heading.level}`} key={heading.id}>
            <a aria-current={activeId === heading.id ? 'true' : undefined} className={activeId === heading.id ? 'timeline-toc__link--active' : ''} href={`#${heading.id}`}>
              {heading.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
