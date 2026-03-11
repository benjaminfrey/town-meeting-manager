/**
 * Dashboard — /dashboard route (Town Profile Dashboard)
 *
 * The main home screen after onboarding. Shows:
 * - Welcome banner (on first visit after wizard completion)
 * - Quick tour overlay (one-time)
 * - Progress checklist (until all items are completed)
 * - Collapsible settings sections (one per wizard stage)
 * - Stat cards for meetings, boards, and pending minutes
 *
 * @see docs/advisory-resolutions/2.1-onboarding-wizard-ux-spec.md — Dashboard
 */

import { useCallback, useEffect, useState } from "react";
import { useSearchParams, Navigate } from "react-router";
import { useQuery, useStatus } from "@powersync/react";
import { PartyPopper, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Route } from "./+types/dashboard";
import { RouteErrorBoundary } from "@/components/RouteErrorBoundary";
import { ProgressChecklist } from "@/components/dashboard/ProgressChecklist";
import { SettingsSection, SettingRow } from "@/components/dashboard/SettingsSection";
import { TownSettingsEditor, POPULATION_LABELS, MUNICIPALITY_LABELS } from "@/components/dashboard/TownSettingsEditor";
import { MeetingDefaultsEditor, FORMALITY_OPTIONS, MINUTES_STYLE_OPTIONS } from "@/components/dashboard/MeetingDefaultsEditor";
import { MeetingRolesEditor, PRESIDING_OFFICER_OPTIONS, MINUTES_RECORDER_OPTIONS } from "@/components/dashboard/MeetingRolesEditor";
import { TownSealUpload } from "@/components/dashboard/TownSealUpload";
import { RetentionPolicyModal } from "@/components/dashboard/RetentionPolicyModal";
import { QuickTour, useShouldShowTour } from "@/components/QuickTour";
import { Accordion } from "@/components/ui/accordion";
import { useCurrentUser } from "@/hooks/useCurrentUser";

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

export async function clientLoader() {
  return {};
}

export default function Dashboard({ loaderData }: Route.ComponentProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const isWelcome = searchParams.get("welcome") === "true";
  const showTour = useShouldShowTour(isWelcome);
  const [tourActive, setTourActive] = useState(showTour);
  const currentUser = useCurrentUser();
  const townId = currentUser?.townId;

  // ─── Edit mode state ────────────────────────────────────────────
  const [editingSection, setEditingSection] = useState<string | null>(null);
  const [retentionModalOpen, setRetentionModalOpen] = useState(false);

  // ─── Reactive queries ───────────────────────────────────────────
  const { data: townRows } = useQuery(
    "SELECT * FROM towns WHERE id = ? LIMIT 1",
    [townId ?? ""]
  );
  const { data: boardRows } = useQuery(
    "SELECT * FROM boards WHERE town_id = ? AND archived_at IS NULL ORDER BY is_governing_board DESC, name ASC",
    [townId ?? ""]
  );
  const { data: meetingRows } = useQuery(
    "SELECT COUNT(*) as count FROM meetings WHERE town_id = ? AND status IN ('scheduled', 'in_progress')",
    [townId ?? ""]
  );
  const { data: pendingMinutesRows } = useQuery(
    "SELECT COUNT(*) as count FROM minutes_documents WHERE town_id = ? AND status = 'draft'",
    [townId ?? ""]
  );

  const town = townRows?.[0] as Record<string, unknown> | undefined;
  const boards = boardRows ?? [];
  const meetingCount = (meetingRows?.[0] as Record<string, unknown>)?.count ?? 0;
  const pendingMinutesCount = (pendingMinutesRows?.[0] as Record<string, unknown>)?.count ?? 0;
  const boardCount = boards.length;

  // ─── Callbacks ──────────────────────────────────────────────────
  const handleTourComplete = useCallback(() => {
    setTourActive(false);
    setSearchParams({}, { replace: true });
  }, [setSearchParams]);

  const dismissWelcome = useCallback(() => {
    setSearchParams({}, { replace: true });
  }, [setSearchParams]);

  // ─── Sync-aware loading state ───────────────────────────────────
  const syncStatus = useStatus();

  // No townId at all → user hasn't completed onboarding
  if (!townId) {
    return <Navigate to="/setup" replace />;
  }

  // townId exists but town data hasn't synced to local DB yet
  if (!town) {
    const hasSynced = syncStatus.hasSynced;
    return (
      <div className="flex flex-col items-center justify-center gap-4 p-12">
        {!hasSynced ? (
          <>
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
            <p className="text-sm text-muted-foreground">
              Syncing your town data...
            </p>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Town data not found. This can happen if the initial sync
              hasn&apos;t completed yet.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.location.reload()}
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              Reload
            </Button>
          </>
        )}
      </div>
    );
  }

  // Cast town fields
  const t = {
    id: town.id as string,
    name: (town.name as string) ?? "",
    state: (town.state as string) ?? "ME",
    municipality_type: (town.municipality_type as string) ?? "town",
    population_range: (town.population_range as string) ?? "under_1000",
    contact_name: (town.contact_name as string) ?? "",
    contact_role: (town.contact_role as string) ?? "",
    meeting_formality: (town.meeting_formality as string) ?? "informal",
    minutes_style: (town.minutes_style as string) ?? "summary",
    presiding_officer_default: (town.presiding_officer_default as string) ?? "chair_of_board",
    minutes_recorder_default: (town.minutes_recorder_default as string) ?? "town_clerk",
    staff_roles_present: town.staff_roles_present as string | null,
    subdomain: town.subdomain as string | null,
    seal_url: town.seal_url as string | null,
    retention_policy_acknowledged_at: town.retention_policy_acknowledged_at as string | null,
  };

  // Parse staff roles
  let staffRoles: string[] = [];
  try {
    if (t.staff_roles_present) {
      staffRoles = JSON.parse(t.staff_roles_present);
    }
  } catch { /* ignore */ }

  const STAFF_ROLE_LABELS: Record<string, string> = {
    town_manager: "Town Manager",
    town_administrator: "Town Administrator",
    town_clerk: "Town Clerk",
    deputy_clerk: "Deputy Clerk",
    none: "None (volunteer board)",
  };

  return (
    <div className="p-6">
      {/* Quick tour overlay */}
      {tourActive && <QuickTour onComplete={handleTourComplete} />}

      {/* Retention policy modal */}
      <RetentionPolicyModal
        townId={t.id}
        open={retentionModalOpen}
        onOpenChange={setRetentionModalOpen}
      />

      {/* Welcome banner */}
      {isWelcome && !tourActive && (
        <div className="mb-6 rounded-lg border border-green-200 bg-green-50 p-4 dark:border-green-900 dark:bg-green-950/30">
          <div className="flex items-start gap-3">
            <PartyPopper className="mt-0.5 h-5 w-5 flex-shrink-0 text-green-600 dark:text-green-400" />
            <div className="flex-1">
              <h2 className="font-semibold text-green-900 dark:text-green-100">
                Your town is set up!
              </h2>
              <p className="mt-1 text-sm text-green-700 dark:text-green-300">
                Everything is configured and ready to go. Complete the checklist
                below to get the most out of your workspace.
              </p>
            </div>
            <button
              onClick={dismissWelcome}
              className="text-sm text-green-600 hover:text-green-800 dark:text-green-400 dark:hover:text-green-200"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">
          {MUNICIPALITY_LABELS[t.municipality_type] ?? "Town"} of {t.name}
        </h1>
        <p className="mt-1 text-muted-foreground">
          Town profile and setup
        </p>
      </div>

      {/* Progress checklist */}
      <div className="mb-6">
        <ProgressChecklist
          townId={t.id}
          sealUrl={t.seal_url}
          retentionAcknowledgedAt={t.retention_policy_acknowledged_at}
          onRetentionPolicyClick={() => setRetentionModalOpen(true)}
        />
      </div>

      {/* Stat cards */}
      <div className="mb-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <div className="rounded-lg border bg-card p-6 text-card-foreground shadow-sm">
          <h3 className="text-sm font-medium text-muted-foreground">
            Upcoming Meetings
          </h3>
          <p className="mt-2 text-3xl font-bold">{String(meetingCount)}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {meetingCount === 0
              ? "No meetings scheduled"
              : `${meetingCount} meeting${meetingCount === 1 ? "" : "s"} scheduled`}
          </p>
        </div>
        <div className="rounded-lg border bg-card p-6 text-card-foreground shadow-sm">
          <h3 className="text-sm font-medium text-muted-foreground">
            Active Boards
          </h3>
          <p className="mt-2 text-3xl font-bold">{boardCount}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {boardCount === 0
              ? "No boards configured"
              : `${boardCount} board${boardCount === 1 ? "" : "s"} active`}
          </p>
        </div>
        <div className="rounded-lg border bg-card p-6 text-card-foreground shadow-sm">
          <h3 className="text-sm font-medium text-muted-foreground">
            Pending Minutes
          </h3>
          <p className="mt-2 text-3xl font-bold">{String(pendingMinutesCount)}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {pendingMinutesCount === 0
              ? "All minutes approved"
              : `${pendingMinutesCount} draft${pendingMinutesCount === 1 ? "" : "s"} pending`}
          </p>
        </div>
      </div>

      {/* Collapsible settings sections */}
      <div className="rounded-lg border bg-card text-card-foreground shadow-sm">
        <div className="px-6 pt-5 pb-2">
          <h2 className="text-lg font-semibold">Town Settings</h2>
          <p className="text-sm text-muted-foreground">
            Review and edit your town configuration
          </p>
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
                    state: t.state as "ME" | "NH" | "VT" | "MA" | "CT" | "RI",
                    municipality_type: t.municipality_type as "town" | "city" | "plantation",
                    population_range: t.population_range as "under_1000" | "1000_to_2500" | "2500_to_5000" | "5000_to_10000" | "over_10000",
                    contact_name: t.contact_name,
                    contact_role: t.contact_role,
                  }}
                  onDone={() => setEditingSection(null)}
                />
              }
            />

            {/* ─── Governing Board ────────────────────────────── */}
            {(() => {
              const govBoard = boards.find(
                (b: Record<string, unknown>) => b.is_governing_board === 1
              ) as Record<string, unknown> | undefined;
              if (!govBoard) return null;
              return (
                <SettingsSection
                  value="governing-board"
                  title="Governing Board"
                  summary={
                    <>
                      <SettingRow label="Board name" value={String(govBoard.name ?? "")} />
                      <SettingRow label="Members" value={String(govBoard.member_count ?? 0)} />
                      <SettingRow
                        label="Election method"
                        value={govBoard.election_method === "role_titled" ? "Role-titled" : "At-large"}
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
                    boards.map((b: Record<string, unknown>) => (
                      <div key={String(b.id)} className="flex items-center justify-between text-sm">
                        <span className="font-medium">
                          {String(b.name)}
                          {b.is_governing_board === 1 && (
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
                    meeting_formality: t.meeting_formality as "informal" | "semi_formal" | "formal",
                    minutes_style: t.minutes_style as "action" | "summary" | "narrative",
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
