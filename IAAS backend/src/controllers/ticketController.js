import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { roles } from '../constants/roles.js';
import { Ticket } from '../models/Ticket.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { auditLog } from '../utils/audit.js';
import { createNotification } from '../services/notificationService.js';
import { TICKET_UPLOAD_ROOT } from '../middleware/ticketUpload.js';

const categories = ['bug', 'feature-request', 'billing', 'deployment-issue', 'account', 'other'];
const priorities = ['low', 'medium', 'high', 'urgent'];
const statuses = ['open', 'in_progress', 'resolved', 'closed'];

export const createTicketSchema = z.object({
  body: z.object({
    subject: z.string().min(3).max(160),
    description: z.string().min(3).max(5000),
    category: z.enum(categories).default('other'),
    priority: z.enum(priorities).default('medium'),
  }),
});

export const addTicketCommentSchema = z.object({
  body: z.object({
    message: z.string().min(1).max(4000),
  }),
});

export const updateTicketStatusSchema = z.object({
  body: z.object({
    status: z.enum(statuses),
  }),
});

export const listTickets = asyncHandler(async (req, res) => {
  const isSuperAdmin = req.user.role === roles.SUPER_ADMIN;
  const filter = isSuperAdmin ? {} : { createdBy: req.user._id };
  const statusFilter = String(req.query.status ?? '');
  if (statuses.includes(statusFilter)) filter.status = statusFilter;

  const tickets = await Ticket.find(filter).sort({ lastActivityAt: -1 }).populate('createdBy', 'name email role').lean();
  res.json({ success: true, data: tickets.map(serializeTicketSummary) });
});

export const createTicket = asyncHandler(async (req, res) => {
  const attachments = (req.files ?? []).map((file) => toAttachmentRecord(file, req.user._id));

  const ticket = await Ticket.create({
    workspace: req.user.workspace,
    createdBy: req.user._id,
    subject: req.validated.body.subject,
    description: req.validated.body.description,
    category: req.validated.body.category,
    priority: req.validated.body.priority,
    attachments,
    lastActivityAt: new Date(),
  });

  await auditLog(req, 'ticket.create', 'Ticket', ticket._id, { subject: ticket.subject, category: ticket.category, priority: ticket.priority });
  await ticket.populate('createdBy', 'name email role');
  res.status(201).json({ success: true, data: serializeTicketDetail(ticket) });
});

export const getTicket = asyncHandler(async (req, res) => {
  const ticket = await Ticket.findById(req.params.id).populate('createdBy', 'name email role').populate('comments.author', 'name email role');
  if (!ticket) throw new ApiError(404, 'Ticket not found');
  assertTicketAccess(req, ticket);
  res.json({ success: true, data: serializeTicketDetail(ticket) });
});

export const addTicketComment = asyncHandler(async (req, res) => {
  const ticket = await Ticket.findById(req.params.id);
  if (!ticket) throw new ApiError(404, 'Ticket not found');
  assertTicketAccess(req, ticket);

  const isSuperAdmin = req.user.role === roles.SUPER_ADMIN;
  const attachments = (req.files ?? []).map((file) => toAttachmentRecord(file, req.user._id));

  ticket.comments.push({
    author: req.user._id,
    authorRole: req.user.role,
    message: req.validated.body.message,
    attachments,
  });
  ticket.lastActivityAt = new Date();
  if (isSuperAdmin && ticket.status === 'open') ticket.status = 'in_progress';
  await ticket.save();

  if (isSuperAdmin && String(ticket.createdBy) !== String(req.user._id)) {
    await createNotification({
      workspace: ticket.workspace,
      user: ticket.createdBy,
      type: 'ticket',
      status: 'success',
      title: `Support replied to "${ticket.subject}"`,
      message: req.validated.body.message.slice(0, 240),
      resourceType: 'Ticket',
      resourceId: ticket._id,
      resourceName: ticket.subject,
    });
  }

  await auditLog(req, 'ticket.comment', 'Ticket', ticket._id, { isSuperAdmin });
  await ticket.populate('createdBy', 'name email role');
  await ticket.populate('comments.author', 'name email role');
  res.status(201).json({ success: true, data: serializeTicketDetail(ticket) });
});

export const updateTicketStatus = asyncHandler(async (req, res) => {
  const ticket = await Ticket.findById(req.params.id);
  if (!ticket) throw new ApiError(404, 'Ticket not found');

  const previousStatus = ticket.status;
  const nextStatus = req.validated.body.status;
  if (previousStatus === nextStatus) {
    await ticket.populate('createdBy', 'name email role');
    await ticket.populate('comments.author', 'name email role');
    res.json({ success: true, data: serializeTicketDetail(ticket) });
    return;
  }

  ticket.status = nextStatus;
  ticket.lastActivityAt = new Date();
  ticket.resolvedAt = ['resolved', 'closed'].includes(nextStatus) ? new Date() : undefined;
  await ticket.save();

  await createNotification({
    workspace: ticket.workspace,
    user: ticket.createdBy,
    type: 'ticket',
    status: 'success',
    title: `Ticket "${ticket.subject}" marked ${statusLabel(nextStatus)}`,
    message: `Status changed from ${statusLabel(previousStatus)} to ${statusLabel(nextStatus)}.`,
    resourceType: 'Ticket',
    resourceId: ticket._id,
    resourceName: ticket.subject,
  });

  await auditLog(req, 'ticket.status.update', 'Ticket', ticket._id, { from: previousStatus, to: nextStatus });
  await ticket.populate('createdBy', 'name email role');
  await ticket.populate('comments.author', 'name email role');
  res.json({ success: true, data: serializeTicketDetail(ticket) });
});

export const downloadTicketAttachment = asyncHandler(async (req, res) => {
  const ticket = await Ticket.findById(req.params.id);
  if (!ticket) throw new ApiError(404, 'Ticket not found');
  assertTicketAccess(req, ticket);

  const attachment = findAttachment(ticket, req.params.attachmentId);
  if (!attachment) throw new ApiError(404, 'Attachment not found');

  const filePath = path.join(TICKET_UPLOAD_ROOT, attachment.filename);
  try {
    await fs.access(filePath);
  } catch {
    throw new ApiError(404, 'Attachment file is no longer available.');
  }

  res.setHeader('Content-Type', attachment.mimeType || 'application/octet-stream');
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(attachment.originalName)}"`);
  res.sendFile(filePath);
});

function assertTicketAccess(req, ticket) {
  const isOwner = String(ticket.createdBy?._id ?? ticket.createdBy) === String(req.user._id);
  const isSuperAdmin = req.user.role === roles.SUPER_ADMIN;
  if (!isOwner && !isSuperAdmin) throw new ApiError(403, 'You do not have access to this ticket.');
}

function findAttachment(ticket, attachmentId) {
  const inTicket = ticket.attachments.id(attachmentId);
  if (inTicket) return inTicket;
  for (const comment of ticket.comments) {
    const found = comment.attachments.id(attachmentId);
    if (found) return found;
  }
  return null;
}

function toAttachmentRecord(file, userId) {
  return {
    filename: file.filename,
    originalName: file.originalname,
    mimeType: file.mimetype,
    size: file.size,
    uploadedBy: userId,
  };
}

function serializeAttachment(ticketId, attachment) {
  return {
    _id: String(attachment._id),
    originalName: attachment.originalName,
    mimeType: attachment.mimeType,
    size: attachment.size,
    uploadedAt: attachment.uploadedAt,
    url: `/api/v1/tickets/${ticketId}/attachments/${attachment._id}`,
  };
}

function serializeUser(user) {
  if (!user) return undefined;
  return {
    id: String(user._id ?? user),
    name: user.name,
    email: user.email,
    role: user.role,
  };
}

function ticketNumberFor(id) {
  return `TCK-${String(id).slice(-6).toUpperCase()}`;
}

function statusLabel(status) {
  return status.replace('_', ' ');
}

function serializeTicketSummary(ticket) {
  return {
    _id: String(ticket._id),
    ticketNumber: ticketNumberFor(ticket._id),
    subject: ticket.subject,
    category: ticket.category,
    priority: ticket.priority,
    status: ticket.status,
    createdBy: serializeUser(ticket.createdBy),
    commentCount: ticket.comments?.length ?? 0,
    attachmentCount: ticket.attachments?.length ?? 0,
    lastActivityAt: ticket.lastActivityAt,
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
  };
}

function serializeTicketDetail(ticket) {
  return {
    ...serializeTicketSummary(ticket),
    description: ticket.description,
    attachments: ticket.attachments.map((attachment) => serializeAttachment(ticket._id, attachment)),
    comments: ticket.comments.map((comment) => ({
      _id: String(comment._id),
      author: serializeUser(comment.author),
      authorRole: comment.authorRole,
      message: comment.message,
      attachments: comment.attachments.map((attachment) => serializeAttachment(ticket._id, attachment)),
      createdAt: comment.createdAt,
    })),
    resolvedAt: ticket.resolvedAt,
  };
}
