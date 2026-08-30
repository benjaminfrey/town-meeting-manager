/**
 * People (/people) — town-wide directory of everyone.
 *
 * Lists every person in the town — board members, staff, admins, and people not
 * yet assigned anywhere — with their role and board memberships. Admins (T2) can
 * add a person decoupled from any board and edit identity here. Per-board seating
 * still happens on each board's Members tab (where these people appear in the
 * "Add Member" picker).
 *
 * Phase E, wave 1, Task 3 — the person + user_account halves of this read are
 * `trpc.person.list` now, not two separate Supabase queries joined in JS. The
 * board-membership half stays on Supabase — see the `TODO(phase-e-wave-2)`
 * marker below and `person.ts`'s own doc comment for why that join was
 * deliberately NOT folded into the procedure.
 *
 * No `ensureQueryData(trpc.person.list.queryOptions())` in `clientLoader` —
 * deliberate, not an oversight, and the same call `settings.town.tsx` made
 * for the identical reason (see that file's own comment, Task 2): this route
 * sits under `AppShell`'s `ProtectedRoute`, which decides whether to render
 * `children` at all based on `useCurrentUser().townId`, but React Router
 * dispatches a matched route's `clientLoader` independently of whether an
 * ancestor COMPONENT chooses to render its `<Outlet>`. Priming here would
 * run `person.list` — and hit `protectedProcedure`'s tenant-required gate —
 * for an authenticated user who has no town yet, turning an ordinary
 * "finish onboarding" redirect into a `RouteErrorBoundary` failure page.
 * `boards.tsx` makes the same choice for the same reason.
 */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { isTRPCClientError } from "@trpc/client";
import { Users, Plus, Pencil, AlertTriangle } from "lucide-react";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { usePermission } from "@/hooks/usePermission";
import { queryKeys } from "@/lib/queryKeys";
import { supabase } from "@/lib/supabase";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { MeetingListSkeleton } from "@/components/skeletons";
import { RouteErrorBoundary } from "@/components/RouteErrorBoundary";
import { AddPersonDialog } from "@/components/members/AddPersonDialog";
import { EditPersonDialog } from "@/components/members/EditPersonDialog";

interface MembershipRow {
  person_id: string;
  board: { id: string; name: string } | null;
}

const ROLE_LABEL: Record<string, string> = {
  sys_admin: "System admin",
  admin: "Admin",
  staff: "Staff",
  board_member: "Board member",
};

export async function clientLoader() {
  return {};
}

export default function PeoplePage() {
  const currentUser = useCurrentUser();
  const townId = currentUser?.townId ?? "";
  const { allowed: canManage } = usePermission("T2");
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<{
    id: string;
    name: string;
    email: string;
  } | null>(null);

  const {
    data: people = [],
    isLoading,
    isError: isPeopleError,
    error: peopleError,
  } = useQuery(trpc.person.list.queryOptions());

  // TODO(phase-e-wave-2): boardMember.listByTown (or equivalent) — the
  // `boardMember` router exists now (Phase E, wave 2, Task 3), but no
  // procedure on it answers this question: `boardMember.roster` is scoped to
  // ONE board and `boardMember.memberCount` returns a bare count, neither the
  // town-wide "which boards does each person hold a seat on" join this read
  // needs. Re-checked directly in Task 4 rather than assumed closed by that
  // router's existence — see that task's report. Kept on Supabase; see
  // `person.ts`'s own doc comment for why this join was deliberately NOT
  // folded into `person.list` (it would make `trpc.person.pathFilter()` a
  // key every Board → Members writer — none of them touched by this task —
  // owed an invalidation to).
  const { data: memberships = [] } = useQuery({
    queryKey: [...queryKeys.members.all, "byTown", townId],
    queryFn: async () => {
      const { data } = await supabase
        .from("board_member")
        .select("person_id, board:board_id(id, name)")
        .eq("town_id", townId)
        .eq("status", "active")
        .throwOnError();
      return (data ?? []) as unknown as MembershipRow[];
    },
    enabled: !!townId,
  });

  const rows = useMemo(() => {
    const boardsByPerson = new Map<string, string[]>();
    for (const m of memberships) {
      if (!m.board) continue;
      const list = boardsByPerson.get(m.person_id) ?? [];
      if (!list.includes(m.board.name)) list.push(m.board.name);
      boardsByPerson.set(m.person_id, list);
    }
    return people.map((p) => {
      const boards = boardsByPerson.get(p.id) ?? [];
      const role = p.role
        ? (ROLE_LABEL[p.role] ?? p.role)
        : boards.length > 0
          ? "Board member"
          : "No role yet";
      return {
        id: p.id,
        name: p.name ?? "Unnamed",
        email: p.email ?? "",
        govTitle: p.gov_title,
        role,
        hasRole: !!p.role || boards.length > 0,
        boards,
      };
    });
  }, [people, memberships]);

  // The ONLY failure surface for this read — see the header comment on why
  // `clientLoader` deliberately does not prime `person.list` (so there is no
  // BEFORE-mount case here for `RouteErrorBoundary` to catch, unlike
  // `boards.$boardId.tsx`; conventions item 12's two-surface split does not
  // apply to this route). Covers the initial fetch, a refetch, and a
  // `staleTime` expiry alike.
  if (isPeopleError) {
    const notFound = isTRPCClientError(peopleError) && peopleError.data?.code === "NOT_FOUND";
    return (
      <div className="mx-auto max-w-4xl p-6">
        <div
          className="rounded-lg border border-destructive/30 bg-destructive/5 p-8 text-center"
          role="alert"
          aria-live="assertive"
        >
          <AlertTriangle className="mx-auto h-8 w-8 text-destructive" aria-hidden="true" />
          <p className="mt-3 font-medium">
            {notFound
              ? "This directory could not be found."
              : "Something went wrong loading people."}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Try reloading the page. If the problem continues, contact support.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">People</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Everyone in your town — board members, staff, and admins. Assign people to boards from
            each board's Members tab.
          </p>
        </div>
        {canManage && (
          <Button onClick={() => setAddOpen(true)} className="shrink-0">
            <Plus className="mr-2 h-4 w-4" />
            Add person
          </Button>
        )}
      </div>

      {isLoading ? (
        <MeetingListSkeleton rows={5} />
      ) : rows.length === 0 ? (
        <div className="rounded-lg border bg-card p-8 text-center">
          <Users className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 font-medium">No people yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {canManage ? "Add your first person to get started." : "An admin can add people here."}
          </p>
          {canManage && (
            <Button onClick={() => setAddOpen(true)} className="mt-4" size="sm">
              <Plus className="mr-2 h-4 w-4" />
              Add person
            </Button>
          )}
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40">
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Name</th>
                <th className="hidden px-4 py-2.5 text-left font-medium text-muted-foreground sm:table-cell">
                  Role
                </th>
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Boards</th>
                {canManage && <th className="w-10 px-4 py-2.5" />}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  className="border-b transition-colors last:border-b-0 hover:bg-muted/30"
                >
                  <td className="px-4 py-3">
                    <div className="font-medium">{r.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {r.govTitle ? `${r.govTitle} · ` : ""}
                      {r.email || "—"}
                    </div>
                  </td>
                  <td className="hidden px-4 py-3 sm:table-cell">
                    <span className={r.hasRole ? "text-foreground" : "text-muted-foreground"}>
                      {r.role}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {r.boards.length === 0 ? (
                      <span className="text-xs text-muted-foreground">—</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {r.boards.map((b) => (
                          <span
                            key={b}
                            className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                          >
                            {b}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  {canManage && (
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => setEditing({ id: r.id, name: r.name, email: r.email })}
                        className="text-muted-foreground transition-colors hover:text-foreground"
                        aria-label={`Edit ${r.name}`}
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canManage && <AddPersonDialog townId={townId} open={addOpen} onOpenChange={setAddOpen} />}
      {canManage && editing && (
        <EditPersonDialog
          key={editing.id}
          person={editing}
          townId={townId}
          open={!!editing}
          onOpenChange={(o) => {
            if (!o) setEditing(null);
          }}
        />
      )}
    </div>
  );
}

export { RouteErrorBoundary as ErrorBoundary };
