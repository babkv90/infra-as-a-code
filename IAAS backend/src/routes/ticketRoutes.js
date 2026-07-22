import { Router } from 'express';
import { roles } from '../constants/roles.js';
import {
  addTicketComment,
  addTicketCommentSchema,
  createTicket,
  createTicketSchema,
  downloadTicketAttachment,
  getTicket,
  listTickets,
  updateTicketStatus,
  updateTicketStatusSchema,
} from '../controllers/ticketController.js';
import { requireAuth } from '../middleware/auth.js';
import { authorize } from '../middleware/authorize.js';
import { ticketAttachmentUpload } from '../middleware/ticketUpload.js';
import { validateRequest } from '../middleware/validateRequest.js';

export const ticketRouter = Router();

ticketRouter.use(requireAuth);
ticketRouter.get('/', listTickets);
ticketRouter.post('/', ticketAttachmentUpload('attachments'), validateRequest(createTicketSchema), createTicket);
ticketRouter.get('/:id', getTicket);
ticketRouter.post('/:id/comments', ticketAttachmentUpload('attachments'), validateRequest(addTicketCommentSchema), addTicketComment);
ticketRouter.patch('/:id/status', authorize(roles.SUPER_ADMIN), validateRequest(updateTicketStatusSchema), updateTicketStatus);
ticketRouter.get('/:id/attachments/:attachmentId', downloadTicketAttachment);
