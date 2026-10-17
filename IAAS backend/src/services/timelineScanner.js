// Powers the landing page's Progress Timeline / changelog blog (src/landing/TimelinePage.tsx).
// Scans a configurable set of folders (env.js's TIMELINE_SOURCE_DIRS — a mix of in-repo doc
// folders and a machine-local notes folder) for .pdf/.md/.docx files, turns each one into a
// lightweight "blog post" entry (title, date, short summary), and caches the result in memory for
// TIMELINE_CACHE_TTL_MS so normal page loads don't re-parse every PDF on every request. There is
// deliberately no database table backing this — the filesystem itself is the source of truth, so
// dropping a new document into one of those folders is the entire "publishing" step.
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { env } from '../config/env.js';

// pdf-parse (pdfjs + a native canvas binary, Node >= 20.16) and mammoth are loaded on first use,
// not at import: this module is reachable from every route, so a top-level import that fails on
// the host would take the whole API down instead of failing just the one document scan.
const loadPdfParse = () => import('pdf-parse');
const loadMammoth = () => import('mammoth').then((module) => module.default ?? module);

const SUPPORTED_EXTENSIONS = new Set(['.pdf', '.md', '.docx']);
const EXCLUDED_DIR_NAMES = new Set(['node_modules', '.git', '.venv', 'dist', '__pycache__', '.next']);
const MAX_DEPTH = 4; // how many folders deep the walk will recurse under each source dir
const MAX_FILES = 400; // hard cap so a misconfigured source dir can't turn a page load into a huge scan
const SUMMARY_MAX_LENGTH = 280;
const MAX_BODY_BLOCKS = 500; // caps how much of a very long document the article reader renders
const WORDS_PER_MINUTE = 200; // for the reading-time estimate shown on the article page

// { generatedAt, entries, fileIndex: Map<id, absolutePath>, contentIndex: Map<id, Block[]> } | null.
// Rebuilt wholesale on every refresh — there's no incremental update, since a full rescan of a few
// hundred small documents is cheap enough not to need one. contentIndex holds the full parsed body
// (not just the card summary) so the article reader (GET /timeline/:id) doesn't have to re-parse
// the file a second time on top of the scan that already did it.
let cache = null;

// The single entry point the controller calls. Returns the cached scan if it's still fresh,
// otherwise walks every source dir again and rebuilds it.
export async function getTimeline({ forceRefresh = false } = {}) {
  const isFresh = cache && Date.now() - cache.generatedAt < env.TIMELINE_CACHE_TTL_MS;
  if (!forceRefresh && isFresh) return cache;

  const filePaths = await discoverFiles();
  const selectedFiles = selectOnePerDocument(filePaths);
  const entries = [];
  const fileIndex = new Map();
  const contentIndex = new Map();

  for (const { filePath, dateSourcePath } of selectedFiles) {
    try {
      const { entry, blocks } = await buildEntry(filePath, dateSourcePath);
      entries.push(entry);
      fileIndex.set(entry.id, filePath);
      contentIndex.set(entry.id, blocks);
    } catch {
      // One unreadable/corrupt document must never take the whole timeline down — it's just
      // silently dropped from the feed rather than surfaced as an error to every visitor.
    }
  }

  entries.sort((a, b) => a.date.localeCompare(b.date)); // oldest first; the frontend reverses for display when asked
  entries.forEach((entry, index) => {
    entry.order = index;
  });

  cache = { generatedAt: Date.now(), entries, fileIndex, contentIndex };
  return cache;
}

// Resolves a timeline entry id (see hashPath below) back to the absolute file path behind it, for
// the "view/download original" endpoint. Only ever returns a path that this module itself
// discovered during a scan — the id is never a client-supplied path, so this can't be used to walk
// the filesystem outside the configured source directories.
export async function resolveTimelineFile(id) {
  const { fileIndex } = await getTimeline();
  return fileIndex.get(id) ?? null;
}

// Full detail for the article reader page (GET /timeline/:id) — the card-list entry plus its full
// body as structured blocks (headings/paragraphs/list items) and a Medium-style reading-time
// estimate. Returns null for an unknown id rather than throwing, so the controller can turn that
// into a plain 404.
export async function getTimelineEntry(id) {
  const { entries, contentIndex } = await getTimeline();
  const entry = entries.find((candidate) => candidate.id === id);
  const blocks = contentIndex.get(id);
  if (!entry || !blocks) return null;

  const wordCount = blocks.reduce((total, block) => total + blockWordCount(block), 0);
  const readingTimeMinutes = Math.max(1, Math.round(wordCount / WORDS_PER_MINUTE));

  return { entry, blocks, readingTimeMinutes };
}

// Every block type carries its readable text somewhere different (prose blocks: .text, code:
// .code, tables: headers/rows) — this just finds it for the reading-time word count above.
function blockWordCount(block) {
  const text = block.text ?? block.code ?? (block.headers ? [...block.headers, ...block.rows.flat()].join(' ') : '');
  return text.split(/\s+/).filter(Boolean).length;
}

// Same-folder, same-basename files (e.g. "Plan.md" and "Plan.pdf") are the same underlying
// document authored in two formats, not two separate posts — collapses each such group down to
// one winner (markdown > docx > raw pdf text, since that's the render-quality order) and, when the
// winner isn't the pdf, remembers that pdf's path so buildEntry() can borrow ITS filesystem date.
// A freshly-generated .md sibling would otherwise carry today's creation date and wreck the
// timeline's actual chronology — the pdf's date is the real "when this was written."
const EXT_RENDER_PRIORITY = { '.md': 0, '.docx': 1, '.pdf': 2 };

function selectOnePerDocument(filePaths) {
  const groups = new Map();
  for (const filePath of filePaths) {
    const dir = path.dirname(filePath);
    const base = path.basename(filePath, path.extname(filePath));
    const key = `${dir.toLowerCase()}::${base.toLowerCase()}`;
    const list = groups.get(key) ?? [];
    list.push(filePath);
    groups.set(key, list);
  }

  const selected = [];
  for (const paths of groups.values()) {
    const winner = [...paths].sort(
      (a, b) => (EXT_RENDER_PRIORITY[path.extname(a).toLowerCase()] ?? 9) - (EXT_RENDER_PRIORITY[path.extname(b).toLowerCase()] ?? 9),
    )[0];
    const pdfSibling = paths.find((candidate) => candidate !== winner && path.extname(candidate).toLowerCase() === '.pdf');
    selected.push({ filePath: winner, dateSourcePath: pdfSibling ?? winner });
  }
  return selected;
}

async function discoverFiles() {
  const found = [];
  for (const dir of env.TIMELINE_SOURCE_DIRS) {
    if (found.length >= MAX_FILES) break;
    await walk(dir, 0, found);
  }
  return found.slice(0, MAX_FILES);
}

async function walk(dir, depth, found) {
  if (depth > MAX_DEPTH || found.length >= MAX_FILES) return;

  let dirEntries;
  try {
    dirEntries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return; // folder doesn't exist or isn't readable on this machine — skip it, not an error
  }

  for (const dirEntry of dirEntries) {
    if (found.length >= MAX_FILES) return;
    const fullPath = path.join(dir, dirEntry.name);

    if (dirEntry.isDirectory()) {
      if (!EXCLUDED_DIR_NAMES.has(dirEntry.name) && !dirEntry.name.startsWith('.')) {
        await walk(fullPath, depth + 1, found);
      }
    } else if (dirEntry.isFile() && SUPPORTED_EXTENSIONS.has(path.extname(dirEntry.name).toLowerCase())) {
      found.push(fullPath);
    }
  }
}

async function buildEntry(filePath, dateSourcePath = filePath) {
  const stat = await fs.stat(filePath);
  const dateStat = dateSourcePath === filePath ? stat : await fs.stat(dateSourcePath);
  const ext = path.extname(filePath).toLowerCase();
  // Prefer creation time (what the requirement actually asks for); some filesystems report a
  // zero/epoch birthtime when they don't track it, so fall back to last-modified in that case.
  // dateStat is normally just this file's own stat, but for a markdown file selected over a same-
  // name pdf sibling (see selectOnePerDocument), it's the PDF's stat — the .md was likely just
  // generated and would otherwise misreport today as this document's date.
  const date = (dateStat.birthtimeMs > 0 ? dateStat.birthtime : dateStat.mtime).toISOString();
  const { blocks, pageCount } = await extractContent(filePath, ext);
  const summary = summaryFromBlocks(blocks);

  const entry = {
    id: hashPath(filePath),
    title: titleFromFileName(filePath),
    date,
    summary,
    pageCount,
    sizeBytes: stat.size,
    ext: ext.slice(1),
    tags: [path.basename(path.dirname(filePath))], // the containing folder name doubles as a simple category tag
    sourceFileName: path.basename(filePath),
    order: 0, // overwritten by getTimeline() once the full list is sorted
  };

  return { entry, blocks };
}

// A short, stable hash of the file's own resolved path. Same file -> same id across scans (unless
// it's renamed/moved), which is what lets resolveTimelineFile() do a safe id -> path lookup.
function hashPath(filePath) {
  return createHash('sha1').update(path.resolve(filePath)).digest('hex').slice(0, 16);
}

// "infraflow_multi-agent-plan" -> "Infraflow Multi-Agent-plan"-ish: strips separators, then
// title-cases only words that were fully lowercase to begin with, so existing acronyms/mixed-case
// spellings already in the filename (AWS, RAG, HLD) come through unchanged rather than being
// mangled.
function titleFromFileName(filePath) {
  const base = path.basename(filePath, path.extname(filePath));
  const words = base
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ');

  return words.map((word) => (/^[a-z]+$/.test(word) ? word[0].toUpperCase() + word.slice(1) : word)).join(' ');
}

// Parses a document into structured blocks (headings/paragraphs/list items) for the article
// reader page, and hands back a page count where the format has one. A parse failure (corrupt
// file, scanned/image-only PDF with no text layer) only costs this one entry its body — the
// fallback single block still lets it show up in the feed with a "no preview" card and a working
// download link, rather than disappearing or breaking the whole scan.
async function extractContent(filePath, ext) {
  try {
    if (ext === '.md') {
      const text = await fs.readFile(filePath, 'utf-8');
      return { blocks: capBlocks(parseMarkdownBlocks(text)) };
    }
    if (ext === '.pdf') {
      const buffer = await fs.readFile(filePath);
      const { PDFParse } = await loadPdfParse();
      const parser = new PDFParse({ data: buffer });
      try {
        const parsed = await parser.getText();
        return { blocks: capBlocks(parseParagraphBlocks(parsed.text)), pageCount: parsed.total };
      } finally {
        await parser.destroy();
      }
    }
    if (ext === '.docx') {
      const mammoth = await loadMammoth();
      const { value } = await mammoth.extractRawText({ path: filePath });
      return { blocks: capBlocks(parseParagraphBlocks(value)) };
    }
  } catch {
    // fall through to the default below
  }
  return { blocks: [{ type: 'paragraph', text: 'No preview available for this document.' }] };
}

function capBlocks(blocks) {
  if (blocks.length <= MAX_BODY_BLOCKS) return blocks;
  return [...blocks.slice(0, MAX_BODY_BLOCKS), { type: 'paragraph', text: '(Full document truncated here — open the original to read the rest.)' }];
}

// Turns markdown source into typed blocks for the article reader's rich renderers — headings,
// fenced code, tables, blockquotes/GitHub-style callouts (`> [!NOTE]` etc.), images, and ordered/
// unordered/task lists, on top of the plain paragraph/heading/list-item support this already had.
// Inline markdown (code spans, bold, italic, links) is deliberately NOT stripped or resolved here
// — block text carries the raw markdown through, and the frontend's inline renderer
// (src/landing/blocks/inlineMarkdown.ts) is what turns `` `x` ``/`**x**`/`[x](y)` into styled
// spans, so this parser only ever needs to reason about block-level structure.
function parseMarkdownBlocks(text) {
  const lines = text.split(/\r?\n/);
  const blocks = [];
  let paragraphBuffer = [];
  let i = 0;

  const flushParagraph = () => {
    const joined = paragraphBuffer.join(' ').replace(/\s+/g, ' ').trim();
    if (joined) blocks.push({ type: 'paragraph', text: joined });
    paragraphBuffer = [];
  };

  while (i < lines.length) {
    const line = lines[i];

    const fenceMatch = line.match(/^\s*```\s*([\w+-]*)\s*$/);
    if (fenceMatch) {
      flushParagraph();
      const language = fenceMatch[1].toLowerCase();
      const codeLines = [];
      i += 1;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) {
        codeLines.push(lines[i]);
        i += 1;
      }
      i += 1; // skip the closing fence (or run off the end of an unterminated block, harmlessly)
      blocks.push({ type: 'code', language, code: codeLines.join('\n') });
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.*)/);
    if (headingMatch) {
      flushParagraph();
      blocks.push({ type: 'heading', level: headingMatch[1].length, text: headingMatch[2].trim() });
      i += 1;
      continue;
    }

    // A table needs its header row immediately followed by a `|---|:---:|---:|`-style separator
    // row to count — otherwise a stray line with a pipe in it (e.g. "cost: $10 | $20") would be
    // misread as a one-column table.
    if (isTableRow(line) && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      flushParagraph();
      const headers = splitTableRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && isTableRow(lines[i])) {
        rows.push(splitTableRow(lines[i]));
        i += 1;
      }
      blocks.push({ type: 'table', headers, rows });
      continue;
    }

    const quoteMatch = line.match(/^\s*>\s?(.*)/);
    if (quoteMatch) {
      flushParagraph();
      const quoteLines = [quoteMatch[1]];
      i += 1;
      while (i < lines.length) {
        const nextQuote = lines[i].match(/^\s*>\s?(.*)/);
        if (!nextQuote) break;
        quoteLines.push(nextQuote[1]);
        i += 1;
      }
      const joined = quoteLines.join(' ').replace(/\s+/g, ' ').trim();
      // GitHub-style admonition: a blockquote whose first line is exactly `[!NOTE]`/`[!TIP]`/etc.
      const calloutMatch = joined.match(/^\[!(NOTE|TIP|WARNING|IMPORTANT|CAUTION)\]\s*(.*)/i);
      if (calloutMatch) {
        blocks.push({ type: 'blockquote', calloutType: calloutMatch[1].toLowerCase(), text: calloutMatch[2].trim() });
      } else {
        blocks.push({ type: 'blockquote', text: joined });
      }
      continue;
    }

    const imageMatch = line.match(/^\s*!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)\s*$/);
    if (imageMatch) {
      flushParagraph();
      blocks.push({ type: 'image', src: imageMatch[2], alt: imageMatch[1] || '', caption: imageMatch[3] || imageMatch[1] || '' });
      i += 1;
      continue;
    }

    const taskMatch = line.match(/^\s*[-*+]\s+\[([ xX])\]\s+(.*)/);
    if (taskMatch) {
      flushParagraph();
      blocks.push({ type: 'list-item', text: taskMatch[2].trim(), checked: taskMatch[1].toLowerCase() === 'x' });
      i += 1;
      continue;
    }

    const orderedMatch = line.match(/^\s*\d+[.)]\s+(.*)/);
    if (orderedMatch) {
      flushParagraph();
      blocks.push({ type: 'list-item', text: orderedMatch[1].trim(), ordered: true });
      i += 1;
      continue;
    }

    const listMatch = line.match(/^\s*[-*+]\s+(.*)/);
    if (listMatch) {
      flushParagraph();
      blocks.push({ type: 'list-item', text: listMatch[1].trim() });
      i += 1;
      continue;
    }

    if (line.trim() === '') {
      flushParagraph();
      i += 1;
      continue;
    }

    paragraphBuffer.push(line.trim());
    i += 1;
  }
  flushParagraph();

  return blocks;
}

function isTableRow(line) {
  return line.includes('|') && line.trim() !== '';
}

function isTableSeparator(line) {
  return /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);
}

function splitTableRow(line) {
  let trimmed = line.trim();
  if (trimmed.startsWith('|')) trimmed = trimmed.slice(1);
  if (trimmed.endsWith('|')) trimmed = trimmed.slice(0, -1);
  return trimmed.split('|').map((cell) => cell.trim());
}

// Plain-text extraction (PDF/docx) has no heading info, just paragraphs. Blank-line-delimited
// chunks become blocks; any chunk long enough to plausibly span multiple pages (pdf-parse joins
// pages with single newlines) is split further so the reader isn't one huge wall of text.
function parseParagraphBlocks(text) {
  const chunks = text.split(/\r?\n\s*\r?\n/).flatMap((chunk) => (chunk.length > 1200 ? chunk.split(/\r?\n/) : [chunk]));

  const blocks = chunks
    .map((chunk) => chunk.replace(/\s+/g, ' ').trim())
    .filter((chunk) => chunk.length > 20)
    .map((chunk) => ({ type: 'paragraph', text: chunk }));

  return blocks.length ? blocks : [{ type: 'paragraph', text: 'No preview available for this document.' }];
}

function summaryFromBlocks(blocks) {
  const firstProseBlock = blocks.find((block) => block.type === 'paragraph' || block.type === 'blockquote');
  const chosen = firstProseBlock?.text ?? blocks.find((block) => typeof block.text === 'string')?.text ?? 'No preview available for this document.';
  return chosen.length > SUMMARY_MAX_LENGTH ? `${chosen.slice(0, SUMMARY_MAX_LENGTH).trim()}…` : chosen;
}
