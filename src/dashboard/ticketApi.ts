import { getStoredToken } from '../auth/authClient';
import { API_BASE_URL, apiFormRequest, apiRequest as sharedApiRequest } from '../utils/apiClient';

const ticketRequest = <T,>(path: string, init?: RequestInit) => sharedApiRequest<T>(path, init, 'Ticket request failed');
const ticketFormRequest = <T,>(path: string, form: FormData) => apiFormRequest<T>(path, form, 'Ticket request failed');

export type TicketCategory = 'bug' | 'feature-request' | 'billing' | 'deployment-issue' | 'account' | 'other';
export type TicketPriority = 'low' | 'medium' | 'high' | 'urgent';
export type TicketStatus = 'open' | 'in_progress' | 'resolved' | 'closed';

// Mirrors MAX_FILE_SIZE_BYTES in IAAS backend/src/middleware/ticketUpload.js — kept here so the
// UI can reject an oversized attachment before upload instead of only after a backend 400.
export const TICKET_MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export type TicketUser = {
  id: string;
  name: string;
  email: string;
  role: string;
};

export type TicketAttachment = {
  _id: string;
  originalName: string;
  mimeType: string;
  size: number;
  uploadedAt: string;
  url: string;
};

export type TicketComment = {
  _id: string;
  author?: TicketUser;
  authorRole: string;
  message: string;
  attachments: TicketAttachment[];
  createdAt: string;
};

export type TicketSummary = {
  _id: string;
  ticketNumber: string;
  subject: string;
  category: TicketCategory;
  priority: TicketPriority;
  status: TicketStatus;
  createdBy?: TicketUser;
  commentCount: number;
  attachmentCount: number;
  lastActivityAt: string;
  createdAt: string;
  updatedAt: string;
};

export type TicketDetail = TicketSummary & {
  description: string;
  attachments: TicketAttachment[];
  comments: TicketComment[];
  resolvedAt?: string;
};

export const TICKET_CATEGORIES: Array<{ value: TicketCategory; label: string }> = [
  { value: 'bug', label: 'Bug report' },
  { value: 'feature-request', label: 'Feature request' },
  { value: 'billing', label: 'Billing question' },
  { value: 'deployment-issue', label: 'Deployment issue' },
  { value: 'account', label: 'Account & access' },
  { value: 'other', label: 'Other' },
];

export const TICKET_PRIORITIES: Array<{ value: TicketPriority; label: string }> = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' },
];

export const TICKET_STATUSES: Array<{ value: TicketStatus; label: string }> = [
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'closed', label: 'Closed' },
];

export async function listTickets(status?: TicketStatus | 'all') {
  const suffix = status && status !== 'all' ? `?status=${status}` : '';
  return ticketRequest<TicketSummary[]>(`/tickets${suffix}`);
}

export async function getTicket(id: string) {
  return ticketRequest<TicketDetail>(`/tickets/${id}`);
}

export async function createTicket(payload: { subject: string; description: string; category: TicketCategory; priority: TicketPriority; files: File[] }) {
  const form = new FormData();
  form.set('subject', payload.subject);
  form.set('description', payload.description);
  form.set('category', payload.category);
  form.set('priority', payload.priority);
  payload.files.forEach((file) => form.append('attachments', file));

  return ticketFormRequest<TicketDetail>('/tickets', form);
}

export async function addTicketComment(id: string, payload: { message: string; files: File[] }) {
  const form = new FormData();
  form.set('message', payload.message);
  payload.files.forEach((file) => form.append('attachments', file));

  return ticketFormRequest<TicketDetail>(`/tickets/${id}/comments`, form);
}

export async function updateTicketStatus(id: string, status: TicketStatus) {
  return ticketRequest<TicketDetail>(`/tickets/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

// Attachment downloads require the bearer token, so plain <img src>/<a href> URLs won't
// authenticate. Fetch the bytes with the token attached and hand back a short-lived blob URL
// instead of putting the token in a URL (which would leak into logs, history, and Referer headers).
export async function fetchTicketAttachmentBlobUrl(attachment: TicketAttachment) {
  const token = getStoredToken();
  const response = await fetch(`${API_BASE_URL}${attachment.url}`, {
    credentials: 'include',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) throw new Error('Unable to load attachment');
  const blob = await response.blob();
  return URL.createObjectURL(blob);
}
