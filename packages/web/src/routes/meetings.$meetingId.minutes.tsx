/**
 * Minutes Review Page — /meetings/:meetingId/minutes
 *
 * Displays the generated minutes document with status tracking,
 * action buttons (edit, submit, approve, publish), amendment history,
 * and inline dialogs for status transitions.
 */

import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router";
import { useQuery, usePowerSync } from "@powersync/react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
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
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { hasPermission } from "@town-meeting/shared";
import type { MinutesContentJson } from "@town-meeting/shared/types";
import { MinutesEditor } from "@/components/minutes/MinutesEditor";
import { TrackedChanges } from "@/components/minutes/TrackedChanges";

// ─── Route Loader ─────────────────────────────────────────────────

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  return { meetingId: params.meetingId };
}

// ─── Constants ────────────────────────────────────────────────────

const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

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

export default function MinutesReviewPage({
  loaderData,
}: Route.ComponentProps) {
  const { meetingId } = loaderData;
  const powerSync = usePowerSync();
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
  const { data: minutesDocRows } = useQuery(
    "SELECT * FROM minutes_documents WHERE meeting_id = ? LIMIT 1",
    [meetingId],
  );
  const minutesDoc = minutesDocRows?.[0] as
    | Record<string, unknown>
    | undefined;

  const { data: meetingRows } = useQuery(
    "SELECT * FROM meetings WHERE id = ? LIMIT 1",
    [meetingId],
  );
  const meeting = meetingRows?.[0] as Record<string, unknown> | undefined;
  const boardId = (meeting?.board_id as string) ?? "";
  const townId = (meeting?.town_id as string) ?? "";

  const { data: boardRows } = useQuery(
    "SELECT * FROM boards WHERE id = ? LIMIT 1",
    [boardId],
  );
  const board = boardRows?.[0] as Record<string, unknown> | undefined;

  const { data: townRows } = useQuery(
    "SELECT * FROM towns WHERE id = ? LIMIT 1",
    [townId],
  );
  const town = townRows?.[0] as Record<string, unknown> | undefined;

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
    try {
      return JSON.parse(minutesDoc.amendments_history as string);
    } catch {
      return [];
    }
  }, [minutesDoc?.amendments_history]);

  const contentJson = useMemo((): MinutesContentJson | null => {
    if (!minutesDoc?.content_json) return null;
    try {
      return JSON.parse(minutesDoc.content_json as string) as MinutesContentJson;
    } catch {
      return null;
    }
  }, [minutesDoc?.content_json]);

  const originalContentJson = useMemo((): MinutesContentJson | null => {
    if (!minutesDoc?.original_content_json) return null;
    try {
      return JSON.parse(minutesDoc.original_content_json as string) as MinutesContentJson;
    } catch {
      return null;
    }
  }, [minutesDoc?.original_content_json]);

  // ─── Permissions ────────────────────────────────────────────────
  const canEditDraft = user
    ? hasPermission(user.permissions, "edit_draft_minutes")
    : false;
  const canSubmitForReview = user
    ? hasPermission(user.permissions, "submit_minutes_review")
    : false;
  const canGenerateAi = user
    ? hasPermission(user.permissions, "generate_ai_minutes")
    : false;
  const canPublish = user
    ? hasPermission(user.permissions, "publish_approved_minutes")
    : false;
  const canExport = user
    ? hasPermission(user.permissions, "export_minutes")
    : false;
  const isAdmin = user?.role === "admin" || user?.role === "sys_admin";

  // ─── Permission gate ───────────────────────────────────────────
  const canView = useMemo(() => {
    if (!user) return false;
    if (status === "approved" || status === "published") return true;
    if (isAdmin) return true;
    return hasPermission(user.permissions, "view_draft_minutes");
  }, [user, status, isAdmin]);

  // ─── Handlers ──────────────────────────────────────────────────

  const handleEditorSave = useCallback(
    async (updatedContentJson: MinutesContentJson) => {
      const now = new Date().toISOString();
      await powerSync.execute(
        "UPDATE minutes_documents SET content_json = ?, updated_at = ? WHERE id = ?",
        [JSON.stringify(updatedContentJson), now, docId],
      );

      // Fire API call to re-render HTML/PDF
      try {
        const { createClient } = await import("@supabase/supabase-js");
        const supabase = createClient(
          import.meta.env.VITE_SUPABASE_URL ?? "http://localhost:54321",
          import.meta.env.VITE_SUPABASE_ANON_KEY ?? "",
        );
        const { data: sessionData } = await supabase.auth.getSession();
        const accessToken = sessionData?.session?.access_token;
        if (accessToken) {
          await fetch(`${API_BASE}/api/meetings/${meetingId}/minutes/render`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify({ is_draft: true }),
          });
        }
      } catch {
        // Non-critical — local changes are saved, server render may fail
      }
    },
    [powerSync, docId, meetingId],
  );

  const handleSubmitForReview = useCallback(async () => {
    const now = new Date().toISOString();

    // If there are pending amendments, mark the latest as resubmitted
    if (amendmentsHistory.length > 0) {
      const updated = [...amendmentsHistory];
      const latest = updated[updated.length - 1];
      if (latest && !latest.resubmitted_at) {
        updated[updated.length - 1] = { ...latest, resubmitted_at: now };
        await powerSync.execute(
          "UPDATE minutes_documents SET status = ?, submitted_for_review_at = ?, amendments_history = ?, updated_at = ? WHERE id = ?",
          ["review", now, JSON.stringify(updated), now, docId],
        );
      } else {
        await powerSync.execute(
          "UPDATE minutes_documents SET status = ?, submitted_for_review_at = ?, updated_at = ? WHERE id = ?",
          ["review", now, now, docId],
        );
      }
    } else {
      await powerSync.execute(
        "UPDATE minutes_documents SET status = ?, submitted_for_review_at = ?, updated_at = ? WHERE id = ?",
        ["review", now, now, docId],
      );
    }

    const notifId = crypto.randomUUID();
    await powerSync.execute(
      "INSERT INTO notification_events (id, town_id, event_type, payload, status, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      [
        notifId,
        townId,
        "minutes_submitted_review",
        JSON.stringify({
          meeting_id: meetingId,
          board_id: boardId,
          minutes_document_id: docId,
        }),
        "pending",
        now,
      ],
    );

    // Fire render API call (best effort)
    try {
      const token = await getAccessToken();
      if (token) {
        await fetch(
          `${API_BASE}/api/meetings/${meetingId}/minutes/render`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
          },
        );
      }
    } catch {
      // Non-critical
    }

    setSubmitDialogOpen(false);
    toast.success("Minutes submitted for board review");
  }, [powerSync, docId, townId, meetingId, boardId, amendmentsHistory]);

  const handlePublish = useCallback(async () => {
    const now = new Date().toISOString();
    await powerSync.execute(
      "UPDATE minutes_documents SET status = ?, published_at = ?, updated_at = ? WHERE id = ?",
      ["published", now, now, docId],
    );

    const notifId = crypto.randomUUID();
    await powerSync.execute(
      "INSERT INTO notification_events (id, town_id, event_type, payload, status, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      [
        notifId,
        townId,
        "minutes_published",
        JSON.stringify({
          meeting_id: meetingId,
          board_id: boardId,
          minutes_document_id: docId,
        }),
        "pending",
        now,
      ],
    );

    setPublishDialogOpen(false);
    toast.success("Minutes published to public portal");
  }, [powerSync, docId, townId, meetingId, boardId]);

  const handleReturnForAmendments = useCallback(async () => {
    if (!returnReason.trim()) return;
    const now = new Date().toISOString();

    const updatedHistory: AmendmentEntry[] = [
      ...amendmentsHistory,
      {
        round: amendmentsHistory.length + 1,
        returned_at: now,
        reason: returnReason.trim(),
        returned_by: user?.id ?? "",
        resubmitted_at: null,
      },
    ];

    await powerSync.execute(
      "UPDATE minutes_documents SET status = ?, amendments_history = ?, submitted_for_review_at = NULL, updated_at = ? WHERE id = ?",
      ["draft", JSON.stringify(updatedHistory), now, docId],
    );

    setReturnDialogOpen(false);
    setReturnReason("");
    toast.success("Minutes returned for amendments");
  }, [powerSync, docId, returnReason, amendmentsHistory, user?.id]);

  const handleUnpublish = useCallback(async () => {
    const now = new Date().toISOString();
    await powerSync.execute(
      "UPDATE minutes_documents SET status = ?, published_at = NULL, updated_at = ? WHERE id = ?",
      ["approved", now, docId],
    );
    toast.success("Minutes unpublished");
  }, [powerSync, docId]);

  const handleRegenerate = useCallback(async () => {
    setRegenerating(true);
    try {
      const token = await getAccessToken();
      if (!token) {
        toast.error("Not authenticated. Please sign in again.");
        return;
      }

      const res = await fetch(
        `${API_BASE}/api/meetings/${meetingId}/minutes/regenerate`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
        },
      );

      if (!res.ok) {
        const errData = (await res.json().catch(() => ({}))) as Record<
          string,
          unknown
        >;
        throw new Error(
          (errData.message as string) ??
            `Regeneration failed (${res.status})`,
        );
      }

      toast.success("Minutes regeneration started");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to regenerate minutes",
      );
    } finally {
      setRegenerating(false);
    }
  }, [meetingId]);

  // ─── Loading state ─────────────────────────────────────────────

  if (!meeting) {
    return (
      <div className="flex items-center justify-center p-12">
        <p className="text-sm text-muted-foreground">
          Loading meeting data...
        </p>
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
              You do not have permission to view draft minutes for this
              meeting. Contact your board administrator for access.
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
        {/* Breadcrumb */}
        <Breadcrumb
          boardId={boardId}
          boardName={boardName}
          meetingId={meetingId}
          meetingDate={formattedDate}
        />

        <Card className="mx-auto max-w-md text-center">
          <CardHeader>
            <FileText className="mx-auto mb-2 h-12 w-12 text-muted-foreground" />
            <CardTitle>No Minutes Generated Yet</CardTitle>
            <CardDescription>
              Minutes have not been generated for this meeting. Go to the
              post-meeting review page to generate minutes.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link to={`/meetings/${meetingId}/review`}>
                Go to Meeting Review
              </Link>
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
      {/* Breadcrumb */}
      <Breadcrumb
        boardId={boardId}
        boardName={boardName}
        meetingId={meetingId}
        meetingDate={formattedDate}
      />

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
          <Button
            size="sm"
            onClick={() => setSubmitDialogOpen(true)}
          >
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
            <RefreshCw
              className={`mr-1.5 h-4 w-4 ${regenerating ? "animate-spin" : ""}`}
            />
            Regenerate
          </Button>
        )}
        {status === "review" && isAdmin && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setReturnDialogOpen(true)}
          >
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
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleUnpublish()}
          >
            Unpublish
          </Button>
        )}
        {canExport && minutesDoc.pdf_url && (
          <Button variant="outline" size="sm" asChild>
            <a
              href={minutesDoc.pdf_url as string}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Download className="mr-1.5 h-4 w-4" />
              Download PDF
            </a>
          </Button>
        )}
      </div>

      {/* Tracked Changes Toggle */}
      {!isEditing && originalContentJson && contentJson && (
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowChanges(!showChanges)}
          >
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
                  <div
                    key={entry.round}
                    className="rounded-md border px-4 py-3 text-sm"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium">Round {entry.round}</span>
                      <span className="text-xs text-muted-foreground">
                        Returned{" "}
                        {new Date(entry.returned_at).toLocaleDateString(
                          "en-US",
                          {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          },
                        )}
                      </span>
                    </div>
                    <p className="mt-1 text-muted-foreground">
                      {entry.reason}
                    </p>
                    {entry.resubmitted_at && (
                      <p className="mt-1 text-xs text-green-600">
                        Resubmitted{" "}
                        {new Date(entry.resubmitted_at).toLocaleDateString(
                          "en-US",
                          {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          },
                        )}
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
              Submit these minutes to board members for review before the next
              meeting? Board members with viewing permission will be able to
              view the draft.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void handleSubmitForReview()}
            >
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
              Publish these approved minutes to the public portal? They will be
              publicly accessible.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handlePublish()}>
              Publish
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Return for Amendments Dialog */}
      <Dialog open={returnDialogOpen} onOpenChange={setReturnDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Return for Amendments</DialogTitle>
            <DialogDescription>
              Return these minutes to draft for amendments? They will need to
              be re-submitted for review.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <label
              htmlFor="return-reason"
              className="mb-1.5 block text-sm font-medium"
            >
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
            <Button
              disabled={!returnReason.trim()}
              onClick={() => void handleReturnForAmendments()}
            >
              Return for Amendments
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Breadcrumb ──────────────────────────────────────────────────

function Breadcrumb({
  boardId,
  boardName,
  meetingId,
  meetingDate,
}: {
  boardId: string;
  boardName: string;
  meetingId: string;
  meetingDate: string;
}) {
  return (
    <nav className="flex items-center gap-1.5 text-sm text-muted-foreground">
      <Link to="/" className="hover:text-foreground hover:underline">
        Dashboard
      </Link>
      <span>/</span>
      <Link to="/boards" className="hover:text-foreground hover:underline">
        Boards
      </Link>
      <span>/</span>
      <Link
        to={`/boards/${boardId}`}
        className="hover:text-foreground hover:underline"
      >
        {boardName || "Board"}
      </Link>
      <span>/</span>
      <Link
        to={`/meetings/${meetingId}/review`}
        className="hover:text-foreground hover:underline"
      >
        {meetingDate || "Meeting"}
      </Link>
      <span>/</span>
      <span className="font-medium text-foreground">Minutes</span>
    </nav>
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
  const statusOrder: MinutesStatus[] = [
    "draft",
    "review",
    "approved",
    "published",
  ];
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
                {isPast ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <Clock className="h-3.5 w-3.5" />
                )}
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

// ─── Auth helper ─────────────────────────────────────────────────

async function getAccessToken(): Promise<string | null> {
  try {
    const { createClient } = await import("@supabase/supabase-js");
    const client = createClient(
      import.meta.env.VITE_SUPABASE_URL ?? "http://localhost:54321",
      import.meta.env.VITE_SUPABASE_ANON_KEY ?? "",
    );
    const { data } = await client.auth.getSession();
    return data?.session?.access_token ?? null;
  } catch {
    return null;
  }
}

export { RouteErrorBoundary as ErrorBoundary };
