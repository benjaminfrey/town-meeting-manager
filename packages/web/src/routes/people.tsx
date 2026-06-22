/**
 * People (/people) — town-wide directory of everyone.
 *
 * Lists every person in the town — board members, staff, admins, and people not
 * yet assigned anywhere — with their role and board memberships. Admins (T2) can
 * add a person decoupled from any board and edit identity here. Per-board seating
 * still happens on each board's Members tab (where these people appear in the
 * "Add Member" picker).
 */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Users, Plus, Pencil } from "lucide-react";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { usePermission } from "@/hooks/usePermission";
import { queryKeys } from "@/lib/queryKeys";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { MeetingListSkeleton } from "@/components/skeletons";
import { RouteErrorBoundary } from "@/components/RouteErrorBoundary";
import { AddPersonDialog } from "@/components/members/AddPersonDialog";
import { EditPersonDialog } from "@/components/members/EditPersonDialog";

interface PersonRow {
  id: string;
  name: string | null;
  email: string | null;
}
interface AccountRow {
  person_id: string;
  role: string;
  gov_title: string | null;
}
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

  const { data: persons = [], isLoading } = useQuery({
    queryKey: queryKeys.persons.byTown(townId),
    queryFn: async () => {
      const { data } = await supabase
        .from("person")
        .select("id, name, email")
        .eq("town_id", townId)
        .is("archived_at", null)
        .order("name")
        .throwOnError();
      return (data ?? []) as PersonRow[];
    },
    enabled: !!townId,
  });

  const { data: accounts = [] } = useQuery({
    queryKey: queryKeys.userAccounts.byTown(townId),
    queryFn: async () => {
      const { data } = await supabase
        .from("user_account")
        .select("person_id, role, gov_title")
        .eq("town_id", townId)
        .is("archived_at", null)
        .throwOnError();
      return (data ?? []) as AccountRow[];
    },
    enabled: !!townId,
  });

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
    const accountByPerson = new Map(accounts.map((a) => [a.person_id, a]));
    const boardsByPerson = new Map<string, string[]>();
    for (const m of memberships) {
      if (!m.board) continue;
      const list = boardsByPerson.get(m.person_id) ?? [];
      if (!list.includes(m.board.name)) list.push(m.board.name);
      boardsByPerson.set(m.person_id, list);
    }
    return persons.map((p) => {
      const acct = accountByPerson.get(p.id);
      const boards = boardsByPerson.get(p.id) ?? [];
      const role = acct
        ? (ROLE_LABEL[acct.role] ?? acct.role)
        : boards.length > 0
          ? "Board member"
          : "No role yet";
      return {
        id: p.id,
        name: p.name ?? "Unnamed",
        email: p.email ?? "",
        govTitle: acct?.gov_title ?? null,
        role,
        hasRole: !!acct || boards.length > 0,
        boards,
      };
    });
  }, [persons, accounts, memberships]);

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">People</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Everyone in your town — board members, staff, and admins. Assign
            people to boards from each board's Members tab.
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
            {canManage
              ? "Add your first person to get started."
              : "An admin can add people here."}
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
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                  Name
                </th>
                <th className="hidden px-4 py-2.5 text-left font-medium text-muted-foreground sm:table-cell">
                  Role
                </th>
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                  Boards
                </th>
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
                    <span
                      className={
                        r.hasRole ? "text-foreground" : "text-muted-foreground"
                      }
                    >
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
                        onClick={() =>
                          setEditing({ id: r.id, name: r.name, email: r.email })
                        }
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

      {canManage && (
        <AddPersonDialog
          townId={townId}
          open={addOpen}
          onOpenChange={setAddOpen}
        />
      )}
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
