import { z } from 'zod';
import { BacklogItem } from '../models/BacklogItem.js';
import { ChangeLogEntry, CHANGE_LOG_CATEGORIES } from '../models/ChangeLogEntry.js';
import { Deployment } from '../models/Deployment.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { auditLog } from '../utils/audit.js';

const DIRECTIONS = ['positive', 'negative', 'neutral'];
const SEVERITIES = ['critical', 'high', 'medium', 'low'];
const BACKLOG_STATUSES = ['open', 'in-progress', 'resolved', 'wontfix'];

// Compute the three real, live-derivable performance metrics from the Deployment collection at the
// moment a change log entry is created. There is no persisted metrics store in this app, so these are
// calculated on demand rather than read from somewhere. diskUsageMb has no live source and is left to
// the optional manual value the admin supplies.
async function captureLiveMetrics() {
  const deployments = await Deployment.find({}, 'status startedAt finishedAt').lean();
  const total = deployments.length;
  const deployed = deployments.filter((d) => d.status === 'deployed');
  const terminal = deployments.filter((d) => ['deployed', 'failed', 'destroyed', 'cancelled'].includes(d.status));

  const timed = deployed.filter((d) => d.startedAt && d.finishedAt);
  const avgDeployTimeSec = timed.length
    ? Math.round(timed.reduce((sum, d) => sum + (new Date(d.finishedAt) - new Date(d.startedAt)) / 1000, 0) / timed.length)
    : undefined;

  return {
    deploymentSuccessRate: terminal.length ? Math.round((deployed.length / terminal.length) * 100) : undefined,
    avgDeployTimeSec,
    totalDeployments: total,
    capturedAt: new Date(),
  };
}

function serializeEntry(entry) {
  return {
    id: String(entry._id),
    title: entry.title,
    description: entry.description ?? '',
    category: entry.category,
    direction: entry.direction,
    impactRating: entry.impactRating,
    occurredAt: entry.occurredAt,
    author: entry.author
      ? { id: String(entry.author._id ?? entry.author), name: entry.author.name, email: entry.author.email }
      : undefined,
    relatedBacklogItems: (entry.relatedBacklogItems ?? []).map((item) =>
      item && item._id ? { id: String(item._id), title: item.title, status: item.status, severity: item.severity } : String(item),
    ),
    performanceSnapshot: entry.performanceSnapshot ?? undefined,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  };
}

function serializeBacklog(item) {
  return {
    id: String(item._id),
    title: item.title,
    description: item.description ?? '',
    severity: item.severity,
    status: item.status,
    identifiedDuring: item.identifiedDuring
      ? item.identifiedDuring._id
        ? { id: String(item.identifiedDuring._id), title: item.identifiedDuring.title }
        : String(item.identifiedDuring)
      : undefined,
    targetPhase: item.targetPhase ?? '',
    author: item.author
      ? { id: String(item.author._id ?? item.author), name: item.author.name, email: item.author.email }
      : undefined,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

// ---- Change log ----

export const createChangeLogSchema = z.object({
  body: z.object({
    title: z.string().min(1).max(160),
    description: z.string().max(5000).optional(),
    category: z.enum(CHANGE_LOG_CATEGORIES),
    direction: z.enum(DIRECTIONS),
    impactRating: z.number().int().min(1).max(5),
    occurredAt: z.coerce.date().optional(),
    relatedBacklogItems: z.array(z.string()).optional(),
    diskUsageMb: z.number().min(0).optional(),
  }),
});

export const updateChangeLogSchema = z.object({
  body: z.object({
    title: z.string().min(1).max(160).optional(),
    description: z.string().max(5000).optional(),
    category: z.enum(CHANGE_LOG_CATEGORIES).optional(),
    direction: z.enum(DIRECTIONS).optional(),
    impactRating: z.number().int().min(1).max(5).optional(),
    occurredAt: z.coerce.date().optional(),
    relatedBacklogItems: z.array(z.string()).optional(),
  }),
});

export const listChangeLog = asyncHandler(async (_req, res) => {
  const entries = await ChangeLogEntry.find({})
    .sort({ occurredAt: -1 })
    .populate('author', 'name email')
    .populate('relatedBacklogItems', 'title status severity')
    .lean();
  res.json({ success: true, data: { entries: entries.map(serializeEntry) } });
});

export const createChangeLog = asyncHandler(async (req, res) => {
  const { title, description, category, direction, impactRating, occurredAt, relatedBacklogItems, diskUsageMb } = req.validated.body;

  const performanceSnapshot = await captureLiveMetrics();
  if (typeof diskUsageMb === 'number') performanceSnapshot.diskUsageMb = diskUsageMb;

  const entry = await ChangeLogEntry.create({
    title,
    description: description ?? '',
    category,
    direction,
    impactRating,
    occurredAt: occurredAt ?? new Date(),
    author: req.user._id,
    relatedBacklogItems: relatedBacklogItems ?? [],
    performanceSnapshot,
  });

  await auditLog(req, 'superadmin.changelog.create', 'ChangeLogEntry', entry._id, { title, category, direction, impactRating });

  const populated = await ChangeLogEntry.findById(entry._id)
    .populate('author', 'name email')
    .populate('relatedBacklogItems', 'title status severity')
    .lean();
  res.status(201).json({ success: true, data: { entry: serializeEntry(populated) } });
});

export const updateChangeLog = asyncHandler(async (req, res) => {
  const entry = await ChangeLogEntry.findById(req.params.id);
  if (!entry) throw new ApiError(404, 'Change log entry not found');

  const updates = req.validated.body;
  for (const key of Object.keys(updates)) {
    entry[key] = updates[key];
  }
  await entry.save();

  await auditLog(req, 'superadmin.changelog.update', 'ChangeLogEntry', entry._id, updates);

  const populated = await ChangeLogEntry.findById(entry._id)
    .populate('author', 'name email')
    .populate('relatedBacklogItems', 'title status severity')
    .lean();
  res.json({ success: true, data: { entry: serializeEntry(populated) } });
});

// Time-ordered series for the performance graph: each change paired with its captured snapshot,
// direction, rating and category so the frontend can plot metrics over time with every change marked
// and color-coded.
export const getPerformanceSeries = asyncHandler(async (_req, res) => {
  const entries = await ChangeLogEntry.find({}, 'title category direction impactRating occurredAt performanceSnapshot')
    .sort({ occurredAt: 1 })
    .lean();

  const series = entries.map((entry) => ({
    id: String(entry._id),
    title: entry.title,
    category: entry.category,
    direction: entry.direction,
    impactRating: entry.impactRating,
    occurredAt: entry.occurredAt,
    metrics: entry.performanceSnapshot ?? {},
  }));

  res.json({ success: true, data: { series } });
});

// ---- Backlog ----

export const createBacklogSchema = z.object({
  body: z.object({
    title: z.string().min(1).max(160),
    description: z.string().max(5000).optional(),
    severity: z.enum(SEVERITIES),
    status: z.enum(BACKLOG_STATUSES).optional(),
    identifiedDuring: z.string().optional(),
    targetPhase: z.string().max(120).optional(),
  }),
});

export const updateBacklogSchema = z.object({
  body: z.object({
    title: z.string().min(1).max(160).optional(),
    description: z.string().max(5000).optional(),
    severity: z.enum(SEVERITIES).optional(),
    status: z.enum(BACKLOG_STATUSES).optional(),
    identifiedDuring: z.string().nullable().optional(),
    targetPhase: z.string().max(120).optional(),
  }),
});

export const listBacklog = asyncHandler(async (_req, res) => {
  const items = await BacklogItem.find({})
    .sort({ createdAt: -1 })
    .populate('author', 'name email')
    .populate('identifiedDuring', 'title')
    .lean();
  res.json({ success: true, data: { items: items.map(serializeBacklog) } });
});

export const createBacklog = asyncHandler(async (req, res) => {
  const { title, description, severity, status, identifiedDuring, targetPhase } = req.validated.body;

  const item = await BacklogItem.create({
    title,
    description: description ?? '',
    severity,
    status: status ?? 'open',
    identifiedDuring: identifiedDuring || undefined,
    targetPhase: targetPhase ?? '',
    author: req.user._id,
  });

  await auditLog(req, 'superadmin.backlog.create', 'BacklogItem', item._id, { title, severity, status: item.status });

  const populated = await BacklogItem.findById(item._id).populate('author', 'name email').populate('identifiedDuring', 'title').lean();
  res.status(201).json({ success: true, data: { item: serializeBacklog(populated) } });
});

export const updateBacklog = asyncHandler(async (req, res) => {
  const item = await BacklogItem.findById(req.params.id);
  if (!item) throw new ApiError(404, 'Backlog item not found');

  const updates = req.validated.body;
  for (const key of Object.keys(updates)) {
    if (key === 'identifiedDuring' && !updates[key]) {
      item.identifiedDuring = undefined;
      continue;
    }
    item[key] = updates[key];
  }
  await item.save();

  await auditLog(req, 'superadmin.backlog.update', 'BacklogItem', item._id, updates);

  const populated = await BacklogItem.findById(item._id).populate('author', 'name email').populate('identifiedDuring', 'title').lean();
  res.json({ success: true, data: { item: serializeBacklog(populated) } });
});
