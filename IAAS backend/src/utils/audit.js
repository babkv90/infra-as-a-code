import { AuditLog } from '../models/AuditLog.js';

export async function auditLog(req, action, resourceType, resourceId, metadata = {}) {
  await AuditLog.create({
    workspace: req.user?.workspace,
    actor: req.user?._id,
    action,
    resourceType,
    resourceId: resourceId?.toString(),
    metadata,
    ip: req.ip,
  });
}
