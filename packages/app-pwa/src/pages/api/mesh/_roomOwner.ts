import { normalizeRole } from '../../../lib/rbac';

export const ROOM_OWNER_ROLE = 'admin';

export function isRoomOwner(user: { role?: unknown } | null | undefined): boolean {
  if (!user) return false;
  const normalized = normalizeRole(user.role);
  return normalized === ROOM_OWNER_ROLE;
}
