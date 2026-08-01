import { User } from '../models/User.js';
import { AuditLog } from '../models/AuditLog.js';
import { roles } from '../constants/roles.js';
import { ApiError } from './ApiError.js';

// Single source of truth for "unlimited or has a spendable balance" — superadmin never pays,
// everyone else needs demoCredits > 0. accessControl.js reuses this instead of duplicating the
// role/credits check across every gating function.
export function hasCredits(user) {
  return user?.role === roles.SUPER_ADMIN || Number(user?.demoCredits ?? 0) > 0;
}

// Cheap, in-memory pre-check on req.user (a full Mongoose doc via requireAuth) — call this before
// starting any of the 4 costed actions so they fail fast instead of running for free once balance
// hits 0. Not the race-safe gate; see chargeCredit for the atomic decrement.
export function assertHasCredits(user) {
  if (hasCredits(user)) return;
  throw new ApiError(402, 'You are out of credits. Ask a super admin to grant more before retrying this action.');
}

// The authoritative charge, called only at success points — from request-scoped controllers
// (pass req.user._id) and from background runners with no req (pass deployment.requestedBy).
// Atomic: the superadmin exemption and the zero-balance floor are both folded into the same
// findOneAndUpdate filter, so a losing racer, an already-superadmin user, and an already-zero
// user all resolve to the same harmless no-op — no separate read-then-act window.
export async function chargeCredit(userId, { workspace, action, resourceType, resourceId } = {}) {
  const updated = await User.findOneAndUpdate(
    { _id: userId, role: { $ne: roles.SUPER_ADMIN }, demoCredits: { $gt: 0 } },
    { $inc: { demoCredits: -1 } },
    { new: true },
  ).select('demoCredits');

  if (!updated) return { charged: false, remaining: null };

  try {
    await AuditLog.create({
      workspace,
      actor: userId,
      action: `credits.charge.${action}`,
      resourceType,
      resourceId: resourceId?.toString(),
      metadata: { remaining: updated.demoCredits },
    });
  } catch (auditError) {
    // A logging failure must never undo a charge that already landed in Mongo, or crash a runner
    // mid-way through finalizing an otherwise-successful Terraform run.
    console.error('credits: failed to write audit log for charge', auditError);
  }

  return { charged: true, remaining: updated.demoCredits };
}
