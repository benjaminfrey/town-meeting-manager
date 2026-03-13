/**
 * PermissionGate — conditionally renders children based on a permission check.
 *
 * Usage:
 *   <PermissionGate action="A2" boardId={boardId}>
 *     <Button onClick={handleEditAgenda}>Edit Agenda</Button>
 *   </PermissionGate>
 *
 *   // With a fallback:
 *   <PermissionGate action="R1" boardId={boardId} fallback={<p>No access</p>}>
 *     <EditMinutesPanel />
 *   </PermissionGate>
 *
 * While auth is loading, renders nothing (or the fallback if hideWhileLoading
 * is false). This prevents flicker of protected UI before permissions resolve.
 */

import type { ReactNode } from "react";
import { usePermission } from "@/hooks/usePermission";

interface PermissionGateProps {
  /** Action code to check, e.g. "A2", "M1", "R3" */
  action: string;
  /** Optional board UUID for board-scoped permission checks */
  boardId?: string;
  /** Content to render when the permission is granted */
  children: ReactNode;
  /** Content to render when permission is denied (default: nothing) */
  fallback?: ReactNode;
  /** Whether to hide content while auth is still loading (default: true) */
  hideWhileLoading?: boolean;
}

export function PermissionGate({
  action,
  boardId,
  children,
  fallback = null,
  hideWhileLoading = true,
}: PermissionGateProps) {
  const { allowed, loading } = usePermission(action, boardId);

  if (loading && hideWhileLoading) return null;
  if (!allowed) return <>{fallback}</>;
  return <>{children}</>;
}
