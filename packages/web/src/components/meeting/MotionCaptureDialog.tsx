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
import { usePowerSync } from "@powersync/react";
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

export type MotionDialogMode =
  | { type: "main"; suggestedMotion?: string | null }
  | { type: "amendment"; parentMotionId: string; parentMotionText: string }
  | { type: "table"; itemTitle: string }
  | { type: "untable"; itemTitle: string }
  | { type: "custom"; motionType: string; prefillText?: string };

interface MotionCaptureDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: MotionDialogMode;
  meetingId: string;
  townId: string;
  agendaItemId: string;
  presentMembers: MemberInfo[];
}

// ─── Motion Type Labels ─────────────────────────────────────────────

const MOTION_TYPE_OPTIONS: { value: string; label: string }[] = [
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
  townId,
  agendaItemId,
  presentMembers,
}: MotionCaptureDialogProps) {
  const powerSync = usePowerSync();

  // ─── Derive initial values from mode ─────────────────────────
  const getInitialValues = () => {
    switch (mode.type) {
      case "main":
        return {
          text: mode.suggestedMotion ?? "",
          motionType: "main",
          parentMotionId: null as string | null,
          showSuggestedBanner: !!mode.suggestedMotion,
        };
      case "amendment":
        return {
          text: "",
          motionType: "amendment",
          parentMotionId: mode.parentMotionId,
          showSuggestedBanner: false,
        };
      case "table":
        return {
          text: `to table ${mode.itemTitle}`,
          motionType: "table",
          parentMotionId: null,
          showSuggestedBanner: false,
        };
      case "untable":
        return {
          text: `to untable ${mode.itemTitle}`,
          motionType: "untable",
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
  const [motionType, setMotionType] = useState("main");
  const [movedBy, setMovedBy] = useState("");
  const [secondedBy, setSecondedBy] = useState("");
  const [parentMotionId, setParentMotionId] = useState<string | null>(null);
  const [showSuggestedBanner, setShowSuggestedBanner] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      setSaving(false);
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode]);

  // ─── Validation ──────────────────────────────────────────────
  const isProceduralType = motionType === "adjourn" || motionType === "table" || motionType === "untable";
  const textValid = text.trim().length >= 5;
  const movedByValid = !!movedBy;
  const secondedByValid = isProceduralType || !!secondedBy;
  const noSamePerson = !secondedBy || secondedBy !== movedBy;
  const canSubmit = textValid && movedByValid && secondedByValid && noSamePerson && !saving;

  // ─── Submit ──────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    setError(null);

    try {
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      await powerSync.execute(
        `INSERT INTO motions (id, agenda_item_id, meeting_id, town_id, motion_text, motion_type, moved_by, seconded_by, status, parent_motion_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'seconded', ?, ?)`,
        [
          id,
          agendaItemId,
          meetingId,
          townId,
          text.trim(),
          motionType,
          movedBy,
          secondedBy || null,
          parentMotionId,
          now,
        ],
      );
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to record motion");
    } finally {
      setSaving(false);
    }
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
                This motion was pre-filled from the agenda packet. Verify the
                language matches what was actually said before recording.
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
                onChange={(e) => setMotionType(e.target.value)}
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

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void handleSubmit()} disabled={!canSubmit}>
            {saving ? "Recording..." : "Record Motion"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
