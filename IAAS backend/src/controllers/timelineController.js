// HTTP layer for the landing page's Progress Timeline / changelog blog. All the actual scanning
// and parsing lives in services/timelineScanner.js — this file just adapts it to Express.
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { getTimeline, getTimelineEntry, resolveTimelineFile } from '../services/timelineScanner.js';

// GET /timeline — public, no auth: this is marketing content meant for anyone visiting the
// landing page. `?refresh=true` bypasses the in-memory cache for a manual "check now" action;
// otherwise it's implicitly fresh within TIMELINE_CACHE_TTL_MS (see env.js).
export const getTimelineEntries = asyncHandler(async (req, res) => {
  const forceRefresh = req.query.refresh === 'true';
  const { entries, generatedAt } = await getTimeline({ forceRefresh });
  res.json({ success: true, data: { entries, generatedAt } });
});

// GET /timeline/:id — the in-app article reader (TimelineArticlePage.tsx), as opposed to
// getTimelineFile below which streams the raw original file. Returns the card's own metadata plus
// its full body as structured blocks.
export const getTimelineEntryDetail = asyncHandler(async (req, res) => {
  const detail = await getTimelineEntry(req.params.id);
  if (!detail) {
    throw new ApiError(404, 'Document not found');
  }
  res.json({ success: true, data: detail });
});

// GET /timeline/:id/file — streams the original PDF/MD/DOCX behind one timeline card. `id` is a
// hash computed from the file's own resolved path during the scan (see timelineScanner.js's
// hashPath) — never a path the client supplies, so this endpoint can't be used to read arbitrary
// files off disk.
export const getTimelineFile = asyncHandler(async (req, res, next) => {
  const filePath = await resolveTimelineFile(req.params.id);
  if (!filePath) {
    throw new ApiError(404, 'Document not found');
  }

  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.sendFile(filePath, (error) => {
    if (error) next(error);
  });
});
