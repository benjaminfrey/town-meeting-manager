/**
 * Minutes Workflow Settings — /settings/minutes-workflow
 *
 * Town-level defaults for the minutes approval workflow.
 * Advisory 3.5 §6.1: audio retention, auto-publish, review window.
 *
 * Stage 1, Phase E, wave 1, Task 4 — moved onto `town.detail` (extended with
 * three columns this task added — see `town.ts`'s own doc comment) and the
 * new `town.updateMinutesWorkflow` mutation, from a standalone Supabase
 * `select(...)`/`update(...)` pair. `minutes_workflow_configured_at` is now
 * set server-side, inside the same `UPDATE` (via `COALESCE`), rather than
 * client-decided by checking the previous read — see that procedure's own
 * doc comment for the race that closes.
 *
 * Error and loading states now get their own visible states (conventions
 * item 5), matching `settings.town.tsx`'s pattern for the same `town.detail`
 * read.
 */

import { useState } from "react";
import { Link } from "react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { isTRPCClientError } from "@trpc/client";
import { ArrowLeft, AlertTriangle, Save, Loader2 } from "lucide-react";
import { queryKeys } from "@/lib/queryKeys";
import { trpc } from "@/lib/trpc";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { RouteErrorBoundary } from "@/components/RouteErrorBoundary";
import {
  AudioRetentionPolicy,
  AUDIO_RETENTION_LABELS,
  AUDIO_RETENTION_DESCRIPTIONS,
} from "@town-meeting/shared";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

// ─── Types ──────────────────────────────────────────────────────────

const RETENTION_OPTIONS: AudioRetentionPolicy[] = [
  AudioRetentionPolicy.PURGE_ON_APPROVAL,
  AudioRetentionPolicy.RETAIN_30_DAYS,
  AudioRetentionPolicy.RETAIN_90_DAYS,
  AudioRetentionPolicy.RETAIN_INDEFINITELY,
];

// ─── Route ──────────────────────────────────────────────────────────

// No `ensureQueryData` priming — this route has no path param, and what
// decides whether to show it at all is `useCurrentUser().townId`, only known
// after `AuthProvider` resolves. Same choice, same reason, as
// `settings.town.tsx`'s own `clientLoader`.
export async function clientLoader() {
  return {};
}

// ─── Component ──────────────────────────────────────────────────────

export default function MinutesWorkflowSettingsPage() {
  const currentUser = useCurrentUser();
  const townId = currentUser?.townId;
  const queryClient = useQueryClient();

  const {
    data: settings,
    isLoading,
    isError,
    error,
  } = useQuery({ ...trpc.town.detail.queryOptions(), enabled: !!townId });

  const [retentionPolicy, setRetentionPolicy] = useState<string | null>(null);
  const [autoPublish, setAutoPublish] = useState<boolean | null>(null);
  const [reviewWindow, setReviewWindow] = useState<string | null>(null);

  // Derived values: local state overrides server data
  const effectiveRetention =
    retentionPolicy ?? settings?.audio_retention_policy ?? "retain_30_days";
  const effectiveAutoPublish = autoPublish ?? settings?.auto_publish_on_approval ?? false;
  const effectiveReviewWindow = reviewWindow ?? String(settings?.minutes_review_window_days ?? 7);

  const isDirty = retentionPolicy !== null || autoPublish !== null || reviewWindow !== null;

  const saveMutation = useMutation(
    trpc.town.updateMinutesWorkflow.mutationOptions({
      onSuccess: () => {
        // Both invalidations run during the transition (conventions item 7):
        // `queryKeys.towns.detail(townId)` is still read directly by several
        // unmigrated screens (`home.tsx`, `boards.tsx`, `boards.$boardId.tsx`,
        // `meetings.$meetingId.{agenda,review,minutes}.tsx`,
        // `CreateMeetingDialog`), and `trpc.town.pathFilter()` is this
        // screen's own read (`town.detail`) — the legacy line stays until the
        // last of those migrates, per item 7's own rule.
        void queryClient.invalidateQueries({ queryKey: queryKeys.towns.detail(townId ?? "") });
        void queryClient.invalidateQueries(trpc.town.pathFilter());
        setRetentionPolicy(null);
        setAutoPublish(null);
        setReviewWindow(null);
      },
    }),
  );

  const handleSave = () => {
    saveMutation.mutate({
      audio_retention_policy: effectiveRetention as AudioRetentionPolicy,
      auto_publish_on_approval: effectiveAutoPublish,
      minutes_review_window_days: parseInt(effectiveReviewWindow, 10) || 7,
    });
  };

  // The failure mode this migration exists to end is a screen that renders
  // nothing and says nothing for a failed read (conventions item 5).
  if (isError) {
    const notFound = isTRPCClientError(error) && error.data?.code === "NOT_FOUND";
    return (
      <div className="p-6 max-w-3xl">
        <div
          className="rounded-lg border bg-card p-6 text-center text-card-foreground"
          role="alert"
          aria-live="assertive"
        >
          <AlertTriangle className="mx-auto h-6 w-6 text-destructive" aria-hidden="true" />
          <p className="mt-3 text-sm font-medium">
            {notFound
              ? "This town's profile could not be found."
              : "Something went wrong loading the minutes workflow settings."}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Try reloading the page. If the problem continues, contact support.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-3xl">
      <div className="mb-6">
        <Link
          to="/settings"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-2"
        >
          <ArrowLeft className="h-4 w-4" />
          Settings
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">Minutes Approval Workflow</h1>
        <p className="mt-1 text-muted-foreground">
          Configure town-wide defaults for how meeting minutes are reviewed, approved, and
          published. Individual boards can override these settings.
        </p>
      </div>

      {isLoading || !settings ? (
        <div className="text-sm text-muted-foreground">Loading settings...</div>
      ) : (
        <div className="space-y-6">
          {/* ─── Audio Retention ──────────────────────────────────── */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Recording & Audio Retention</CardTitle>
              <CardDescription>
                Choose how long meeting audio recordings are kept after minutes are approved.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {RETENTION_OPTIONS.map((option) => (
                  <label
                    key={option}
                    className="flex items-start gap-3 rounded-md border p-3 cursor-pointer hover:bg-muted/50 transition-colors has-[:checked]:border-primary has-[:checked]:bg-primary/5"
                  >
                    <input
                      type="radio"
                      name="audio_retention_policy"
                      value={option}
                      checked={effectiveRetention === option}
                      onChange={() => setRetentionPolicy(option)}
                      className="mt-1"
                    />
                    <div>
                      <p className="text-sm font-medium">{AUDIO_RETENTION_LABELS[option]}</p>
                      <p className="text-xs text-muted-foreground">
                        {AUDIO_RETENTION_DESCRIPTIONS[option]}
                      </p>
                    </div>
                  </label>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* ─── Portal Publishing ───────────────────────────────── */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Portal Publishing</CardTitle>
              <CardDescription>
                Control whether approved minutes are automatically published to your public portal.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="auto-publish" className="text-sm font-medium">
                    Auto-publish on approval
                  </Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    When enabled, minutes are published to the public portal as soon as the approval
                    motion passes. Otherwise, a staff member with the Publish permission (R5) must
                    manually publish.
                  </p>
                </div>
                <Switch
                  id="auto-publish"
                  checked={effectiveAutoPublish}
                  onCheckedChange={(checked) => setAutoPublish(checked)}
                />
              </div>
            </CardContent>
          </Card>

          {/* ─── Review Window ───────────────────────────────────── */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Review Window</CardTitle>
              <CardDescription>
                Set how many days before the next meeting draft minutes must be distributed to board
                members for review.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-3">
                <Label htmlFor="review-window" className="text-sm font-medium whitespace-nowrap">
                  Days before meeting
                </Label>
                <Input
                  id="review-window"
                  type="number"
                  min={1}
                  max={30}
                  className="w-24"
                  value={effectiveReviewWindow}
                  onChange={(e) => setReviewWindow(e.target.value)}
                />
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Board members will be notified when draft minutes are available for review within
                this window.
              </p>
            </CardContent>
          </Card>

          {/* ─── Save ────────────────────────────────────────────── */}
          <div className="flex items-center gap-3">
            <Button
              onClick={handleSave}
              disabled={
                (!isDirty && !!settings.minutes_workflow_configured_at) || saveMutation.isPending
              }
            >
              {saveMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              {settings.minutes_workflow_configured_at ? "Save Changes" : "Save & Complete Setup"}
            </Button>
            {saveMutation.isSuccess && (
              <span className="text-sm text-green-600">Settings saved</span>
            )}
            {saveMutation.isError && (
              <span className="text-sm text-red-600">Error saving settings</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export { RouteErrorBoundary as ErrorBoundary };
