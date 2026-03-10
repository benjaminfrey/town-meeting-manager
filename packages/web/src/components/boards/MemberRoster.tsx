/**
 * MemberRoster — displays board members in a table on BoardDetailPage.
 *
 * Uses separate PowerSync queries (no JOINs) for board_members, persons,
 * and user_accounts, then merges in JS. Supports show/hide archived toggle,
 * add member, archive member, and member transition actions.
 */

import { useMemo, useState } from "react";
import { useQuery, usePowerSync } from "@powersync/react";
import {
  Plus,
  Star,
  Archive,
  ArrowRightLeft,
  Pencil,
  Copy,
  Info,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
  // From invitations
  invitation_status: string | null;
  invitation_token: string | null;
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
  const powerSync = usePowerSync();
  const [showArchived, setShowArchived] = useState(false);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [archiveMember, setArchiveMember] = useState<MemberRow | null>(null);
  const [transitionMember, setTransitionMember] = useState<MemberRow | null>(
    null,
  );
  const [editGovTitle, setEditGovTitle] = useState<MemberRow | null>(null);

  // ─── Reactive queries ───────────────────────────────────────────────
  const { data: bmRows } = useQuery(
    "SELECT * FROM board_members WHERE board_id = ?",
    [boardId],
  );
  const { data: personRows } = useQuery(
    "SELECT * FROM persons WHERE town_id = ?",
    [townId],
  );
  const { data: uaRows } = useQuery(
    "SELECT * FROM user_accounts WHERE town_id = ?",
    [townId],
  );
  const { data: invRows } = useQuery(
    "SELECT * FROM invitations WHERE town_id = ?",
    [townId],
  );

  // ─── Merge data ─────────────────────────────────────────────────────
  const members: MemberRow[] = useMemo(() => {
    const personMap = new Map<string, Record<string, unknown>>();
    for (const p of personRows ?? []) {
      const pr = p as Record<string, unknown>;
      personMap.set(String(pr.id), pr);
    }

    const uaMap = new Map<string, Record<string, unknown>>();
    for (const ua of uaRows ?? []) {
      const uar = ua as Record<string, unknown>;
      uaMap.set(String(uar.person_id), uar);
    }

    const invMap = new Map<string, Record<string, unknown>>();
    for (const inv of invRows ?? []) {
      const ir = inv as Record<string, unknown>;
      const personId = String(ir.person_id);
      // Keep the most recent invitation per person
      if (
        !invMap.has(personId) ||
        String(ir.created_at) >
          String(
            (invMap.get(personId) as Record<string, unknown>)?.created_at ?? "",
          )
      ) {
        invMap.set(personId, ir);
      }
    }

    return ((bmRows ?? []) as Record<string, unknown>[]).map((bm) => {
      const personId = String(bm.person_id);
      const person = personMap.get(personId);
      const ua = uaMap.get(personId);
      const inv = invMap.get(personId);

      return {
        id: String(bm.id),
        person_id: personId,
        board_id: String(bm.board_id),
        seat_title: (bm.seat_title as string) || null,
        term_start: (bm.term_start as string) || null,
        term_end: (bm.term_end as string) || null,
        status: String(bm.status ?? "active"),
        is_default_rec_sec: bm.is_default_rec_sec === 1,
        name: String(person?.name ?? "Unknown"),
        email: String(person?.email ?? ""),
        role: (ua?.role as string) || null,
        gov_title: (ua?.gov_title as string) || null,
        user_account_id: ua ? String(ua.id) : null,
        user_account_archived: (ua?.archived_at as string) || null,
        invitation_status: (inv?.status as string) || null,
        invitation_token: (inv?.token as string) || null,
      };
    });
  }, [bmRows, personRows, uaRows, invRows]);

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

  // ─── Copy invitation link ──────────────────────────────────────────
  const handleCopyInvite = (token: string) => {
    const url = `${window.location.origin}/invite/${token}`;
    void navigator.clipboard.writeText(url).then(() => {
      toast.success("Invitation link copied to clipboard");
    });
  };

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
            <Label
              htmlFor="show-archived-members"
              className="text-sm text-muted-foreground"
            >
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
              <Button
                className="mt-4"
                size="sm"
                onClick={() => setAddDialogOpen(true)}
              >
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
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                    Name
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                    {electionMethod === "role_titled"
                      ? "Seat Title"
                      : "Position"}
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                    Term
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                    Role
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                    Status
                  </th>
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
                          <div className="text-xs text-muted-foreground">
                            {member.email}
                          </div>
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
                      <div className="flex items-center gap-2">
                        {member.status === "active" ? (
                          <Badge className="bg-green-600 text-white hover:bg-green-600">
                            Active
                          </Badge>
                        ) : (
                          <Badge variant="secondary">Archived</Badge>
                        )}
                        {member.invitation_status === "pending" && (
                          <Badge
                            variant="outline"
                            className="border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300"
                          >
                            Invite pending
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
                        {member.invitation_token &&
                          member.invitation_status === "pending" && (
                            <Button
                              variant="ghost"
                              size="sm"
                              title="Copy invitation link"
                              onClick={() =>
                                handleCopyInvite(member.invitation_token!)
                              }
                            >
                              <Copy className="h-3.5 w-3.5" />
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
          townId={townId}
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
