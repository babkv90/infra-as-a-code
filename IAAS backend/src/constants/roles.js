export const roles = Object.freeze({
  OWNER: 'owner',
  ADMIN: 'admin',
  ARCHITECT: 'architect',
  DEVOPS: 'devops',
  VIEWER: 'viewer',
});

export const roleRank = Object.freeze({
  [roles.OWNER]: 5,
  [roles.ADMIN]: 4,
  [roles.ARCHITECT]: 3,
  [roles.DEVOPS]: 2,
  [roles.VIEWER]: 1,
});

export function hasRoleAtLeast(currentRole, requiredRole) {
  return (roleRank[currentRole] ?? 0) >= (roleRank[requiredRole] ?? 999);
}
