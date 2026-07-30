import { roles } from '../constants/roles.js';
import { Workspace } from '../models/Workspace.js';

export async function ensureWorkspaceOwnerRole(user) {
  if (!user?.workspace || user.role === roles.OWNER || user.role === roles.SUPER_ADMIN) {
    return user;
  }

  const workspace = await Workspace.findById(user.workspace).select('owner');

  if (workspace?.owner?.toString() !== user._id.toString()) {
    return user;
  }

  user.role = roles.OWNER;
  await user.save();
  return user;
}
