import { LifeBuoy, Paperclip, Plus, RefreshCw, X } from 'lucide-react';
import type React from 'react';
import { useEffect, useState } from 'react';
import { getStoredUser } from '../../auth/authClient';
import { PageAlert } from '../../components/PageAlert';
import {
  TICKET_CATEGORIES,
  TICKET_MAX_ATTACHMENT_BYTES,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  addTicketComment,
  createTicket,
  fetchTicketAttachmentBlobUrl,
  getTicket,
  listTickets,
  updateTicketStatus,
  type TicketAttachment,
  type TicketCategory,
  type TicketDetail,
  type TicketPriority,
  type TicketStatus,
  type TicketSummary,
} from '../ticketApi';

const TICKET_FILTER_TABS: Array<{ value: TicketStatus | 'all'; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'closed', label: 'Closed' },
];

export function SupportPage() {
  const currentUser = getStoredUser();
  const isSuperAdmin = currentUser?.role === 'superadmin';

  const [tickets, setTickets] = useState<TicketSummary[]>([]);
  const [statusFilter, setStatusFilter] = useState<TicketStatus | 'all'>('all');
  const [isLoadingList, setIsLoadingList] = useState(false);
  const [selectedTicketId, setSelectedTicketId] = useState<string>();
  const [selectedTicket, setSelectedTicket] = useState<TicketDetail>();
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const [isNewTicketOpen, setIsNewTicketOpen] = useState(false);
  const [newSubject, setNewSubject] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newCategory, setNewCategory] = useState<TicketCategory>('other');
  const [newPriority, setNewPriority] = useState<TicketPriority>('medium');
  const [newFiles, setNewFiles] = useState<File[]>([]);
  const [isSubmittingTicket, setIsSubmittingTicket] = useState(false);

  const [replyMessage, setReplyMessage] = useState('');
  const [replyFiles, setReplyFiles] = useState<File[]>([]);
  const [isSubmittingReply, setIsSubmittingReply] = useState(false);
  const [isChangingStatus, setIsChangingStatus] = useState(false);

  const canSubmitNewTicket = Boolean(newSubject.trim() && newDescription.trim()) && !isSubmittingTicket;

  // The backend rejects any attachment over TICKET_MAX_ATTACHMENT_BYTES with a 400 — this catches
  // it at selection time instead, so a user finds out immediately (and which file) rather than
  // after a failed submit with no attachment-level detail.
  function selectTicketFiles(fileList: FileList | null, setFiles: (files: File[]) => void) {
    const files = Array.from(fileList ?? []);
    const oversized = files.filter((file) => file.size > TICKET_MAX_ATTACHMENT_BYTES);
    if (oversized.length) {
      const names = oversized.map((file) => file.name).join(', ');
      setError(`${names} ${oversized.length === 1 ? 'is' : 'are'} over the 10MB attachment limit and ${oversized.length === 1 ? "wasn't" : "weren't"} attached.`);
    }
    setFiles(files.filter((file) => file.size <= TICKET_MAX_ATTACHMENT_BYTES));
  }

  async function refreshTickets(status: TicketStatus | 'all' = statusFilter) {
    setIsLoadingList(true);
    try {
      const result = await listTickets(status);
      setTickets(result);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : 'Unable to load tickets.');
    } finally {
      setIsLoadingList(false);
    }
  }

  useEffect(() => {
    void refreshTickets(statusFilter);
  }, [statusFilter]);

  async function openTicket(id: string) {
    setSelectedTicketId(id);
    setIsLoadingDetail(true);
    setError('');
    try {
      const detail = await getTicket(id);
      setSelectedTicket(detail);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : 'Unable to load this ticket.');
    } finally {
      setIsLoadingDetail(false);
    }
  }

  async function submitNewTicket() {
    if (!newSubject.trim() || !newDescription.trim()) {
      setError('Subject and description are required.');
      return;
    }
    setIsSubmittingTicket(true);
    setError('');
    try {
      const ticket = await createTicket({
        subject: newSubject.trim(),
        description: newDescription.trim(),
        category: newCategory,
        priority: newPriority,
        files: newFiles,
      });
      setIsNewTicketOpen(false);
      setNewSubject('');
      setNewDescription('');
      setNewCategory('other');
      setNewPriority('medium');
      setNewFiles([]);
      setMessage(`Ticket ${ticket.ticketNumber} submitted. Our team will follow up here.`);
      await refreshTickets();
      await openTicket(ticket._id);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Unable to submit ticket.');
    } finally {
      setIsSubmittingTicket(false);
    }
  }

  async function submitReply(eventArg: React.FormEvent) {
    eventArg.preventDefault();
    if (!selectedTicketId || !replyMessage.trim()) return;
    setIsSubmittingReply(true);
    setError('');
    try {
      const detail = await addTicketComment(selectedTicketId, { message: replyMessage.trim(), files: replyFiles });
      setSelectedTicket(detail);
      setReplyMessage('');
      setReplyFiles([]);
      await refreshTickets();
    } catch (replyError) {
      setError(replyError instanceof Error ? replyError.message : 'Unable to send reply.');
    } finally {
      setIsSubmittingReply(false);
    }
  }

  async function changeStatus(nextStatus: TicketStatus) {
    if (!selectedTicketId || !selectedTicket || nextStatus === selectedTicket.status) return;
    setIsChangingStatus(true);
    setError('');
    try {
      const detail = await updateTicketStatus(selectedTicketId, nextStatus);
      setSelectedTicket(detail);
      await refreshTickets();
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : 'Unable to update ticket status.');
    } finally {
      setIsChangingStatus(false);
    }
  }

  async function openAttachment(attachment: TicketAttachment) {
    try {
      const url = await fetchTicketAttachmentBlobUrl(attachment);
      window.open(url, '_blank', 'noopener');
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (attachmentError) {
      setError(attachmentError instanceof Error ? attachmentError.message : 'Unable to open attachment.');
    }
  }

  return (
    <div className="dash-page dash-page--support">
      {message && <PageAlert message={message} onDismiss={() => setMessage('')} />}
      {error && <PageAlert message={error} tone="error" onDismiss={() => setError('')} />}
      <div className="dash-page-head-group">
        <header className="pipeline-console-header">
          <div>
            <span className="dash-eyebrow">Feedback & support</span>
          </div>
          <div className="pipeline-header-badges">
            <span className="pipeline-badge">{tickets.filter((ticket) => ticket.status === 'open').length} open</span>
            <button className="pipeline-icon-action" disabled={isLoadingList} onClick={() => void refreshTickets()} title="Refresh" type="button">
              <RefreshCw size={15} />
            </button>
            <button className="pipeline-primary-compact" onClick={() => setIsNewTicketOpen(true)} type="button">
              <Plus size={14} />
              New ticket
            </button>
          </div>
        </header>
      </div>

      <div className="ticket-console-grid">
        <aside className="ticket-list-panel">
          <div className="ticket-filter-tabs">
            {TICKET_FILTER_TABS.map((tab) => (
              <button className={statusFilter === tab.value ? 'active' : ''} key={tab.value} onClick={() => setStatusFilter(tab.value)} type="button">
                {tab.label}
              </button>
            ))}
          </div>
          {tickets.length ? (
            <ul className="ticket-list">
              {tickets.map((ticket) => (
                <li
                  className={`ticket-list-item ${selectedTicketId === ticket._id ? 'active' : ''}`}
                  key={ticket._id}
                  onClick={() => void openTicket(ticket._id)}
                >
                  <div className="ticket-list-item-top">
                    <span className={`ticket-status-pill ticket-status-pill--${ticket.status}`}>{ticketStatusLabel(ticket.status)}</span>
                    <span className="ticket-number">{ticket.ticketNumber}</span>
                  </div>
                  <strong>{ticket.subject}</strong>
                  <div className="ticket-list-item-meta">
                    {isSuperAdmin && ticket.createdBy && <span>{ticket.createdBy.name}</span>}
                    <span className={`ticket-priority ticket-priority--${ticket.priority}`}>{ticket.priority}</span>
                    <span>{formatTicketDate(ticket.lastActivityAt)}</span>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="pipeline-muted ticket-list-empty">{isLoadingList ? 'Loading tickets...' : 'No tickets yet. Create one to reach the support team.'}</p>
          )}
        </aside>

        <section className="ticket-detail-panel">
          {isLoadingDetail ? (
            <p className="pipeline-muted">Loading ticket...</p>
          ) : !selectedTicket ? (
            <div className="ticket-detail-empty">
              <LifeBuoyIcon />
              <p>Select a ticket from the list, or create a new one to reach the support team.</p>
            </div>
          ) : (
            <>
              <header className="ticket-detail-header">
                <div>
                  <span className="ticket-number">{selectedTicket.ticketNumber}</span>
                  <h3>{selectedTicket.subject}</h3>
                  <div className="ticket-detail-meta">
                    <span>{ticketCategoryLabel(selectedTicket.category)}</span>
                    <span className={`ticket-priority ticket-priority--${selectedTicket.priority}`}>{selectedTicket.priority}</span>
                    {selectedTicket.createdBy && <span>Opened by {selectedTicket.createdBy.name}</span>}
                    <span>{formatTicketDate(selectedTicket.createdAt)}</span>
                  </div>
                </div>
                {isSuperAdmin ? (
                  <select
                    className="ticket-status-select"
                    disabled={isChangingStatus}
                    onChange={(changeEvent) => void changeStatus(changeEvent.target.value as TicketStatus)}
                    value={selectedTicket.status}
                  >
                    {TICKET_STATUSES.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className={`ticket-status-pill ticket-status-pill--${selectedTicket.status}`}>{ticketStatusLabel(selectedTicket.status)}</span>
                )}
              </header>

              <div className="ticket-thread">
                <article className="ticket-message">
                  <div className="ticket-message-head">
                    <strong>{selectedTicket.createdBy?.name ?? 'You'}</strong>
                    <small>{formatTicketDate(selectedTicket.createdAt)}</small>
                  </div>
                  <p>{selectedTicket.description}</p>
                  <TicketAttachmentList attachments={selectedTicket.attachments} onOpen={openAttachment} />
                </article>
                {selectedTicket.comments.map((comment) => (
                  <article className={`ticket-message ${comment.authorRole === 'superadmin' ? 'ticket-message--staff' : ''}`} key={comment._id}>
                    <div className="ticket-message-head">
                      <strong>{comment.author?.name ?? 'Unknown'}</strong>
                      {comment.authorRole === 'superadmin' && <span className="ticket-staff-badge">Support</span>}
                      <small>{formatTicketDate(comment.createdAt)}</small>
                    </div>
                    <p>{comment.message}</p>
                    <TicketAttachmentList attachments={comment.attachments} onOpen={openAttachment} />
                  </article>
                ))}
              </div>

              <form className="ticket-reply-form" onSubmit={(formEvent) => void submitReply(formEvent)}>
                <textarea
                  onChange={(changeEvent) => setReplyMessage(changeEvent.target.value)}
                  placeholder={isSuperAdmin ? 'Reply to the user...' : 'Write a reply...'}
                  rows={3}
                  value={replyMessage}
                />
                <div className="ticket-reply-actions">
                  <label className="ticket-file-picker">
                    <Paperclip size={14} />
                    {replyFiles.length ? `${replyFiles.length} file(s) selected` : 'Attach files'}
                    <input hidden multiple onChange={(fileEvent) => selectTicketFiles(fileEvent.target.files, setReplyFiles)} type="file" />
                  </label>
                  <button className="pipeline-primary-compact" disabled={isSubmittingReply || !replyMessage.trim()} type="submit">
                    {isSubmittingReply ? 'Sending...' : 'Send reply'}
                  </button>
                </div>
              </form>
            </>
          )}
        </section>
      </div>

      {isNewTicketOpen && (
        <div className="ticket-modal-backdrop" onClick={() => !isSubmittingTicket && setIsNewTicketOpen(false)} role="presentation">
          <section aria-modal="true" className="ticket-modal" onClick={(clickEvent) => clickEvent.stopPropagation()} role="dialog">
            <header>
              <strong>New support ticket</strong>
              <button className="dash-icon-button" onClick={() => setIsNewTicketOpen(false)} title="Close" type="button">
                <X size={14} />
              </button>
            </header>
            <div className="ticket-form-grid">
              <label className="pipeline-field pipeline-field--wide">
                <span>Subject</span>
                <input onChange={(changeEvent) => setNewSubject(changeEvent.target.value)} placeholder="Short summary of your issue" required value={newSubject} />
              </label>
              <label className="pipeline-field">
                <span>Category</span>
                <select onChange={(changeEvent) => setNewCategory(changeEvent.target.value as TicketCategory)} value={newCategory}>
                  {TICKET_CATEGORIES.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="pipeline-field">
                <span>Priority</span>
                <select onChange={(changeEvent) => setNewPriority(changeEvent.target.value as TicketPriority)} value={newPriority}>
                  {TICKET_PRIORITIES.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="pipeline-field pipeline-field--wide">
                <span>Description</span>
                <textarea
                  onChange={(changeEvent) => setNewDescription(changeEvent.target.value)}
                  placeholder="Describe what's happening, steps to reproduce, and what you expected. Paste error messages or logs here."
                  required
                  rows={6}
                  value={newDescription}
                />
              </label>
              <label className="pipeline-field pipeline-field--wide">
                <span>Attachments (screenshots, logs)</span>
                <label className="ticket-file-picker ticket-file-picker--block">
                  <Paperclip size={14} />
                  {newFiles.length ? `${newFiles.length} file(s) selected` : 'Attach images, .log/.txt files, JSON, PDF, or ZIP (max 10MB each)'}
                  <input hidden multiple onChange={(fileEvent) => selectTicketFiles(fileEvent.target.files, setNewFiles)} type="file" />
                </label>
              </label>
            </div>
            <footer>
              <button className="pipeline-link-button" onClick={() => setIsNewTicketOpen(false)} type="button">
                Cancel
              </button>
              <button className="pipeline-primary-compact" disabled={!canSubmitNewTicket} onClick={() => void submitNewTicket()} type="button">
                {isSubmittingTicket ? 'Submitting...' : 'Submit ticket'}
              </button>
            </footer>
          </section>
        </div>
      )}
    </div>
  );
}

function TicketAttachmentList({ attachments, onOpen }: { attachments: TicketAttachment[]; onOpen: (attachment: TicketAttachment) => void }) {
  if (!attachments.length) return null;
  return (
    <div className="ticket-attachment-list">
      {attachments.map((attachment) => (
        <button className="ticket-attachment-chip" key={attachment._id} onClick={() => onOpen(attachment)} title={attachment.originalName} type="button">
          <Paperclip size={12} />
          <span>{attachment.originalName}</span>
          <small>{formatFileSize(attachment.size)}</small>
        </button>
      ))}
    </div>
  );
}

function LifeBuoyIcon() {
  return <LifeBuoy size={30} />;
}

function ticketStatusLabel(status: TicketStatus) {
  return TICKET_STATUSES.find((option) => option.value === status)?.label ?? status;
}

function ticketCategoryLabel(category: TicketCategory) {
  return TICKET_CATEGORIES.find((option) => option.value === category)?.label ?? category;
}

function formatTicketDate(value: string) {
  return new Date(value).toLocaleString();
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
