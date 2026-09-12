/**
 * Motion Capture Dialog — records motions during a live meeting.
 *
 * Supports:
 * - Main motions (with optional pre-fill from suggested_motion)
 * - Amendments (parent_motion_id links to original motion)
 * - Tabling motions (pre-filled motion_type and text)
 * - All Roberts Rules motion types
 *
 * Per advisory Q2: suggested motions pre-populate with a visual
 * warning banner that clears when the text is edited.
 */

import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { queryKeys } from "@/lib/queryKeys";
import { trpc, refusalMessage, type RouterInputs } from "@/lib/trpc";
import { AlertTriangle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

// ─── Types ──────────────────────────────────────────────────────────

interface MemberInfo {
  boardMemberId: string;
  personId: string;
  name: string;
  seatTitle?: string | null;
}

/**
 * The eight `motion_type` values `motion.insert` accepts, taken from the
 * procedure rather than restated — see `lib/trpc.ts`'s `RouterInputs`. The
 * `<select>` below is built from `MOTION_TYPE_OPTIONS`, which is now checked
 * against this union, so an option the server would refuse is a compile error
 * instead of a BAD_REQUEST during a live meeting.
 */
export type MotionType = RouterInputs["motion"]["insert"]["motionType"];

export type MotionDialogMode =
  | { type: "main"; suggestedMotion?: string | null }
  | { type: "amendment"; parentMotionId: string; parentMotionText: string }
  | { type: "table"; itemTitle: string }
  | { type: "untable"; itemTitle: string }
  | { type: "custom"; motionType: MotionType; prefillText?: string };

interface MotionCaptureDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: MotionDialogMode;
  meetingId: string;
  /**
   * The board this meeting belongs to — required by `motion.insert`, whose
   * guard (`requireBoardPermission("M3", boardIdFrom())`) runs BEFORE
   * `.input()` and so has nothing but the request body to authorize on. The
   * resolver re-derives the meeting's REAL board inside its own transaction
   * and refuses a mismatch. Conventions item 2 names this cost.
   */
  boardId: string;
  agendaItemId: string;
  presentMembers: MemberInfo[];
}

// ─── Motion Type Labels ─────────────────────────────────────────────

const MOTION_TYPE_OPTIONS: { value: MotionType; label: string }[] = [
  { value: "main", label: "Main Motion" },
  { value: "amendment", label: "Amendment" },
  { value: "substitute", label: "Substitute Motion" },
  { value: "table", label: "Motion to Table" },
  { value: "untable", label: "Motion to Untable" },
  { value: "postpone", label: "Motion to Postpone" },
  { value: "reconsider", label: "Motion to Reconsider" },
  { value: "adjourn", label: "Motion to Adjourn" },
];

// ─── Component ──────────────────────────────────────────────────────

export function MotionCaptureDialog({
  open,
  onOpenChange,
  mode,
  meetingId,
  boardId,
  agendaItemId,
  presentMembers,
}: MotionCaptureDialogProps) {
  const queryClient = useQueryClient();

  // ─── Derive initial values from mode ─────────────────────────
  const getInitialValues = () => {
    switch (mode.type) {
      case "main":
        return {
          text: mode.suggestedMotion ?? "",
          motionType: "main" as MotionType,
          parentMotionId: null as string | null,
          showSuggestedBanner: !!mode.suggestedMotion,
        };
      case "amendment":
        return {
          text: "",
          motionType: "amendment" as MotionType,
          parentMotionId: mode.parentMotionId,
          showSuggestedBanner: false,
        };
      case "table":
        return {
          text: `to table ${mode.itemTitle}`,
          motionType: "table" as MotionType,
          parentMotionId: null,
          showSuggestedBanner: false,
        };
      case "untable":
        return {
          text: `to untable ${mode.itemTitle}`,
          motionType: "untable" as MotionType,
          parentMotionId: null,
          showSuggestedBanner: false,
        };
      case "custom":
        return {
          text: mode.prefillText ?? "",
          motionType: mode.motionType,
          parentMotionId: null,
          showSuggestedBanner: false,
        };
    }
  };

  // ─── Form state ──────────────────────────────────────────────
  const [text, setText] = useState("");
  const [motionType, setMotionType] = useState<MotionType>("main");
  const [movedBy, setMovedBy] = useState("");
  const [secondedBy, setSecondedBy] = useState("");
  const [parentMotionId, setParentMotionId] = useState<string | null>(null);
  const [showSuggestedBanner, setShowSuggestedBanner] = useState(false);

  // Reset form when dialog opens / mode changes
  useEffect(() => {
    if (open) {
      const init = getInitialValues();
      setText(init.text);
      setMotionType(init.motionType);
      setParentMotionId(init.parentMotionId);
      setShowSuggestedBanner(init.showSuggestedBanner);
      setMovedBy("");
      setSecondedBy("");
      insertMotionMutation.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode]);

  // ─── Validation ──────────────────────────────────────────────
  const isProceduralType =
    motionType === "adjourn" || motionType === "table" || motionType === "untable";
  const textValid = text.trim().length >= 5;
  const movedByValid = !!movedBy;
  const secondedByValid = isProceduralType || !!secondedBy;
  const noSamePerson = !secondedBy || secondedBy !== movedBy;

  /**
   * Wave 5, Task 5 — `motion.insert` in place of the raw Supabase insert.
   *
   * `town_id`, `id` and `created_at` are no longer sent: the procedure takes
   * the town from the caller's own session and lets the columns' own defaults
   * (`gen_random_uuid()`, `now()`) supply the other two. The last of those is
   * load-bearing rather than tidy — `motion.created_at` is what the live screen
   * compares against `executive_session.exited_at` to decide which motions are
   * post-session actions, and a skewed browser clock silently mis-sorted it.
   *
   * The write was unauthorized before (`motion_tenant_isolation` is
   * tenancy-only), so FORBIDDEN is newly reachable and is rendered here, inside
   * the `DialogContent`. That placement is the rule, not a coincidence: Radix
   * marks everything outside an open dialog `aria-hidden`, and a refused insert
   * leaves this dialog open — a message beside the trigger would be invisible
   * for exactly the case it exists for (conventions item 2, wave 4 Task 3).
   */
  const insertMotionMutation = useMutation(
    trpc.motion.insert.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.motions.byMeeting(meetingId) });
        void queryClient.invalidateQueries({ queryKey: queryKeys.motions.byItem(agendaItemId) });
        // The live screen reads motions through `trpc.motion.byMeeting` as of
        // wave 5, Task 4; neither legacy key above reaches it.
        void queryClient.invalidateQueries(trpc.motion.pathFilter());
        toast.success("Motion recorded");
        onOpenChange(false);
      },
    }),
  );

  const canSubmit =
    textValid && movedByValid && secondedByValid && noSamePerson && !insertMotionMutation.isPending;

  // ─── Submit ──────────────────────────────────────────────────
  const handleSubmit = () => {
    if (!canSubmit) return;
    insertMotionMutation.mutate({
      boardId,
      meetingId,
      agendaItemId,
      motionText: text.trim(),
      motionType,
      movedBy,
      secondedBy: secondedBy || null,
      parentMotionId,
    });
  };

  // ─── Computed title ──────────────────────────────────────────
  const dialogTitle =
    mode.type === "amendment"
      ? "Record Amendment"
      : mode.type === "table"
        ? "Motion to Table"
        : mode.type === "untable"
          ? "Motion to Untable"
          : "Record Motion";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{dialogTitle}</DialogTitle>
          <DialogDescription>
            {mode.type === "amendment"
              ? "Record an amendment to the current motion."
              : "Record the motion as stated on the floor."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Suggested motion banner */}
          {showSuggestedBanner && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/30">
              <div className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400">
                <AlertTriangle className="h-3.5 w-3.5" />
                This motion was pre-filled from the agenda packet. Verify the language matches what
                was actually said before recording.
              </div>
            </div>
          )}

          {/* Amendment context */}
          {mode.type === "amendment" && (
            <div className="rounded-md border bg-muted/50 p-3">
              <p className="text-xs text-muted-foreground">Amending motion:</p>
              <p className="mt-1 text-sm italic">{mode.parentMotionText}</p>
            </div>
          )}

          {/* Motion text */}
          <div>
            <Label htmlFor="motion-text">Motion Text</Label>
            <textarea
              id="motion-text"
              className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="Enter the motion text..."
              rows={4}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                if (showSuggestedBanner) setShowSuggestedBanner(false);
              }}
              autoFocus
            />
            {text.trim().length > 0 && text.trim().length < 5 && (
              <p className="mt-1 text-xs text-destructive">
                Motion text must be at least 5 characters
              </p>
            )}
          </div>

          {/* Motion type (locked for amendments/tabling) */}
          {mode.type === "main" && (
            <div>
              <Label htmlFor="motion-type">Motion Type</Label>
              <select
                id="motion-type"
                className="mt-1 w-full rounded-md border bg-background px-3 py-1.5 text-sm"
                value={motionType}
                onChange={(e) => setMotionType(e.target.value as MotionType)}
              >
                {MOTION_TYPE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Moved by / Seconded by */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="moved-by">Moved by</Label>
              <select
                id="moved-by"
                className="mt-1 w-full rounded-md border bg-background px-3 py-1.5 text-sm"
                value={movedBy}
                onChange={(e) => setMovedBy(e.target.value)}
              >
                <option value="">Select member...</option>
                {presentMembers.map((m) => (
                  <option key={m.boardMemberId} value={m.boardMemberId}>
                    {m.name}
                    {m.seatTitle ? ` (${m.seatTitle})` : ""}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="seconded-by">
                Seconded by{isProceduralType ? " (optional)" : ""}
              </Label>
              <select
                id="seconded-by"
                className="mt-1 w-full rounded-md border bg-background px-3 py-1.5 text-sm"
                value={secondedBy}
                onChange={(e) => setSecondedBy(e.target.value)}
              >
                <option value="">
                  {isProceduralType ? "None (no second required)" : "Select member..."}
                </option>
                {presentMembers
                  .filter((m) => m.boardMemberId !== movedBy)
                  .map((m) => (
                    <option key={m.boardMemberId} value={m.boardMemberId}>
                      {m.name}
                      {m.seatTitle ? ` (${m.seatTitle})` : ""}
                    </option>
                  ))}
              </select>
              {secondedBy && secondedBy === movedBy && (
                <p className="mt-1 text-xs text-destructive">
                  Seconder must be different from mover
                </p>
              )}
            </div>
          </div>

          {insertMotionMutation.error && (
            <p className="text-sm text-destructive" role="alert">
              {refusalMessage(insertMotionMutation.error, "record a motion")}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => handleSubmit()} disabled={!canSubmit}>
            {insertMotionMutation.isPending ? "Recording..." : "Record Motion"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
