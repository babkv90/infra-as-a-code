import { apiRequest, API_BASE_URL } from '../utils/apiClient';

// Client for the landing page's Progress Timeline / changelog blog. Backed by a live scan of a
// few doc folders (IAAS backend/src/services/timelineScanner.js) rather than a database table —
// there's no "create post" step, dropping a file into one of those folders is the entire publish
// flow. Public endpoint, no auth required.
const timelineRequest = <T,>(path: string, init?: RequestInit) => apiRequest<T>(path, init, 'Timeline request failed');

export type TimelineEntry = {
  id: string;
  title: string;
  date: string;
  summary: string;
  pageCount?: number;
  sizeBytes: number;
  ext: 'pdf' | 'md' | 'docx';
  tags: string[];
  sourceFileName: string;
  order: number;
};

export type TimelineResponse = {
  entries: TimelineEntry[];
  generatedAt: number;
};

// Mirrors timelineScanner.js's parseMarkdownBlocks/parseParagraphBlocks output exactly — PDF/docx
// sources only ever produce 'heading' (rarely) and 'paragraph' blocks; only real markdown source
// files produce the richer types (code/table/blockquote/image, ordered/task list items).
export type TimelineBlock =
  | { type: 'heading'; level: number; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list-item'; text: string; ordered?: boolean; checked?: boolean }
  | { type: 'code'; language: string; code: string }
  | { type: 'table'; headers: string[]; rows: string[][] }
  | { type: 'blockquote'; text: string; calloutType?: 'note' | 'tip' | 'warning' | 'important' | 'caution' }
  | { type: 'image'; src: string; alt: string; caption?: string };

export type TimelineEntryDetail = {
  entry: TimelineEntry;
  blocks: TimelineBlock[];
  readingTimeMinutes: number;
};

export async function getTimelineEntries(options: { forceRefresh?: boolean } = {}) {
  const query = options.forceRefresh ? '?refresh=true' : '';
  return timelineRequest<TimelineResponse>(`/timeline${query}`);
}

/** GET /timeline/:id — full body for the in-app article reader (TimelineArticlePage.tsx). */
export async function getTimelineEntry(id: string) {
  return timelineRequest<TimelineEntryDetail>(`/timeline/${id}`);
}

// Not run through apiRequest — this is a direct link/download target for an <a> tag, not a fetch
// call the app makes itself.
export function timelineFileUrl(id: string) {
  return `${API_BASE_URL}/timeline/${id}/file`;
}
