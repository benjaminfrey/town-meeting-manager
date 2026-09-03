/**
 * Minutes Review Page — /meetings/:meetingId/minutes
 *
 * Displays the generated minutes document with status tracking,
 * action buttons (edit, submit, approve, publish), amendment history,
 * and inline dialogs for status transitions.
 *
 * TODO(phase-e-wave-6): minutesDocument.detail / the minutes status writes —
 * every read and write on this screen is still raw Supabase. `minutesDocument`
 * exists (wave 3, Task 3) but carries `byMeeting` only, which answers the
 * shell's status pill, not this screen's full document; and no procedure
 * exists for any of the six status transitions below. Wave 6 owns this file
 * per the wave-3 plan's own "Out of scope" note.
 *
 * What DID land here in wave 3's whole-branch fix round is only the
 * invalidation half — see `invalidateMinutes` for why the shell's pill went
 * stale without it, and why a `minutes`-namespace writer slipped past
 * `lib/__tests__/cache-key-parity.test.ts`. Pinned in
 * `meetings.$meetingId.minutes.test.tsx`.
 */

import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  CheckCircle2,
  ChevronRight,
  Clock,
  Download,
  FileText,
  Lock,
  RefreshCw,
  Send,
  Undo2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import type { Route } from "./+types/meetings.$meetingId.minutes";
import { RouteErrorBoundary } from "@/components/RouteErrorBoundary";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { hasPermission, type PermissionsMatrix } from "@town-meeting/shared";
import type { MinutesContentJson } from "@town-meeting/shared/types";
import { MinutesEditor } from "@/components/minutes/MinutesEditor";
import { TrackedChanges } from "@/components/minutes/TrackedChanges";
import { supabase } from "@/lib/supabase";
import { queryKeys } from "@/lib/queryKeys";
import { trpc } from "@/lib/trpc";
import { apiFetch, apiJson } from "@/lib/api-client";

// ─── Route Loader ─────────────────────────────────────────────────

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  return { meetingId: params.meetingId };
}

// ─── Constants ────────────────────────────────────────────────────

type MinutesStatus = "draft" | "review" | "approved" | "published";

interface AmendmentEntry {
  round: number;
  returned_at: string;
  reason: string;
  returned_by: string;
  resubmitted_at: string | null;
}

const STATUS_BADGE_CONFIG: Record<
  MinutesStatus,
  { variant: "outline" | "default"; className: string; label: string }
> = {
  draft: { variant: "outline", className: "", label: "Draft" },
  review: {
    variant: "default",
    className: "bg-amber-500 hover:bg-amber-600",
    label: "Under Review",
  },
  approved: {
    variant: "default",
    className: "bg-green-600 hover:bg-green-700",
    label: "Approved",
  },
  published: {
    variant: "default",
    className: "bg-blue-600 hover:bg-blue-700",
    label: "Published",
  },
};

const TIMELINE_STEPS = [
  { key: "generated", label: "Generated", field: "generated_at" },
  { key: "submitted", label: "Submitted", field: "submitted_for_review_at" },
  { key: "approved", label: "Approved", field: "approved_at" },
  { key: "published", label: "Published", field: "published_at" },
] as const;

// ─── Component ────────────────────────────────────────────────────

export default function MinutesReviewPage({ loaderData }: Route.ComponentProps) {
  const { meetingId } = loaderData;
  const queryClient = useQueryClient();
  const user = useCurrentUser();

  // ─── State ──────────────────────────────────────────────────────
  const [isEditing, setIsEditing] = useState(false);
  const [submitDialogOpen, setSubmitDialogOpen] = useState(false);
  const [publishDialogOpen, setPublishDialogOpen] = useState(false);
  const [returnDialogOpen, setReturnDialogOpen] = useState(false);
  const [returnReason, setReturnReason] = useState("");
  const [regenerating, setRegenerating] = useState(false);
  const [amendmentsExpanded, setAmendmentsExpanded] = useState(false);
  const [showChanges, setShowChanges] = useState(false);

  // ─── Queries ────────────────────────────────────────────────────
  const { data: minutesDoc } = useQuery({
    queryKey: queryKeys.minutes.byMeeting(meetingId),
    queryFn: async () => {
      const { data } = await supabase
        .from("minutes_document")
        .select("*")
        .eq("meeting_id", meetingId)
        .limit(1)
        .throwOnError();
      return (data ?? [])[0] ?? null;
    },
  });

  const { data: meeting } = useQuery({
    queryKey: queryKeys.meetings.detail(meetingId),
    queryFn: async () => {
      const { data } = await supabase
        .from("meeting")
        .select("*")
        .eq("id", meetingId)
        .limit(1)
        .throwOnError();
      return (data ?? [])[0] ?? null;
    },
  });

  const boardId = (meeting?.board_id as string) ?? "";
  const townId = (meeting?.town_id as string) ?? "";

  const { data: board } = useQuery({
    queryKey: queryKeys.boards.detail(boardId),
    queryFn: async () => {
      const { data } = await supabase
        .from("board")
        .select("*")
        .eq("id", boardId)
        .limit(1)
        .throwOnError();
      return (data ?? [])[0] ?? null;
    },
    enabled: !!boardId,
  });

  const { data: town } = useQuery({
    queryKey: queryKeys.towns.detail(townId),
    queryFn: async () => {
      const { data } = await supabase
        .from("town")
        .select("*")
        .eq("id", townId)
        .limit(1)
        .throwOnError();
      return (data ?? [])[0] ?? null;
    },
    enabled: !!townId,
  });

  // ─── Derived values ────────────────────────────────────────────
  const docId = (minutesDoc?.id as string) ?? "";
  const status = ((minutesDoc?.status as string) ?? "draft") as MinutesStatus;
  const htmlRendered = (minutesDoc?.html_rendered as string) ?? "";

  const boardName = (board?.name as string) ?? "";
  const meetingDate = (meeting?.scheduled_date as string) ?? "";
  const meetingType = (meeting?.meeting_type as string) ?? "regular";

  const formattedDate = useMemo(() => {
    if (!meetingDate) return "";
    return new Date(meetingDate + "T00:00:00").toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  }, [meetingDate]);

  const amendmentsHistory = useMemo((): AmendmentEntry[] => {
    if (!minutesDoc?.amendments_history) return [];
    // Supabase returns JSONB as parsed objects directly
    const raw = minutesDoc.amendments_history;
    if (Array.isArray(raw)) return raw as AmendmentEntry[];
    try {
      return JSON.parse(raw as string);
    } catch {
      return [];
    }
  }, [minutesDoc?.amendments_history]);

  const contentJson = useMemo((): MinutesContentJson | null => {
    if (!minutesDoc?.content_json) return null;
    // Supabase returns JSONB as parsed objects directly
    const raw = minutesDoc.content_json;
    if (typeof raw === "object" && raw !== null) return raw as MinutesContentJson;
    try {
      return JSON.parse(raw as string) as MinutesContentJson;
    } catch {
      return null;
    }
  }, [minutesDoc?.content_json]);

  const originalContentJson = useMemo((): MinutesContentJson | null => {
    if (!minutesDoc?.original_content_json) return null;
    // Supabase returns JSONB as parsed objects directly
    const raw = minutesDoc.original_content_json;
    if (typeof raw === "object" && raw !== null) return raw as MinutesContentJson;
    try {
      return JSON.parse(raw as string) as MinutesContentJson;
    } catch {
      return null;
    }
  }, [minutesDoc?.original_content_json]);

  // ─── Permissions ────────────────────────────────────────────────
  const canEditDraft = user
    ? hasPermission(user.permissions as unknown as PermissionsMatrix, "edit_draft_minutes")
    : false;
  const canSubmitForReview = user
    ? hasPermission(user.permissions as unknown as PermissionsMatrix, "submit_minutes_review")
    : false;
  const canGenerateAi = user
    ? hasPermission(user.permissions as unknown as PermissionsMatrix, "generate_ai_minutes")
    : false;
  const canPublish = user
    ? hasPermission(user.permissions as unknown as PermissionsMatrix, "publish_approved_minutes")
    : false;
  const canExport = user
    ? hasPermission(user.permissions as unknown as PermissionsMatrix, "export_minutes")
    : false;
  const isAdmin = user?.role === "admin" || user?.role === "sys_admin";

  // ─── Permission gate ───────────────────────────────────────────
  const canView = useMemo(() => {
    if (!user) return false;
    if (status === "approved" || status === "published") return true;
    if (isAdmin) return true;
    return hasPermission(user.permissions as unknown as PermissionsMatrix, "view_draft_minutes");
  }, [user, status, isAdmin]);

  // ─── Mutations ────────────────────────────────────────────────

  // Every mutation on this screen funnels through here, so both keys are
  // invalidated once rather than seven times.
  //
  // The legacy `queryKeys.minutes` line STAYS: this screen's own
  // `minutesDoc` read (above) is still a raw Supabase query on that key, and
  // `home.tsx` derives a key from the same namespace. It goes when the last
  // legacy reader does, not before (conventions item 7).
  //
  // The `pathFilter()` line was MISSING until the whole-branch fix round.
  // `routes/meetings.$meetingId.tsx`'s shell renders the minutes status pill
  // from `trpc.minutesDocument.byMeeting`, and this file writes
  // `minutes_document.status` at six sites (submit, approve, publish, return
  // for amendments, unpublish, regenerate) — so publishing minutes and
  // returning to the meeting detail showed a stale pill for up to the 60s
  // `staleTime`. Identical to the regression the previous fix round closed
  // for eight other files; it survived only because the mechanical check
  // (`lib/__tests__/cache-key-parity.test.ts`) keyed on the
  // `minutesDocuments` namespace and this writer uses `minutes` — two
  // namespaces over one table. Both are in `MIGRATED` now.
  const invalidateMinutes = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.minutes.byMeeting(meetingId) });
    void queryClient.invalidateQueries(trpc.minutesDocument.pathFilter());
  };

  const saveDraftMutation = useMutation({
    mutationFn: async (updatedContentJson: MinutesContentJson) => {
      const now = new Date().toISOString();
      await supabase
        .from("minutes_document")
        .update({ content_json: updatedContentJson, updated_at: now })
        .eq("id", docId)
        .throwOnError();

      // Re-render HTML/PDF server-side. Non-critical: the content itself is
      // already saved, and the render can be retried from the toolbar.
      await apiFetch(`/api/meetings/${meetingId}/minutes/render`, {
        method: "POST",
        json: { is_draft: true },
      }).catch(() => {});
    },
    onSuccess: () => {
      invalidateMinutes();
    },
  });

  const handleEditorSave = useCallback(
    async (updatedContentJson: MinutesContentJson) => {
      await saveDraftMutation.mutateAsync(updatedContentJson);
    },
    [saveDraftMutation],
  );

  const submitForReviewMutation = useMutation({
    mutationFn: async () => {
      const now = new Date().toISOString();

      // If there are pending amendments, mark the latest as resubmitted
      if (amendmentsHistory.length > 0) {
        const updated = [...amendmentsHistory];
        const latest = updated[updated.length - 1];
        if (latest && !latest.resubmitted_at) {
          updated[updated.length - 1] = { ...latest, resubmitted_at: now };
          await supabase
            .from("minutes_document")
            .update({
              status: "review",
              submitted_for_review_at: now,
              amendments_history: updated,
              updated_at: now,
            })
            .eq("id", docId)
            .throwOnError();
        } else {
          await supabase
            .from("minutes_document")
            .update({
              status: "review",
              submitted_for_review_at: now,
              updated_at: now,
            })
            .eq("id", docId)
            .throwOnError();
        }
      } else {
        await supabase
          .from("minutes_document")
          .update({
            status: "review",
            submitted_for_review_at: now,
            updated_at: now,
          })
          .eq("id", docId)
          .throwOnError();
      }

      // Sets status="review" and fires the minutes_review notification.
      // Non-critical: the status change above already committed.
      await apiFetch(`/api/meetings/${meetingId}/minutes/submit`, { method: "POST" }).catch(
        () => {},
      );
    },
    onSuccess: () => {
      invalidateMinutes();
      setSubmitDialogOpen(false);
      toast.success("Minutes submitted for board review");
    },
  });

  const approveMutation = useMutation({
    mutationFn: async () => {
      await apiJson(`/api/meetings/${meetingId}/minutes/approve`, { method: "POST" });
    },
    onSuccess: () => {
      invalidateMinutes();
      toast.success("Minutes approved");
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to approve minutes");
    },
  });

  const publishMutation = useMutation({
    mutationFn: async () => {
      const now = new Date().toISOString();
      await supabase
        .from("minutes_document")
        .update({
          status: "published",
          published_at: now,
          updated_at: now,
        })
        .eq("id", docId)
        .throwOnError();

      // Fire the minutes_published notification (best effort).
      //
      // `town_id` is still sent, but the API no longer trusts it: since Task
      // G1 a value that disagrees with the caller's own town is a 403 rather
      // than a silent cross-town fan-out.
      await apiFetch("/api/notifications/events", {
        method: "POST",
        json: {
          event_type: "minutes_published",
          town_id: townId,
          payload: {
            meeting_id: meetingId,
            board_id: boardId,
            minutes_document_id: docId,
          },
        },
      }).catch(() => {});
    },
    onSuccess: () => {
      invalidateMinutes();
      setPublishDialogOpen(false);
      toast.success("Minutes published to public portal");
    },
  });

  const returnForAmendmentsMutation = useMutation({
    mutationFn: async (reason: string) => {
      const now = new Date().toISOString();

      const updatedHistory: AmendmentEntry[] = [
        ...amendmentsHistory,
        {
          round: amendmentsHistory.length + 1,
          returned_at: now,
          reason: reason.trim(),
          returned_by: user?.id ?? "",
          resubmitted_at: null,
        },
      ];

      await supabase
        .from("minutes_document")
        .update({
          status: "draft",
          amendments_history: updatedHistory,
          submitted_for_review_at: null,
          updated_at: now,
        })
        .eq("id", docId)
        .throwOnError();
    },
    onSuccess: () => {
      invalidateMinutes();
      setReturnDialogOpen(false);
      setReturnReason("");
      toast.success("Minutes returned for amendments");
    },
  });

  const unpublishMutation = useMutation({
    mutationFn: async () => {
      const now = new Date().toISOString();
      await supabase
        .from("minutes_document")
        .update({
          status: "approved",
          published_at: null,
          updated_at: now,
        })
        .eq("id", docId)
        .throwOnError();
    },
    onSuccess: () => {
      invalidateMinutes();
      toast.success("Minutes unpublished");
    },
  });

  // ─── Handlers ──────────────────────────────────────────────────

  const handleSubmitForReview = useCallback(() => {
    submitForReviewMutation.mutate();
  }, [submitForReviewMutation]);

  const handleApprove = useCallback(() => {
    approveMutation.mutate();
  }, [approveMutation]);

  const handlePublish = useCallback(() => {
    publishMutation.mutate();
  }, [publishMutation]);

  const handleReturnForAmendments = useCallback(() => {
    if (!returnReason.trim()) return;
    returnForAmendmentsMutation.mutate(returnReason);
  }, [returnForAmendmentsMutation, returnReason]);

  const handleUnpublish = useCallback(() => {
    unpublishMutation.mutate();
  }, [unpublishMutation]);

  const handleRegenerate = useCallback(async () => {
    setRegenerating(true);
    try {
      await apiJson(`/api/meetings/${meetingId}/minutes/regenerate`, { method: "POST" });

      toast.success("Minutes regeneration started");
      invalidateMinutes();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to regenerate minutes");
    } finally {
      setRegenerating(false);
    }
  }, [meetingId]);

  // ─── Loading state ─────────────────────────────────────────────

  if (!meeting) {
    return (
      <div className="flex items-center justify-center p-12">
        <p className="text-sm text-muted-foreground">Loading meeting data...</p>
      </div>
    );
  }

  // ─── Permission denied ─────────────────────────────────────────

  if (!canView) {
    return (
      <div className="flex items-center justify-center p-12">
        <Card className="max-w-md">
          <CardHeader className="text-center">
            <Lock className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>
              You do not have permission to view draft minutes for this meeting. Contact your board
              administrator for access.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  // ─── Empty state (no minutes generated) ─────────────────────────

  if (!minutesDoc) {
    return (
      <div className="mx-auto max-w-4xl space-y-6 p-6">
        <Card className="mx-auto max-w-md text-center">
          <CardHeader>
            <FileText className="mx-auto mb-2 h-12 w-12 text-muted-foreground" />
            <CardTitle>No Minutes Generated Yet</CardTitle>
            <CardDescription>
              Minutes have not been generated for this meeting. Go to the post-meeting review page
              to generate minutes.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link to={`/meetings/${meetingId}/review`}>Go to Meeting Review</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ─── Main render ────────────────────────────────────────────────

  const badgeConfig = STATUS_BADGE_CONFIG[status];
  const approvedAt = (minutesDoc.approved_at as string) ?? null;
  const publishedAt = (minutesDoc.published_at as string) ?? null;

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      {/* Header section */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">{boardName}</h1>
          <div className="mt-1 flex items-center gap-3 text-sm text-muted-foreground">
            <span>{formattedDate}</span>
            <span className="capitalize">{meetingType} Meeting</span>
          </div>
        </div>
        <Badge variant={badgeConfig.variant} className={badgeConfig.className}>
          {badgeConfig.label}
        </Badge>
      </div>

      {/* Status Timeline */}
      <StatusTimeline status={status} minutesDoc={minutesDoc} />

      {/* Locked Banner */}
      {(status === "approved" || status === "published") && (
        <div className="flex items-center gap-3 rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-300">
          <Lock className="h-4 w-4 shrink-0" />
          <span>
            These minutes were approved
            {approvedAt &&
              ` on ${new Date(approvedAt).toLocaleDateString("en-US", {
                year: "numeric",
                month: "long",
                day: "numeric",
              })}`}{" "}
            and cannot be edited.
          </span>
        </div>
      )}

      {/* Review Banner */}
      {status === "review" && (
        <div className="flex items-center gap-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>DRAFT — Pending Board Approval</span>
        </div>
      )}

      {/* Action Bar */}
      <div className="flex flex-wrap items-center gap-2">
        {status === "draft" && canEditDraft && !isEditing && (
          <Button variant="outline" size="sm" onClick={() => setIsEditing(true)}>
            Edit
          </Button>
        )}
        {status === "draft" && canSubmitForReview && (
          <Button size="sm" onClick={() => setSubmitDialogOpen(true)}>
            <Send className="mr-1.5 h-4 w-4" />
            Submit for Review
          </Button>
        )}
        {status === "draft" && canGenerateAi && (
          <Button
            variant="outline"
            size="sm"
            disabled={regenerating}
            onClick={() => void handleRegenerate()}
          >
            <RefreshCw className={`mr-1.5 h-4 w-4 ${regenerating ? "animate-spin" : ""}`} />
            Regenerate
          </Button>
        )}
        {status === "review" && isAdmin && (
          <Button size="sm" onClick={() => handleApprove()} disabled={approveMutation.isPending}>
            <CheckCircle2 className="mr-1.5 h-4 w-4" />
            Approve Minutes
          </Button>
        )}
        {status === "review" && isAdmin && (
          <Button variant="outline" size="sm" onClick={() => setReturnDialogOpen(true)}>
            <Undo2 className="mr-1.5 h-4 w-4" />
            Return for Amendments
          </Button>
        )}
        {status === "approved" && canPublish && (
          <Button size="sm" onClick={() => setPublishDialogOpen(true)}>
            <Upload className="mr-1.5 h-4 w-4" />
            Publish to Portal
          </Button>
        )}
        {status === "published" && isAdmin && (
          <Button variant="outline" size="sm" onClick={() => handleUnpublish()}>
            Unpublish
          </Button>
        )}
        {canExport && minutesDoc.pdf_url && (
          <Button variant="outline" size="sm" asChild>
            <a href={minutesDoc.pdf_url as string} target="_blank" rel="noopener noreferrer">
              <Download className="mr-1.5 h-4 w-4" />
              Download PDF
            </a>
          </Button>
        )}
      </div>

      {/* Tracked Changes Toggle */}
      {!isEditing && originalContentJson && contentJson && (
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowChanges(!showChanges)}>
            {showChanges ? "Hide Changes" : "Show Changes"}
          </Button>
        </div>
      )}

      {/* Main Content */}
      {isEditing && contentJson ? (
        <MinutesEditor
          minutesDocId={docId}
          meetingId={meetingId}
          contentJson={contentJson}
          onSave={handleEditorSave}
        />
      ) : showChanges && originalContentJson && contentJson ? (
        <div className="rounded-md border bg-white p-8 shadow-sm dark:bg-card">
          <TrackedChanges
            originalContentJson={originalContentJson}
            currentContentJson={contentJson}
            visible={showChanges}
          />
        </div>
      ) : (
        <div
          className="prose prose-sm dark:prose-invert max-w-none rounded-md border bg-white p-8 shadow-sm dark:bg-card"
          dangerouslySetInnerHTML={{ __html: htmlRendered }}
        />
      )}

      {/* Amendment History */}
      {amendmentsHistory.length > 0 && (
        <div className="rounded-md border">
          <button
            type="button"
            className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-medium hover:bg-muted/50"
            onClick={() => setAmendmentsExpanded(!amendmentsExpanded)}
          >
            {amendmentsExpanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
            Amendment History ({amendmentsHistory.length}{" "}
            {amendmentsHistory.length === 1 ? "round" : "rounds"})
          </button>
          {amendmentsExpanded && (
            <div className="border-t px-4 py-3">
              <div className="space-y-3">
                {amendmentsHistory.map((entry) => (
                  <div key={entry.round} className="rounded-md border px-4 py-3 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">Round {entry.round}</span>
                      <span className="text-xs text-muted-foreground">
                        Returned{" "}
                        {new Date(entry.returned_at).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </span>
                    </div>
                    <p className="mt-1 text-muted-foreground">{entry.reason}</p>
                    {entry.resubmitted_at && (
                      <p className="mt-1 text-xs text-green-600">
                        Resubmitted{" "}
                        {new Date(entry.resubmitted_at).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── Dialogs ─────────────────────────────────────────────── */}

      {/* Submit for Review Dialog */}
      <AlertDialog open={submitDialogOpen} onOpenChange={setSubmitDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Submit for Board Review</AlertDialogTitle>
            <AlertDialogDescription>
              Submit these minutes to board members for review before the next meeting? Board
              members with viewing permission will be able to view the draft.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => handleSubmitForReview()}>
              Submit for Review
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Publish Dialog */}
      <AlertDialog open={publishDialogOpen} onOpenChange={setPublishDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Publish to Portal</AlertDialogTitle>
            <AlertDialogDescription>
              Publish these approved minutes to the public portal? They will be publicly accessible.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => handlePublish()}>Publish</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Return for Amendments Dialog */}
      <Dialog open={returnDialogOpen} onOpenChange={setReturnDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Return for Amendments</DialogTitle>
            <DialogDescription>
              Return these minutes to draft for amendments? They will need to be re-submitted for
              review.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <label htmlFor="return-reason" className="mb-1.5 block text-sm font-medium">
              Describe the requested changes
            </label>
            <textarea
              id="return-reason"
              className="flex min-h-[100px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              placeholder="Describe what changes are needed..."
              value={returnReason}
              onChange={(e) => setReturnReason(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setReturnDialogOpen(false);
                setReturnReason("");
              }}
            >
              Cancel
            </Button>
            <Button disabled={!returnReason.trim()} onClick={() => handleReturnForAmendments()}>
              Return for Amendments
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Status Timeline ─────────────────────────────────────────────

function StatusTimeline({
  status,
  minutesDoc,
}: {
  status: MinutesStatus;
  minutesDoc: Record<string, unknown>;
}) {
  const statusOrder: MinutesStatus[] = ["draft", "review", "approved", "published"];
  const currentIdx = statusOrder.indexOf(status);

  return (
    <div className="flex items-center justify-between rounded-md border bg-muted/30 px-6 py-4">
      {TIMELINE_STEPS.map((step, idx) => {
        const isPast = idx <= currentIdx;
        const timestamp = (minutesDoc[step.field] as string) ?? null;

        return (
          <div key={step.key} className="flex items-center">
            {idx > 0 && (
              <div
                className={`mx-3 h-0.5 w-12 sm:w-16 ${
                  idx <= currentIdx ? "bg-primary" : "bg-border"
                }`}
              />
            )}
            <div className="flex flex-col items-center gap-1">
              <div
                className={`flex h-7 w-7 items-center justify-center rounded-full border-2 ${
                  isPast
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-background text-muted-foreground"
                }`}
              >
                {isPast ? <Check className="h-4 w-4" /> : <Clock className="h-3.5 w-3.5" />}
              </div>
              <span
                className={`text-xs font-medium ${
                  isPast ? "text-foreground" : "text-muted-foreground"
                }`}
              >
                {step.label}
              </span>
              {timestamp && (
                <span className="text-[10px] text-muted-foreground">
                  {new Date(timestamp).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                  })}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export { RouteErrorBoundary as ErrorBoundary };
