/**
 * MemberRoster — displays board members in a table on BoardDetailPage.
 *
 * Phase E, wave 2, Task 3. Was three separate TanStack Query hooks reading
 * `board_member` (with an embedded `person`), `user_account` and
 * `invitation` directly through Supabase, merged in JS. Now one read,
 * `trpc.boardMember.roster`, which does the identical join server-side — see
 * that procedure's own doc comment in `packages/api/src/trpc/routers/
 * board-member.ts` for exactly what it selects and why the invitation join
 * picks the most recent one per person.
 *
 * Send/resend invite still POST to the existing REST endpoints
 * (`/api/invitations/:id/send`/`/resend`) — those are not part of this
 * migration's scope — but their cache invalidation moves from the now-dead
 * `queryKeys.invitations.byTown` (nothing else in the app reads that key —
 * `grep -rn "queryKeys\.invitations" packages/web/src` names only this file)
 * onto `trpc.boardMember.pathFilter()`, the key this component's own read
 * lives under now. Per conventions item 7: a writer follows its read.
 */

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { trpc } from "@/lib/trpc";
import { apiJson } from "@/lib/api-client";
import { Plus, Star, Archive, ArrowRightLeft, Pencil, Mail, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AddMemberDialog } from "@/components/members/AddMemberDialog";
import { MemberArchiveDialog } from "@/components/members/MemberArchiveDialog";
import { MemberTransitionDialog } from "@/components/members/MemberTransitionDialog";
import { EditGovTitleDialog } from "@/components/members/EditGovTitleDialog";

// ─── Types ────────────────────────────────────────────────────────────

interface MemberRow {
  id: string;
  person_id: string;
  board_id: string;
  seat_title: string | null;
  term_start: string | null;
  term_end: string | null;
  status: string;
  is_default_rec_sec: boolean;
  // From persons
  name: string;
  email: string;
  // From user_accounts
  role: string | null;
  gov_title: string | null;
  user_account_id: string | null;
  user_account_archived: string | null;
  // Invitation
  invitation_id: string | null;
  invitation_status: string | null;
  invitation_token: string | null;
  invitation_sent_at: string | null;
}

interface MemberRosterProps {
  boardId: string;
  boardName: string;
  electionMethod: string;
  townId: string;
  isArchived: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// ─── Component ────────────────────────────────────────────────────────

export function MemberRoster({
  boardId,
  boardName,
  electionMethod,
  townId,
  isArchived,
}: MemberRosterProps) {
  const queryClient = useQueryClient();
  const [showArchived, setShowArchived] = useState(false);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [archiveMember, setArchiveMember] = useState<MemberRow | null>(null);
  const [transitionMember, setTransitionMember] = useState<MemberRow | null>(null);
  const [editGovTitle, setEditGovTitle] = useState<MemberRow | null>(null);

  // ─── Reactive query ─────────────────────────────────────────────────
  const { data: rosterRows = [] } = useQuery({
    ...trpc.boardMember.roster.queryOptions({ boardId }),
    enabled: !!boardId,
  });

  // ─── Effective invitation status ───────────────────────────────────
  // Still computed client-side, against `new Date()` at render time — the
  // server's `roster` procedure hands back the raw invitation row (status,
  // expires_at), same as the Supabase read this replaces did.
  const members: MemberRow[] = rosterRows.map((bm) => {
    let effectiveStatus: string | null = null;
    if (bm.invitation_id) {
      const status = bm.invitation_status ?? "pending";
      const expiresAt = bm.invitation_expires_at ? new Date(bm.invitation_expires_at) : null;
      if (status === "accepted") {
        effectiveStatus = "accepted";
      } else if (expiresAt && expiresAt < new Date()) {
        effectiveStatus = "expired";
      } else {
        effectiveStatus = status;
      }
    }

    return {
      id: bm.id,
      person_id: bm.person_id,
      board_id: bm.board_id,
      seat_title: bm.seat_title,
      term_start: bm.term_start,
      term_end: bm.term_end,
      status: bm.status,
      is_default_rec_sec: bm.is_default_rec_sec,
      name: bm.name,
      email: bm.email ?? "",
      role: bm.role,
      gov_title: bm.gov_title,
      user_account_id: bm.user_account_id,
      user_account_archived: bm.user_account_archived_at,
      invitation_id: bm.invitation_id,
      invitation_status: effectiveStatus,
      invitation_token: bm.invitation_token,
      invitation_sent_at: bm.invitation_sent_at,
    };
  });

  // ─── Filter ─────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    if (showArchived) return members;
    return members.filter((m) => m.status === "active");
  }, [members, showArchived]);

  const archivedCount = useMemo(
    () => members.filter((m) => m.status === "archived").length,
    [members],
  );
  const activeCount = members.length - archivedCount;

  // ─── Send / resend invite ──────────────────────────────────────────
  const sendInviteMutation = useMutation({
    mutationFn: async (invitationId: string) => {
      // The session travels as a cookie, attached by `apiJson`. There is no
      // token for this component to fetch, forward, or get wrong.
      await apiJson(`/api/invitations/${invitationId}/send`, { method: "POST" });
    },
    onSuccess: () => {
      // This roster's own read moved onto `trpc.boardMember.roster` above —
      // `queryKeys.invitations.byTown` has no reader left anywhere in the
      // app (see this file's header), so invalidating it would be dead.
      void queryClient.invalidateQueries(trpc.boardMember.pathFilter());
      toast.success("Invitation sent");
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to send invitation");
    },
  });

  const resendInviteMutation = useMutation({
    mutationFn: async (invitationId: string) => {
      // The session travels as a cookie, attached by `apiJson`. There is no
      // token for this component to fetch, forward, or get wrong.
      await apiJson(`/api/invitations/${invitationId}/resend`, { method: "POST" });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries(trpc.boardMember.pathFilter());
      toast.success("Invitation resent");
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to resend invitation");
    },
  });

  const isMutating = sendInviteMutation.isPending || resendInviteMutation.isPending;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg">Member Roster</CardTitle>
            <CardDescription>
              {activeCount} active member{activeCount !== 1 ? "s" : ""}
            </CardDescription>
          </div>
          {!isArchived && (
            <Button size="sm" onClick={() => setAddDialogOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Add Member
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {/* Archived toggle */}
        {archivedCount > 0 && (
          <div className="mb-4 flex items-center gap-2">
            <Switch
              id="show-archived-members"
              checked={showArchived}
              onCheckedChange={setShowArchived}
            />
            <Label htmlFor="show-archived-members" className="text-sm text-muted-foreground">
              Show archived ({archivedCount})
            </Label>
          </div>
        )}

        {/* Empty state */}
        {filtered.length === 0 ? (
          <div className="rounded-lg border bg-muted/30 p-8 text-center">
            <p className="text-sm text-muted-foreground">
              No members added yet. Add your {boardName} members to get started.
            </p>
            {!isArchived && (
              <Button className="mt-4" size="sm" onClick={() => setAddDialogOpen(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Add Member
              </Button>
            )}
          </div>
        ) : (
          <div className="rounded-lg border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Name</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                    {electionMethod === "role_titled" ? "Seat Title" : "Position"}
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Term</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Role</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((member) => (
                  <tr
                    key={member.id}
                    className="border-b last:border-b-0 hover:bg-muted/30 transition-colors"
                  >
                    {/* Name */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {member.is_default_rec_sec && (
                          <Star className="h-4 w-4 fill-amber-400 text-amber-400 shrink-0" />
                        )}
                        <div>
                          <span className="font-medium">
                            {member.name}
                            {member.gov_title && (
                              <span className="ml-1 font-normal text-muted-foreground">
                                ({member.gov_title})
                              </span>
                            )}
                          </span>
                          <div className="text-xs text-muted-foreground">{member.email}</div>
                        </div>
                      </div>
                    </td>

                    {/* Seat / Position */}
                    <td className="px-4 py-3 text-muted-foreground">
                      {member.seat_title || "At-large"}
                    </td>

                    {/* Term */}
                    <td className="px-4 py-3 text-muted-foreground">
                      {member.term_start
                        ? `${formatDate(member.term_start)}${member.term_end ? ` — ${formatDate(member.term_end)}` : " — present"}`
                        : "No term set"}
                    </td>

                    {/* Role */}
                    <td className="px-4 py-3">
                      {member.role === "staff" ? (
                        <Badge
                          variant="outline"
                          className="border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300"
                        >
                          Staff
                        </Badge>
                      ) : (
                        <Badge
                          variant="outline"
                          className="border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-950 dark:text-green-300"
                        >
                          Board Member
                        </Badge>
                      )}
                    </td>

                    {/* Status */}
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-1">
                        <div>
                          {member.status === "active" ? (
                            <Badge className="bg-green-600 text-white hover:bg-green-600">
                              Active
                            </Badge>
                          ) : (
                            <Badge variant="secondary">Archived</Badge>
                          )}
                        </div>
                        {/* Invitation status badge */}
                        {member.invitation_status === "pending" && (
                          <Badge
                            variant="outline"
                            className="text-xs border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300"
                          >
                            {member.invitation_sent_at ? "Invite sent" : "Invite not sent"}
                          </Badge>
                        )}
                        {member.invitation_status === "expired" && (
                          <Badge
                            variant="outline"
                            className="text-xs border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300"
                          >
                            Invite expired
                          </Badge>
                        )}
                        {member.invitation_status === "accepted" && (
                          <Badge
                            variant="outline"
                            className="text-xs border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300"
                          >
                            Account active
                          </Badge>
                        )}
                      </div>
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {member.gov_title !== undefined && (
                          <Button
                            variant="ghost"
                            size="sm"
                            title="Edit government title"
                            onClick={() => setEditGovTitle(member)}
                            disabled={isArchived}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                        )}

                        {/* Send invite (not yet sent) */}
                        {!isArchived &&
                          member.status === "active" &&
                          member.invitation_id &&
                          member.invitation_status === "pending" &&
                          !member.invitation_sent_at && (
                            <Button
                              variant="ghost"
                              size="sm"
                              title="Send invitation email"
                              disabled={isMutating}
                              onClick={() => sendInviteMutation.mutate(member.invitation_id!)}
                            >
                              <Mail className="h-3.5 w-3.5" />
                            </Button>
                          )}

                        {/* Resend invite (sent or expired) */}
                        {!isArchived &&
                          member.status === "active" &&
                          member.invitation_id &&
                          (member.invitation_status === "expired" ||
                            (member.invitation_status === "pending" &&
                              !!member.invitation_sent_at)) && (
                            <Button
                              variant="ghost"
                              size="sm"
                              title="Resend invitation"
                              disabled={isMutating}
                              onClick={() => resendInviteMutation.mutate(member.invitation_id!)}
                            >
                              <RotateCcw className="h-3.5 w-3.5" />
                            </Button>
                          )}

                        {member.status === "active" && !isArchived && (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              title="Transition member"
                              onClick={() => setTransitionMember(member)}
                            >
                              <ArrowRightLeft className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              title="Archive member"
                              onClick={() => setArchiveMember(member)}
                            >
                              <Archive className="h-3.5 w-3.5" />
                            </Button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Default recording secretary note */}
        {filtered.some((m) => m.is_default_rec_sec) && (
          <div className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
            <span>Default recording secretary</span>
          </div>
        )}
      </CardContent>

      {/* Dialogs */}
      <AddMemberDialog
        boardId={boardId}
        boardName={boardName}
        electionMethod={electionMethod}
        townId={townId}
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
      />
      {archiveMember && (
        <MemberArchiveDialog
          member={archiveMember}
          boardId={boardId}
          open={!!archiveMember}
          onOpenChange={(open) => {
            if (!open) setArchiveMember(null);
          }}
        />
      )}
      {transitionMember && (
        <MemberTransitionDialog
          member={transitionMember}
          boardId={boardId}
          boardName={boardName}
          townId={townId}
          open={!!transitionMember}
          onOpenChange={(open) => {
            if (!open) setTransitionMember(null);
          }}
        />
      )}
      {editGovTitle && (
        <EditGovTitleDialog
          member={editGovTitle}
          open={!!editGovTitle}
          onOpenChange={(open) => {
            if (!open) setEditGovTitle(null);
          }}
        />
      )}
    </Card>
  );
}
