// Superadmin Knowledge Base: upload / list / delete the documents the AI agent retrieves from on
// every run. This controller only brokers to the Python agent service (utils/agentBridge.js's rag*
// helpers) — the vectors live in the agent's Postgres + pgvector, never here. The routes are
// SUPER_ADMIN-gated in superAdminRoutes.js; agentBridge mints a short-lived `rag:admin` machine
// token for each call.
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { auditLog } from '../utils/audit.js';
import { ragDeleteDocument, ragIngestDocument, ragListDocuments } from '../utils/agentBridge.js';

export const listKnowledgeDocuments = asyncHandler(async (req, res) => {
  const result = await ragListDocuments({ userId: req.user._id, workspaceId: req.user.workspace });
  if (!result.ok) throw new ApiError(result.status ?? 502, result.error);
  res.json({ success: true, data: result.documents ?? [] });
});

export const uploadKnowledgeDocument = asyncHandler(async (req, res) => {
  if (!req.file) throw new ApiError(400, 'No file uploaded — send it as multipart form field "file".');

  const result = await ragIngestDocument({
    userId: req.user._id,
    workspaceId: req.user.workspace,
    filename: req.file.originalname,
    contentType: req.file.mimetype,
    buffer: req.file.buffer,
  });
  if (!result.ok) throw new ApiError(result.status ?? 502, result.error);

  await auditLog(req, 'rag.document_upload', 'RagDocument', result.document?.id, {
    filename: req.file.originalname,
    bytes: req.file.size,
    chunks: result.document?.chunkCount,
  });
  res.status(201).json({ success: true, data: result.document });
});

export const deleteKnowledgeDocument = asyncHandler(async (req, res) => {
  const result = await ragDeleteDocument({
    userId: req.user._id,
    workspaceId: req.user.workspace,
    documentId: req.params.id,
  });
  if (!result.ok) throw new ApiError(result.status ?? 502, result.error);

  await auditLog(req, 'rag.document_delete', 'RagDocument', req.params.id);
  res.json({ success: true, data: { deleted: Boolean(result.deleted) } });
});
