/**
 * Minutes Review Page — /meetings/:meetingId/minutes
 *
 * Displays the generated minutes document with status tracking,
 * action buttons (edit, submit, approve, publish), amendment history,
 * and inline dialogs for status transitions.
 *
 * ─── Phase E, wave 6, Task 3 — the wiring ─────────────────────────────────
 *
 * Task 1 built `minutesDocument`'s two reads and six writes and nothing
 * called them. This screen does. Every read and every write here is tRPC and
 * `@/lib/supabase` is gone from this file.
 *
 *   - `minutesDocument.detail` replaces `select("*").eq("meeting_id", …)`.
 *     It applies rule 9 (R4 for this board, or the document is approved or
 *     published), which the raw read did not — a FORBIDDEN from it renders
 *     the same "Access Denied" card this screen's own `canView` gate already
 *     rendered, which is what that gate was expressing with nothing behind it.
 *   - `meeting.detail` (wave 3) replaces the meeting `select("*")` and is the
 *     ONE source of `board_id` on this screen: the four board-scoped writes
 *     below and `SourceDataPanel`'s roster read all take it as a prop or an
 *     argument rather than re-deriving it.
 *   - `board.detail` (unit 0) — the board's name in the header. Nothing else
 *     on this screen reads the board.
 *   - The six writes are `saveDraft`, `submitForReview`, `approve`,
 *     `publish`, `returnForAmendments` and `unpublish`. FIVE of them were raw
 *     `minutes_document` UPDATEs with NO authorization check of any kind, so
 *     FORBIDDEN is reachable here for the first time and every one of them
 *     surfaces its refusal — see "Where a refusal renders" below.
 *
 * `POST /api/meetings/:id/minutes/render` and `/regenerate` stay on
 * `apiJson`/`apiFetch`: both are Puppeteer routes no procedure replaces.
 * `/submit` and `/approve` are GONE from this screen — `submitForReview` and
 * `approve` each do the status change AND queue the notification in one
 * transaction, where the browser used to write the status itself and then
 * fire a second request whose failure it swallowed.
 *
 * ─── A behaviour change, stated: the town read is gone ────────────────────
 *
 * The `town` query fed exactly one thing, the `town_id` in the
 * `minutes_published` notification's request body, and nothing rendered it.
 * `minutesDocument.publish` queues that event server-side from
 * `ctx.tenant.townId`, so both the read and the `townId` local are dead and
 * removed rather than carried forward (conventions item 1).
 *
 * ─── Two live defects, both fixed here (see the `task-3-brief.md` list) ───
 *
 *   1. **The Download button had never rendered.** It gated on
 *      `minutesDoc.pdf_url`, and `minutes_document` has no `pdf_url` column —
 *      checked against `packages/api/drizzle/0000_baseline.sql`, where the
 *      column is `pdf_storage_path`; `pdf_url` occurs only in three
 *      `routes/minutes.ts` RESPONSE bodies, where it is computed as
 *      `/api/files/minutes/:id`. So `canExport && minutesDoc.pdf_url` was
 *      always falsy. `minutesDocument.detail` returns `has_pdf` instead, and
 *      the href is built from the id this screen already has — the same URL
 *      those three responses compute, and a route that applies rule 9 on
 *      every fetch.
 *   2. **The "Generated" timeline step read `generated_at`**, which is not a
 *      column either, so the step has always rendered without its date.
 *      `created_at` is what records it and is what `detail` returns.
 *
 * ─── Where a refusal renders, and why there are two places ────────────────
 *
 * Radix marks everything outside an open `AlertDialog`/`Dialog`
 * `aria-hidden`, and a refused write leaves the dialog open (the close lives
 * in `onSuccess`). So an error rendered beside the action bar is invisible
 * for exactly the case it exists for — conventions item 2's "render a refusal
 * INSIDE the confirmation dialog that triggered it", and the same two-site
 * shape `AgendaSection.tsx` carries. `submitForReview`, `publish` and
 * `returnForAmendments` reach the in-dialog site; `approve`, `unpublish` and
 * the editor's `saveDraft` have no dialog and reach the outer one. Both sites
 * are pinned in this route's own test file.
 */

import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { isTRPCClientError } from "@trpc/client";
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
import { queryClient } from "@/lib/queryClient";
import { trpc, refusalMessage, type RouterOutputs } from "@/lib/trpc";
import { apiFetch, apiJson } from "@/lib/api-client";

// ─── Route Loader ─────────────────────────────────────────────────

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  const meetingId = params.meetingId;

  // Not wrapped in try/catch: a nonexistent or foreign meeting answers
  // NOT_FOUND and letting that reject routes to `RouteErrorBoundary` below
  // (conventions item 12), rather than the indefinite "Loading meeting
  // data..." the old `select("*").limit(1)` produced — an empty array is
  // neither an error nor a meeting.
  //
  // `minutesDocument.detail` is deliberately NOT primed here. It can answer
  // FORBIDDEN (rule 9) for a draft this caller may not read, and a loader
  // rejection would replace this screen's "Access Denied" card with the route
  // error boundary. The component below owns that branch instead.
  await queryClient.ensureQueryData(trpc.meeting.detail.queryOptions({ meetingId }));

  return { meetingId };
}

// ─── Constants ────────────────────────────────────────────────────

type MinutesStatus = "draft" | "review" | "approved" | "published";

/** The document this screen renders, as the procedure returns it. */
type MinutesDetail = NonNullable<RouterOutputs["minutesDocument"]["detail"]>;

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

/**
 * `field` is a key of `MinutesDetail`, so a column the procedure stops
 * returning is a compile error here rather than a step that silently loses
 * its date. That is the whole of defect 2 in this file's header: "generated"
 * read `generated_at`, which has never been a column on `minutes_document`,
 * and a `Record<string, unknown>` index made it compile.
 */
const TIMELINE_STEPS: ReadonlyArray<{
  key: string;
  label: string;
  field: "created_at" | "submitted_for_review_at" | "approved_at" | "published_at";
}> = [
  { key: "generated", label: "Generated", field: "created_at" },
  { key: "submitted", label: "Submitted", field: "submitted_for_review_at" },
  { key: "approved", label: "Approved", field: "approved_at" },
  { key: "published", label: "Published", field: "published_at" },
];

// ─── Component ────────────────────────────────────────────────────

export default function MinutesReviewPage({ loaderData }: Route.ComponentProps) {
  const { meetingId } = loaderData;
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
  /** The last write's refusal or failure. See this file's header. */
  const [actionError, setActionError] = useState<string | null>(null);

  // ─── Queries ────────────────────────────────────────────────────
  const {
    data: minutesDoc,
    isPending: isMinutesPending,
    isError: isMinutesError,
    error: minutesError,
  } = useQuery(trpc.minutesDocument.detail.queryOptions({ meetingId }));

  const {
    data: meeting,
    isLoading: isMeetingLoading,
    isError: isMeetingError,
    error: meetingError,
  } = useQuery(trpc.meeting.detail.queryOptions({ meetingId }));

  const boardId = meeting?.board_id ?? "";

  const { data: board } = useQuery({
    ...trpc.board.detail.queryOptions({ boardId }),
    enabled: !!boardId,
  });

  // ─── Derived values ────────────────────────────────────────────
  const docId = minutesDoc?.id ?? "";
  const status = (minutesDoc?.status ?? "draft") as MinutesStatus;
  const htmlRendered = minutesDoc?.html_rendered ?? "";

  const boardName = board?.name ?? "";
  const meetingDate = meeting?.scheduled_date ?? "";
  const meetingType = meeting?.meeting_type ?? "regular";

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
    // `amendments_history` is nullable JSONB, so the procedure declares it
    // `unknown` and this narrows exactly as the server's own `amendmentsOf`
    // helper does. The old `JSON.parse(raw as string)` branch is gone: the
    // column has never held a JSON STRING, and a tRPC payload is already
    // parsed by the time it gets here.
    const raw = minutesDoc?.amendments_history;
    return Array.isArray(raw) ? (raw as AmendmentEntry[]) : [];
  }, [minutesDoc?.amendments_history]);

  const contentJson = useMemo((): MinutesContentJson | null => {
    const raw = minutesDoc?.content_json;
    return typeof raw === "object" && raw !== null ? (raw as MinutesContentJson) : null;
  }, [minutesDoc?.content_json]);

  const originalContentJson = useMemo((): MinutesContentJson | null => {
    const raw = minutesDoc?.original_content_json;
    return typeof raw === "object" && raw !== null ? (raw as MinutesContentJson) : null;
  }, [minutesDoc?.original_content_json]);

  // ─── Permissions ────────────────────────────────────────────────
  //
  // `boardId` and `role` are ADDED arguments (conventions item 1). Every call
  // here used to be `hasPermission(matrix, action)` with neither, which means
  // the browser resolved a DIFFERENT question from the one the server now
  // answers: it ignored this board's overrides, and it refused a town
  // administrator whose own matrix is empty — while `resolvePermission` on the
  // server short-circuits `role === "admin"` to true for every code. So the
  // buttons below now appear for exactly the callers the procedures admit,
  // which is the point of reading a permission on the client at all
  // (`router.ts`'s `permissions` doc comment). `role` is `null` for an
  // identity with no town yet; `hasPermission` takes `undefined` for "no role
  // known" and both mean deny, the same conversion `live.tsx` makes.
  const role = user?.role ?? undefined;
  const permissions = user?.permissions ?? null;
  const canEditDraft = hasPermission(permissions, "edit_draft_minutes", boardId || undefined, role);
  const canSubmitForReview = hasPermission(
    permissions,
    "submit_minutes_review",
    boardId || undefined,
    role,
  );
  const canGenerateAi = hasPermission(
    permissions,
    "generate_ai_minutes",
    boardId || undefined,
    role,
  );
  const canPublish = hasPermission(
    permissions,
    "publish_approved_minutes",
    boardId || undefined,
    role,
  );
  const canExport = hasPermission(permissions, "export_minutes", boardId || undefined, role);
  const isAdmin = user?.role === "admin" || user?.role === "sys_admin";

  // ─── Permission gate ───────────────────────────────────────────
  //
  // Kept, and now backed: `minutesDocument.detail` applies the same rule 9 on
  // the server, so this is the no-flash half of an answer the API also gives.
  // A caller who gets past this gate and is still refused lands in the
  // FORBIDDEN branch below, which renders the same card.
  const canView = useMemo(() => {
    if (!user) return false;
    if (status === "approved" || status === "published") return true;
    if (isAdmin) return true;
    return hasPermission(permissions, "view_draft_minutes", boardId || undefined, role);
  }, [user, status, isAdmin, permissions, boardId, role]);

  // ─── Mutations ────────────────────────────────────────────────

  // Every write on this screen funnels through here.
  //
  // The legacy `queryKeys.minutes.byMeeting(meetingId)` line is GONE, not
  // merely unused: this screen's own `minutesDoc` read was its only reader,
  // and it has moved to `trpc.minutesDocument.detail` above (conventions item
  // 7 — the legacy line goes when the last legacy reader does). `home.tsx`
  // still reads the `minutes` NAMESPACE, but under a different key
  // (`byMeeting("__home_pending__")` plus a town id), which this line never
  // matched and therefore never invalidated; it moves to
  // `minutesDocument.pendingByTown` in its own task and is reached by the
  // `pathFilter()` below from that moment on.
  //
  // `trpc.minutesDocument.pathFilter()` covers this screen's `detail` read AND
  // the status pill `routes/meetings.$meetingId.tsx`'s shell renders from
  // `byMeeting` — the regression the wave 3 fix round closed here, unchanged.
  const invalidateMinutes = () => {
    void queryClient.invalidateQueries(trpc.minutesDocument.pathFilter());
  };

  /** Clear the previous refusal when a new attempt starts. */
  const beginWrite = () => setActionError(null);

  const saveDraftMutation = useMutation(
    trpc.minutesDocument.saveDraft.mutationOptions({
      onMutate: beginWrite,
      onSuccess: () => {
        invalidateMinutes();
      },
      onError: (err) => setActionError(refusalMessage(err, "save these minutes")),
    }),
  );

  const handleEditorSave = useCallback(
    async (updatedContentJson: MinutesContentJson) => {
      await saveDraftMutation.mutateAsync({
        boardId,
        minutesDocumentId: docId,
        // `MinutesContentJson` is an interface, so it has no implicit index
        // signature and is not assignable to the procedure's
        // `Record<string, unknown>`. The VALUE is a plain JSON object either
        // way — this is a structural conversion, not a claim about the shape.
        contentJson: updatedContentJson as unknown as Record<string, unknown>,
      });

      // Re-render HTML/PDF server-side. Non-critical and deliberately outside
      // the mutation: it is a Puppeteer route that cannot join the write's
      // transaction, the content is already saved when it runs, and it can be
      // retried from the toolbar.
      await apiFetch(`/api/meetings/${meetingId}/minutes/render`, {
        method: "POST",
        json: { is_draft: true },
      }).catch(() => {});
    },
    [saveDraftMutation, boardId, docId, meetingId],
  );

  const submitForReviewMutation = useMutation(
    trpc.minutesDocument.submitForReview.mutationOptions({
      onMutate: beginWrite,
      onSuccess: () => {
        invalidateMinutes();
        setSubmitDialogOpen(false);
        toast.success("Minutes submitted for board review");
      },
      onError: (err) => setActionError(refusalMessage(err, "submit these minutes for review")),
    }),
  );

  const approveMutation = useMutation(
    trpc.minutesDocument.approve.mutationOptions({
      onMutate: beginWrite,
      onSuccess: () => {
        invalidateMinutes();
        toast.success("Minutes approved");
      },
      onError: (err) => setActionError(refusalMessage(err, "approve these minutes")),
    }),
  );

  const publishMutation = useMutation(
    trpc.minutesDocument.publish.mutationOptions({
      onMutate: beginWrite,
      onSuccess: () => {
        invalidateMinutes();
        setPublishDialogOpen(false);
        toast.success("Minutes published to public portal");
      },
      onError: (err) =>
        setActionError(refusalMessage(err, "publish these minutes to the public portal")),
    }),
  );

  const returnForAmendmentsMutation = useMutation(
    trpc.minutesDocument.returnForAmendments.mutationOptions({
      onMutate: beginWrite,
      onSuccess: () => {
        invalidateMinutes();
        setReturnDialogOpen(false);
        setReturnReason("");
        toast.success("Minutes returned for amendments");
      },
      onError: (err) => setActionError(refusalMessage(err, "return these minutes for amendments")),
    }),
  );

  const unpublishMutation = useMutation(
    trpc.minutesDocument.unpublish.mutationOptions({
      onMutate: beginWrite,
      onSuccess: () => {
        invalidateMinutes();
        toast.success("Minutes unpublished");
      },
      onError: (err) =>
        setActionError(refusalMessage(err, "take these minutes off the public portal")),
    }),
  );

  // ─── Handlers ──────────────────────────────────────────────────

  const handleSubmitForReview = useCallback(() => {
    submitForReviewMutation.mutate({ boardId, minutesDocumentId: docId });
  }, [submitForReviewMutation, boardId, docId]);

  const handleApprove = useCallback(() => {
    approveMutation.mutate({ minutesDocumentId: docId });
  }, [approveMutation, docId]);

  const handlePublish = useCallback(() => {
    publishMutation.mutate({ boardId, minutesDocumentId: docId });
  }, [publishMutation, boardId, docId]);

  const handleReturnForAmendments = useCallback(() => {
    if (!returnReason.trim()) return;
    returnForAmendmentsMutation.mutate({
      minutesDocumentId: docId,
      reason: returnReason.trim(),
    });
  }, [returnForAmendmentsMutation, returnReason, docId]);

  const handleUnpublish = useCallback(() => {
    unpublishMutation.mutate({ boardId, minutesDocumentId: docId });
  }, [unpublishMutation, boardId, docId]);

  const handleRegenerate = useCallback(async () => {
    setRegenerating(true);
    try {
      await apiJson(`/api/meetings/${meetingId}/minutes/regenerate`, { method: "POST" });

      toast.success("Minutes regeneration started");
      void queryClient.invalidateQueries(trpc.minutesDocument.pathFilter());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to regenerate minutes");
    } finally {
      setRegenerating(false);
    }
  }, [meetingId]);

  // ─── Error states ──────────────────────────────────────────────
  //
  // A failure AFTER mount — a refetch, a `staleTime` expiry, or (for the
  // minutes document, which the loader deliberately does not prime) the very
  // first fetch. The loader covers the before-mount meeting case through
  // `RouteErrorBoundary`; conventions item 12 requires both.

  if (isMeetingError) {
    const notFound = isTRPCClientError(meetingError) && meetingError.data?.code === "NOT_FOUND";
    return (
      <div className="flex items-center justify-center p-12" role="alert" aria-live="assertive">
        <div className="mx-auto max-w-md rounded-lg border bg-card p-6 text-center text-card-foreground shadow-sm">
          <AlertTriangle className="mx-auto h-6 w-6 text-destructive" aria-hidden="true" />
          <p className="mt-3 text-sm font-medium">
            {notFound
              ? "This meeting could not be found."
              : "Something went wrong loading this meeting."}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {notFound
              ? "It may have been deleted, or it belongs to another town."
              : "Try reloading the page. If the problem continues, contact support."}
          </p>
          <Link to="/meetings" className="mt-4 inline-block text-sm text-primary hover:underline">
            Back to Meetings
          </Link>
        </div>
      </div>
    );
  }

  if (isMinutesError) {
    // Rule 9 refused this caller the document's CONTENT. Same card the
    // `canView` gate renders, because it is the same answer.
    const forbidden = isTRPCClientError(minutesError) && minutesError.data?.code === "FORBIDDEN";
    if (forbidden) return <AccessDeniedCard />;
    return (
      <div className="flex items-center justify-center p-12" role="alert" aria-live="assertive">
        <div className="mx-auto max-w-md rounded-lg border bg-card p-6 text-center text-card-foreground shadow-sm">
          <AlertTriangle className="mx-auto h-6 w-6 text-destructive" aria-hidden="true" />
          <p className="mt-3 text-sm font-medium">Something went wrong loading these minutes.</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Try reloading the page. If the problem continues, contact support.
          </p>
          <Link
            to={`/meetings/${meetingId}`}
            className="mt-4 inline-block text-sm text-primary hover:underline"
          >
            Back to Meeting
          </Link>
        </div>
      </div>
    );
  }

  // ─── Loading state ─────────────────────────────────────────────
  //
  // Both reads, not just the meeting: "no document yet" and "the document has
  // not arrived yet" are different answers and the empty state below claims
  // the first one.

  if (isMeetingLoading || !meeting || isMinutesPending) {
    return (
      <div className="flex items-center justify-center p-12">
        <p className="text-sm text-muted-foreground">Loading meeting data...</p>
      </div>
    );
  }

  // ─── Permission denied ─────────────────────────────────────────

  if (!canView) {
    return <AccessDeniedCard />;
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
  const approvedAt = minutesDoc.approved_at;
  const anyDialogOpen = submitDialogOpen || publishDialogOpen || returnDialogOpen;

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

      {/* A refused or failed write with no dialog of its own — `approve`,
          `unpublish`, and the editor's `saveDraft`. Suppressed while a dialog
          is open, because the dialog renders its own copy and everything out
          here is `aria-hidden` then. */}
      {actionError && !anyDialogOpen && (
        <p
          className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-2 text-sm text-destructive"
          role="alert"
        >
          {actionError}
        </p>
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
        {/* `unpublish` is R5 on the server, not the administrator gate this
            button used to carry — see `minutesDocument.unpublish`'s own doc
            comment for the argument (undoing the act a code governs is that
            code's). `isAdmin` stays as a second branch because
            `resolvePermission` short-circuits `admin` to true for every code,
            so dropping it would narrow the button below what the procedure
            admits. */}
        {status === "published" && (isAdmin || canPublish) && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleUnpublish()}
            disabled={unpublishMutation.isPending}
          >
            Unpublish
          </Button>
        )}
        {/* `has_pdf`, not `pdf_url` — defect 1 in this file's header. The href
            is the same one `routes/minutes.ts` computes for its own responses,
            and that route applies rule 9 on every fetch. */}
        {canExport && minutesDoc.has_pdf && (
          <Button variant="outline" size="sm" asChild>
            <a href={`/api/files/minutes/${docId}`} target="_blank" rel="noopener noreferrer">
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
          boardId={boardId}
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
              {actionError && (
                <span className="mt-2 block text-destructive" role="alert">
                  {actionError}
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            {/* Not `AlertDialogAction`: that closes the dialog on click, which
                would take the refusal above with it. */}
            <Button
              onClick={() => handleSubmitForReview()}
              disabled={submitForReviewMutation.isPending}
            >
              Submit for Review
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Publish Dialog */}
      <AlertDialog open={publishDialogOpen} onOpenChange={setPublishDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Publish to Portal</AlertDialogTitle>
            <AlertDialogDescription>
              Publish these approved minutes to the public portal? They will be publicly accessible
              to anyone, with no sign-in.
              {actionError && (
                <span className="mt-2 block text-destructive" role="alert">
                  {actionError}
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button onClick={() => handlePublish()} disabled={publishMutation.isPending}>
              Publish
            </Button>
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
            {actionError && (
              <p className="mt-2 text-sm text-destructive" role="alert">
                {actionError}
              </p>
            )}
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
              disabled={!returnReason.trim() || returnForAmendmentsMutation.isPending}
              onClick={() => handleReturnForAmendments()}
            >
              Return for Amendments
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Access Denied ───────────────────────────────────────────────

function AccessDeniedCard() {
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

// ─── Status Timeline ─────────────────────────────────────────────

function StatusTimeline({
  status,
  minutesDoc,
}: {
  status: MinutesStatus;
  minutesDoc: MinutesDetail;
}) {
  const statusOrder: MinutesStatus[] = ["draft", "review", "approved", "published"];
  const currentIdx = statusOrder.indexOf(status);

  return (
    <div className="flex items-center justify-between rounded-md border bg-muted/30 px-6 py-4">
      {TIMELINE_STEPS.map((step, idx) => {
        const isPast = idx <= currentIdx;
        const timestamp = minutesDoc[step.field];

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
