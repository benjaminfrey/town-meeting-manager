/**
 * AddBoardDialog — dialog for creating a new board.
 *
 * Uses useWizardForm + Zod for validation. Writes via `trpc.board.insert`
 * (wave 2, Task 2 — previously a raw Supabase insert; see that procedure's
 * own doc comment for exactly which fields it hardcodes or omits versus what
 * this dialog used to send directly, e.g. `board_type`/`district_based`/
 * `staggered_terms`/`is_governing_board` all stay at their DB defaults, and
 * `officer_election_method` is hardcoded server-side to `'vote_of_board'`,
 * matching what this dialog always sent). Navigates to the new board's
 * detail page on success.
 */

import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { z } from "zod";
import { Loader2 } from "lucide-react";
import { calculateQuorum } from "@town-meeting/shared";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useWizardForm } from "@/hooks/useWizardForm";
import { FORMALITY_LABELS, MINUTES_STYLE_LABELS } from "./board-labels";

// ─── Schema ──────────────────────────────────────────────────────────

const AddBoardSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters").max(100),
  elected_or_appointed: z.enum(["elected", "appointed"]),
  member_count: z.number().int().min(0, "Must be 0-25").max(25),
  election_method: z.enum(["at_large", "role_titled"]),
  meeting_formality_override: z.string(),
  minutes_style_override: z.string(),
  quorum_type: z.enum(["simple_majority", "two_thirds", "three_quarters", "fixed_number"]),
  quorum_value: z.number().int().min(1).max(25).nullable(),
  motion_display_format: z.enum(["block_format", "inline_narrative"]),
});

type AddBoardData = z.infer<typeof AddBoardSchema>;

const INITIAL: AddBoardData = {
  name: "",
  elected_or_appointed: "elected",
  member_count: 5,
  election_method: "at_large",
  meeting_formality_override: "",
  minutes_style_override: "",
  quorum_type: "simple_majority",
  quorum_value: null,
  motion_display_format: "inline_narrative",
};

// ─── Component ───────────────────────────────────────────────────────

interface AddBoardDialogProps {
  townId: string;
  town: RouterOutputs["town"]["detail"] | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddBoardDialog({ townId, town, open, onOpenChange }: AddBoardDialogProps) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [seatTitles, setSeatTitles] = useState<string[]>([]);

  const { values, errors, isValid, setValue, handleBlur, validate } = useWizardForm(
    AddBoardSchema,
    INITIAL,
  );

  // Town defaults for display
  const townFormality = String(town?.meeting_formality ?? "informal");
  const townMinutesStyle = String(town?.minutes_style ?? "summary");

  // Quorum display
  const quorumRequired = useMemo(
    () =>
      calculateQuorum(
        values.member_count,
        values.quorum_type as "simple_majority" | "two_thirds" | "three_quarters" | "fixed_number",
        values.quorum_value,
      ),
    [values.member_count, values.quorum_type, values.quorum_value],
  );

  // Sync seat titles array when member count or election method changes
  const effectiveSeatTitles = useMemo(() => {
    if (values.election_method !== "role_titled") return [];
    const count = values.member_count;
    const titles = [...seatTitles];
    while (titles.length < count) titles.push("");
    return titles.slice(0, count);
  }, [values.election_method, values.member_count, seatTitles]);

  const insertMutation = useMutation(
    trpc.board.insert.mutationOptions({
      onSuccess: ({ id }) => {
        // `/boards` (`routes/boards.tsx`) reads `board.list` now (wave 2,
        // Task 2), not this legacy key — but `CommandPalette`,
        // `PermissionOverrideView`, `StaffAccountFlow`, `MemberTransitionDialog`
        // and `routes/{home,meetings}.tsx` still do, so this invalidation
        // stays during the transition (conventions item 7).
        void queryClient.invalidateQueries({ queryKey: queryKeys.boards.byTown(townId) });
        // `ProgressChecklist`'s `totalSeats` and notice-template-count rows,
        // and now `/boards` itself, read `trpc.board.list`/`listActive` —
        // this is the invalidation that reaches both. Without it a new
        // board's seats and "N of M boards configured" denominator stayed
        // stale for up to the 60s `staleTime` — see `AddBoardDialog.test.tsx`
        // for the pin (conventions item 7/8: found by the review round after
        // wave 1 Task 5, the third time this exact shape of gap shipped in
        // that wave).
        void queryClient.invalidateQueries(trpc.board.pathFilter());
        onOpenChange(false);
        void navigate(`/boards/${id}`);
      },
    }),
  );

  const isSaving = insertMutation.isPending;

  const handleSave = useCallback(async () => {
    const data = validate();
    if (!data) return;
    // `board.insert`'s schema wants `null`, not `""`, for "use the town
    // default" — the same coercion the pre-migration Supabase insert did
    // inline. `seatTitles`/`effectiveSeatTitles` are collected above but were
    // never actually sent by the mutation this replaces either (checked
    // against the Supabase insert payload this dialog used to send) — left
    // as-is, not a gap this task was asked to close.
    await insertMutation.mutateAsync({
      ...data,
      meeting_formality_override: (data.meeting_formality_override || null) as
        | "informal"
        | "semi_formal"
        | "formal"
        | null,
      minutes_style_override: (data.minutes_style_override || null) as
        | "action"
        | "summary"
        | "narrative"
        | null,
    });
  }, [validate, insertMutation]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Board</DialogTitle>
          <DialogDescription>Create a new board or committee for your town.</DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Board name */}
          <div className="space-y-1.5">
            <Label>Board name</Label>
            <Input
              value={values.name}
              onChange={(e) => setValue("name", e.target.value)}
              onBlur={() => handleBlur("name")}
              placeholder="e.g. Planning Board"
            />
            {errors.name && <p className="text-xs text-destructive">{errors.name}</p>}
          </div>

          {/* Board type */}
          <div className="space-y-1.5">
            <Label>Board type</Label>
            <RadioGroup
              value={values.elected_or_appointed}
              onValueChange={(val) =>
                setValue("elected_or_appointed", val as "elected" | "appointed")
              }
              className="flex gap-4"
            >
              <label className="flex items-center gap-2 cursor-pointer">
                <RadioGroupItem value="elected" />
                <span className="text-sm">Elected</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <RadioGroupItem value="appointed" />
                <span className="text-sm">Appointed</span>
              </label>
            </RadioGroup>
          </div>

          {/* Member count */}
          <div className="space-y-1.5">
            <Label>Member count</Label>
            <Input
              type="number"
              min={0}
              max={25}
              value={values.member_count}
              onChange={(e) => setValue("member_count", parseInt(e.target.value) || 0)}
              onBlur={() => handleBlur("member_count")}
            />
            {values.member_count === 0 && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                You can add members later. A board must have at least 3 members to hold a meeting.
              </p>
            )}
            {errors.member_count && (
              <p className="text-xs text-destructive">{errors.member_count}</p>
            )}
          </div>

          {/* Election method */}
          <div className="space-y-1.5">
            <Label>Election method</Label>
            <RadioGroup
              value={values.election_method}
              onValueChange={(val) =>
                setValue("election_method", val as "at_large" | "role_titled")
              }
              className="flex gap-4"
            >
              <label className="flex items-center gap-2 cursor-pointer">
                <RadioGroupItem value="at_large" />
                <span className="text-sm">At-large</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <RadioGroupItem value="role_titled" />
                <span className="text-sm">Role-titled</span>
              </label>
            </RadioGroup>
          </div>

          {/* Seat titles (conditional) */}
          {values.election_method === "role_titled" && values.member_count > 0 && (
            <div className="space-y-2">
              <Label>Seat titles</Label>
              {effectiveSeatTitles.map((title, i) => (
                <Input
                  key={i}
                  value={title}
                  onChange={(e) => {
                    const updated = [...effectiveSeatTitles];
                    updated[i] = e.target.value;
                    setSeatTitles(updated);
                  }}
                  placeholder={`Seat ${i + 1}`}
                />
              ))}
            </div>
          )}

          {/* Meeting formality override */}
          <div className="space-y-1.5">
            <Label>Meeting formality</Label>
            <Select
              value={values.meeting_formality_override || "__default__"}
              onValueChange={(val) =>
                setValue("meeting_formality_override", val === "__default__" ? "" : val)
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select formality" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__default__">
                  Use town default ({FORMALITY_LABELS[townFormality] ?? townFormality})
                </SelectItem>
                <SelectItem value="informal">Open (informal)</SelectItem>
                <SelectItem value="semi_formal">Structured (semi-formal)</SelectItem>
                <SelectItem value="formal">Formal (Robert's Rules)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Minutes style override */}
          <div className="space-y-1.5">
            <Label>Minutes style</Label>
            <Select
              value={values.minutes_style_override || "__default__"}
              onValueChange={(val) =>
                setValue("minutes_style_override", val === "__default__" ? "" : val)
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select minutes style" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__default__">
                  Use town default ({MINUTES_STYLE_LABELS[townMinutesStyle] ?? townMinutesStyle})
                </SelectItem>
                <SelectItem value="action">Action minutes</SelectItem>
                <SelectItem value="summary">Summary minutes</SelectItem>
                <SelectItem value="narrative">Narrative minutes</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Quorum type */}
          <div className="space-y-2">
            <Label>Quorum requirement</Label>
            <RadioGroup
              value={values.quorum_type}
              onValueChange={(val) => {
                setValue("quorum_type", val as AddBoardData["quorum_type"]);
                if (val !== "fixed_number") {
                  setValue("quorum_value", null);
                } else if (values.quorum_value === null) {
                  setValue("quorum_value", Math.floor(values.member_count / 2) + 1 || 1);
                }
              }}
              className="space-y-2"
            >
              <label className="flex items-center gap-2 cursor-pointer">
                <RadioGroupItem value="simple_majority" />
                <span className="text-sm">Simple majority (&gt;50%)</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <RadioGroupItem value="two_thirds" />
                <span className="text-sm">Two-thirds</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <RadioGroupItem value="three_quarters" />
                <span className="text-sm">Three-quarters</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <RadioGroupItem value="fixed_number" />
                <span className="text-sm">Fixed number</span>
              </label>
            </RadioGroup>
            {values.quorum_type === "fixed_number" && (
              <Input
                type="number"
                min={1}
                max={values.member_count || 25}
                value={values.quorum_value ?? ""}
                onChange={(e) => setValue("quorum_value", parseInt(e.target.value) || 1)}
                className="mt-2 w-24"
              />
            )}
            {values.member_count > 0 && (
              <p className="text-xs text-muted-foreground">
                Quorum: {quorumRequired} of {values.member_count} members required
              </p>
            )}
          </div>

          {/* Motion display format */}
          <div className="space-y-2">
            <Label>Motion display format</Label>
            <RadioGroup
              value={values.motion_display_format}
              onValueChange={(val) =>
                setValue("motion_display_format", val as AddBoardData["motion_display_format"])
              }
              className="space-y-2"
            >
              <label className="flex items-start gap-2 rounded-md border p-3 cursor-pointer hover:bg-muted/50 has-[:checked]:border-primary has-[:checked]:bg-primary/5">
                <RadioGroupItem value="block_format" className="mt-0.5" />
                <div>
                  <div className="text-sm font-medium">Block format</div>
                  <div className="text-xs text-muted-foreground">
                    Motions displayed as structured blocks with labeled fields (Motion, Moved by,
                    Second, Vote, Result)
                  </div>
                </div>
              </label>
              <label className="flex items-start gap-2 rounded-md border p-3 cursor-pointer hover:bg-muted/50 has-[:checked]:border-primary has-[:checked]:bg-primary/5">
                <RadioGroupItem value="inline_narrative" className="mt-0.5" />
                <div>
                  <div className="text-sm font-medium">Inline narrative</div>
                  <div className="text-xs text-muted-foreground">
                    Motions woven into the minutes narrative text
                  </div>
                </div>
              </label>
            </RadioGroup>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Cancel
          </Button>
          <Button onClick={() => void handleSave()} disabled={!isValid || isSaving}>
            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Create Board
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
