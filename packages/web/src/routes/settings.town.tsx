/**
 * Settings > Town Profile — /settings/town
 *
 * Town profile and configuration settings. Content extracted from
 * the old dashboard.tsx route in Session UI.03.
 *
 * Stage 1, Phase E, Task 2 — moved the town-profile read onto `town.detail`
 * (Task 1) and the four child editors' writes onto the matching
 * `town.update*` / `acknowledgeRetentionPolicy` mutations. `town.detail`'s
 * loading and error states now get their own visible states (conventions
 * item 5); the old version rendered an indefinite skeleton or a generic
 * "not found" message for both, which is the silent-failure mode this
 * migration exists to end.
 *
 * Task 5 (same wave) adds `SetPortalAddressModal`, mounted here the same way
 * `RetentionPolicyModal` already is: `ProgressChecklist` only holds a
 * callback (`onSetPortalAddressClick`), this route owns the dialog's
 * open/closed state.
 *
 * Wave 2, Task 2 — the "Governing Board" / "Boards & Committees" sections'
 * board list moves onto `board.listActive`, closing the `TODO(phase-e-wave-2)`
 * marker naming `board.byTown` that Task 1 of this wave shipped that
 * procedure to answer. This route's own query read exactly
 * `id, name, is_governing_board, member_count, election_method,
 * officer_election_method` — precisely `listActive`'s six columns, checked
 * against the `boards.find(...)` (Governing Board) and `boards.map(...)`
 * (Boards & Committees) blocks below — and `listActive`'s own
 * `archived_at IS NULL` filter matches this route's prior
 * `.is("archived_at", null)` exactly, so this is a like-for-like swap, not a
 * behavior change.
 */

import { useState } from "react";
import { Navigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { isTRPCClientError } from "@trpc/client";
import { AlertTriangle, RefreshCw } from "lucide-react";
import type { Route } from "./+types/settings.town";
import { RouteErrorBoundary } from "@/components/RouteErrorBoundary";
import { Button } from "@/components/ui/button";
import { ProgressChecklist } from "@/components/dashboard/ProgressChecklist";
import { SettingsSection, SettingRow } from "@/components/dashboard/SettingsSection";
import {
  TownSettingsEditor,
  POPULATION_LABELS,
  MUNICIPALITY_LABELS,
} from "@/components/dashboard/TownSettingsEditor";
import {
  MeetingDefaultsEditor,
  FORMALITY_OPTIONS,
  MINUTES_STYLE_OPTIONS,
} from "@/components/dashboard/MeetingDefaultsEditor";
import {
  MeetingRolesEditor,
  PRESIDING_OFFICER_OPTIONS,
  MINUTES_RECORDER_OPTIONS,
} from "@/components/dashboard/MeetingRolesEditor";
import { TownSealUpload } from "@/components/dashboard/TownSealUpload";
import { RetentionPolicyModal } from "@/components/dashboard/RetentionPolicyModal";
import { SetPortalAddressModal } from "@/components/dashboard/SetPortalAddressModal";
import { Accordion } from "@/components/ui/accordion";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { trpc } from "@/lib/trpc";
import { DashboardStatsSkeleton, SettingsSectionSkeleton } from "@/components/skeletons";

// ─── Label helpers ──────────────────────────────────────────────────

function getLabel(options: readonly { value: string; label: string }[], value: string) {
  return options.find((o) => o.value === value)?.label ?? value;
}

const STATE_LABELS: Record<string, string> = {
  ME: "Maine",
  NH: "New Hampshire",
  VT: "Vermont",
  MA: "Massachusetts",
  CT: "Connecticut",
  RI: "Rhode Island",
};

// ─── Route ──────────────────────────────────────────────────────────

// No `ensureQueryData(trpc.town.detail.queryOptions())` priming here, unlike
// `boards.$boardId.tsx`'s loader — deliberately, not an oversight. This route
// has no path param to key a loader on, and the thing that decides whether to
// show this screen at all is `useCurrentUser().townId` (an account with no
// tenant redirects to `/setup` below), which is only known once
// `AuthProvider` has resolved, after the loader has already run. Priming here
// would mean either racing that resolution or calling `town.detail` for an
// account that has no town yet, which answers FORBIDDEN and would route to
// `RouteErrorBoundary` for what is actually the ordinary "finish onboarding"
// case. `people.tsx` and `boards.tsx` make the same choice for the same
// reason. The `ErrorBoundary` export below still matters: it is what catches
// an unrelated loader failure elsewhere in this route tree, same as any
// other route.
export async function clientLoader() {
  return {};
}

export default function SettingsTownPage(_props: Route.ComponentProps) {
  const currentUser = useCurrentUser();
  const townId = currentUser?.townId;

  // ─── Edit mode state ────────────────────────────────────────────
  const [editingSection, setEditingSection] = useState<string | null>(null);
  const [retentionModalOpen, setRetentionModalOpen] = useState(false);
  const [portalAddressModalOpen, setPortalAddressModalOpen] = useState(false);

  // ─── Reactive queries ───────────────────────────────────────────
  // `town.detail` takes no input — see its own doc comment — so `enabled`
  // is what stops it firing before `townId` is known, not an argument to
  // `queryOptions()`.
  const {
    data: town,
    isLoading: isTownLoading,
    isError: isTownError,
    error: townError,
  } = useQuery({ ...trpc.town.detail.queryOptions(), enabled: !!townId });

  const { data: boards = [] } = useQuery({
    ...trpc.board.listActive.queryOptions(),
    enabled: !!townId,
  });

  // No townId at all → user hasn't completed onboarding
  if (!townId) {
    return <Navigate to="/setup" replace />;
  }

  // A screen that renders nothing and says nothing for a failed read is the
  // failure mode this migration exists to end (conventions item 5) — so a
  // rejected `town.detail` (most plausibly a corrupted tenant bridge; see
  // that procedure's own doc comment) gets a visible, `role="alert"` state
  // distinct from "still loading."
  if (isTownError) {
    const notFound = isTRPCClientError(townError) && townError.data?.code === "NOT_FOUND";
    return (
      <div className="flex items-center justify-center p-12" role="alert" aria-live="assertive">
        <div className="mx-auto max-w-md rounded-lg border bg-card p-6 text-center text-card-foreground shadow-sm">
          <AlertTriangle className="mx-auto h-6 w-6 text-destructive" aria-hidden="true" />
          <p className="mt-3 text-sm font-medium">
            {notFound
              ? "This town's profile could not be found."
              : "Something went wrong loading your town's settings."}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {notFound
              ? "Your account may not be linked to a town record. Contact support."
              : "Try reloading the page. If the problem continues, contact support."}
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-4"
            onClick={() => window.location.reload()}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Reload
          </Button>
        </div>
      </div>
    );
  }

  // townId exists but the read hasn't settled yet — show skeleton
  if (isTownLoading || !town) {
    return (
      <div className="p-6 max-w-4xl space-y-6">
        <div className="h-8 w-56 rounded-md bg-muted animate-pulse" />
        <DashboardStatsSkeleton />
        <SettingsSectionSkeleton rows={5} />
      </div>
    );
  }

  // `town.detail`'s columns are already real types (conventions item 10) —
  // no `Record<string, unknown>` bag and no `as` casts, unlike the Supabase
  // read this replaces. Only the nullable text columns get a UI default.
  const t = {
    id: town.id,
    name: town.name,
    state: town.state,
    municipality_type: town.municipality_type,
    population_range: town.population_range ?? "under_1000",
    contact_name: town.contact_name ?? "",
    contact_role: town.contact_role ?? "",
    meeting_formality: town.meeting_formality,
    minutes_style: town.minutes_style,
    presiding_officer_default: town.presiding_officer_default ?? "chair_of_board",
    minutes_recorder_default: town.minutes_recorder_default ?? "town_clerk",
    staff_roles_present: town.staff_roles_present,
    subdomain: town.subdomain,
    seal_url: town.seal_url,
    retention_policy_acknowledged_at: town.retention_policy_acknowledged_at,
    minutes_workflow_configured_at: town.minutes_workflow_configured_at,
  };

  // staff_roles_present is `jsonb`, typed `string[] | null` by `town.detail`
  // (F9 in the Task 2 fix round — not `unknown | null`, which collapsed to
  // `any[]` through this same narrowing and only looked typed).
  const staffRoles: string[] = Array.isArray(t.staff_roles_present) ? t.staff_roles_present : [];

  const STAFF_ROLE_LABELS: Record<string, string> = {
    town_manager: "Town Manager",
    town_administrator: "Town Administrator",
    town_clerk: "Town Clerk",
    deputy_clerk: "Deputy Clerk",
    none: "None (volunteer board)",
  };

  return (
    <div className="p-6">
      {/* Retention policy modal */}
      <RetentionPolicyModal
        townId={t.id}
        open={retentionModalOpen}
        onOpenChange={setRetentionModalOpen}
      />

      {/* Set portal address modal */}
      <SetPortalAddressModal
        townId={t.id}
        currentSubdomain={t.subdomain}
        open={portalAddressModalOpen}
        onOpenChange={setPortalAddressModalOpen}
      />

      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">
          {MUNICIPALITY_LABELS[t.municipality_type] ?? "Town"} of {t.name}
        </h1>
        <p className="mt-1 text-muted-foreground">Town profile and settings</p>
      </div>

      {/* Progress checklist */}
      <div className="mb-6">
        <ProgressChecklist
          sealUrl={t.seal_url}
          subdomain={t.subdomain}
          retentionAcknowledgedAt={t.retention_policy_acknowledged_at}
          minutesWorkflowConfiguredAt={t.minutes_workflow_configured_at}
          onRetentionPolicyClick={() => setRetentionModalOpen(true)}
          onSetPortalAddressClick={() => setPortalAddressModalOpen(true)}
        />
      </div>

      {/* Collapsible settings sections */}
      <div className="rounded-lg border bg-card text-card-foreground shadow-sm">
        <div className="px-6 pt-5 pb-2">
          <h2 className="text-lg font-semibold">Town Settings</h2>
          <p className="text-sm text-muted-foreground">Review and edit your town configuration</p>
        </div>
        <div className="px-6 pb-4">
          <Accordion type="single" collapsible>
            {/* ─── Your Town ─────────────────────────────────── */}
            <SettingsSection
              value="town"
              title="Your Town"
              isEditing={editingSection === "town"}
              onEditToggle={(editing) => setEditingSection(editing ? "town" : null)}
              summary={
                <>
                  <SettingRow label="Town name" value={t.name} />
                  <SettingRow label="State" value={STATE_LABELS[t.state] ?? t.state} />
                  <SettingRow
                    label="Municipality type"
                    value={MUNICIPALITY_LABELS[t.municipality_type] ?? t.municipality_type}
                  />
                  <SettingRow
                    label="Population"
                    value={POPULATION_LABELS[t.population_range] ?? t.population_range}
                  />
                  <SettingRow label="Contact" value={`${t.contact_name} (${t.contact_role})`} />
                </>
              }
              editor={
                <TownSettingsEditor
                  townId={t.id}
                  initial={{
                    name: t.name,
                    // No `as` casts on any of the four fields below (F5 in
                    // the Task 2 fix round): `town.detail` now types these
                    // columns with the same unions `TownSettingsEditor`'s
                    // own zod schema accepts, so they line up without an
                    // unchecked narrowing at the call site.
                    state: t.state,
                    municipality_type: t.municipality_type,
                    population_range: t.population_range,
                    contact_name: t.contact_name,
                    contact_role: t.contact_role,
                  }}
                  onDone={() => setEditingSection(null)}
                />
              }
            />

            {/* ─── Governing Board ────────────────────────────── */}
            {(() => {
              const govBoard = boards.find((b) => b.is_governing_board === true);
              if (!govBoard) return null;
              return (
                <SettingsSection
                  value="governing-board"
                  title="Governing Board"
                  summary={
                    <>
                      <SettingRow label="Board name" value={govBoard.name} />
                      <SettingRow label="Members" value={String(govBoard.member_count ?? 0)} />
                      <SettingRow
                        label="Election method"
                        value={
                          govBoard.election_method === "role_titled" ? "Role-titled" : "At-large"
                        }
                      />
                      <SettingRow
                        label="Officer election"
                        value={String(govBoard.officer_election_method ?? "").replace(/_/g, " ")}
                      />
                    </>
                  }
                  editor={
                    <p className="text-sm text-muted-foreground">
                      Board editing will be available from the Boards section.
                    </p>
                  }
                />
              );
            })()}

            {/* ─── Meeting Roles ──────────────────────────────── */}
            <SettingsSection
              value="meeting-roles"
              title="Meeting Roles"
              isEditing={editingSection === "meeting-roles"}
              onEditToggle={(editing) => setEditingSection(editing ? "meeting-roles" : null)}
              summary={
                <>
                  <SettingRow
                    label="Presiding officer"
                    value={getLabel(PRESIDING_OFFICER_OPTIONS, t.presiding_officer_default)}
                  />
                  <SettingRow
                    label="Minutes recorder"
                    value={getLabel(MINUTES_RECORDER_OPTIONS, t.minutes_recorder_default)}
                  />
                  <SettingRow
                    label="Staff present"
                    value={
                      staffRoles.length > 0
                        ? staffRoles.map((r) => STAFF_ROLE_LABELS[r] ?? r).join(", ")
                        : "None specified"
                    }
                  />
                </>
              }
              editor={
                <MeetingRolesEditor
                  townId={t.id}
                  initial={{
                    presiding_officer_default: t.presiding_officer_default,
                    minutes_recorder_default: t.minutes_recorder_default,
                  }}
                  onDone={() => setEditingSection(null)}
                />
              }
            />

            {/* ─── Boards & Committees ────────────────────────── */}
            <SettingsSection
              value="boards"
              title="Boards & Committees"
              summary={
                <div className="space-y-2">
                  {boards.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No boards configured</p>
                  ) : (
                    boards.map((b) => (
                      <div key={b.id} className="flex items-center justify-between text-sm">
                        <span className="font-medium">
                          {b.name}
                          {b.is_governing_board === true && (
                            <span className="ml-2 text-xs text-muted-foreground">(Governing)</span>
                          )}
                        </span>
                        <span className="text-muted-foreground">
                          {String(b.member_count ?? 0)} members
                        </span>
                      </div>
                    ))
                  )}
                </div>
              }
              editor={
                <p className="text-sm text-muted-foreground">
                  Manage boards from the Boards section in the sidebar.
                </p>
              }
            />

            {/* ─── Meeting Style & Minutes ─────────────────────── */}
            <SettingsSection
              value="meeting-style"
              title="Meeting Style & Minutes"
              isEditing={editingSection === "meeting-style"}
              onEditToggle={(editing) => setEditingSection(editing ? "meeting-style" : null)}
              summary={
                <>
                  <SettingRow
                    label="Formality"
                    value={getLabel(FORMALITY_OPTIONS, t.meeting_formality)}
                  />
                  <SettingRow
                    label="Minutes style"
                    value={getLabel(MINUTES_STYLE_OPTIONS, t.minutes_style)}
                  />
                </>
              }
              editor={
                <MeetingDefaultsEditor
                  townId={t.id}
                  initial={{
                    // No `as` casts (F5): see the equivalent note above
                    // `TownSettingsEditor`'s `initial` prop.
                    meeting_formality: t.meeting_formality,
                    minutes_style: t.minutes_style,
                  }}
                  onDone={() => setEditingSection(null)}
                />
              }
            />
          </Accordion>
        </div>

        {/* Town seal section */}
        <div className="border-t px-6 py-5">
          <h3 className="mb-3 text-sm font-semibold">Town Seal</h3>
          <TownSealUpload townId={t.id} sealUrl={t.seal_url} />
        </div>
      </div>
    </div>
  );
}

export { RouteErrorBoundary as ErrorBoundary };
