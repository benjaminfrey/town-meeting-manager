/**
 * Agenda item detail panel for the live meeting center area.
 *
 * Shows the full details of the currently active agenda item:
 * description, commentary, suggested motion, exhibits, operator notes.
 * Provides action buttons for completing/tabling items, recording motions,
 * and navigating between items.
 *
 * Integrates MotionPanel for motion workflow and MotionCaptureDialog
 * for recording new motions, amendments, and tabling motions.
 */

import { useCallback, useEffect, useState, useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useSupabase } from "@/hooks/useSupabase";
import { queryKeys } from "@/lib/queryKeys";
import {
  ChevronLeft,
  ChevronRight,
  Check,
  Pause,
  FileText,
  Gavel,
  AlertTriangle,
  Lock,
} from "lucide-react";
import { quorumAfterRecusal } from "@town-meeting/shared";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { GuestSpeakerEntry } from "./GuestSpeakerEntry";
import { MotionPanel } from "./MotionPanel";
import {
  MotionCaptureDialog,
  type MotionDialogMode,
} from "./MotionCaptureDialog";
import { RecusalDialog } from "./RecusalDialog";

// ─── Types ──────────────────────────────────────────────────────────

interface MemberInfo {
  boardMemberId: string;
  personId: string;
  name: string;
  seatTitle?: string | null;
}

interface Exhibit {
  id: string;
  title: string;
  fileName: string;
}

interface SubItem {
  id: string;
  title: string;
  sortOrder: number;
}

interface GuestSpeaker {
  id: string;
  name: string;
  address: string | null;
  topic: string | null;
  created_at: string;
}

interface MotionData {
  id: string;
  motionText: string;
  motionType: string;
  movedBy: string | null;
  secondedBy: string | null;
  status: string;
  parentMotionId: string | null;
  voteSummary: string | null;
}

interface VoteRecordData {
  id: string;
  motion_id: string;
  board_member_id: string;
  vote: string;
  recusal_reason: string | null;
}

interface AttendanceRecord {
  id: string;
  board_member_id: string | null;
  person_id: string;
  status: string;
}

interface BoardQuorumConfig {
  quorumType: string | null;
  quorumValue: number | null;
  memberCount: number;
}

interface CurrentItem {
  id: string;
  title: string;
  sectionTitle: string;
  sectionType: string;
  sectionRef: string;
  description: string | null;
  presenter: string | null;
  staffResource: string | null;
  background: string | null;
  recommendation: string | null;
  suggestedMotion: string | null;
  operatorNotes: string | null;
  estimatedDuration: number | null;
  status: string;
  exhibits: Exhibit[];
  subItems: SubItem[];
  speakers: GuestSpeaker[];
  motions: MotionData[];
}

interface AgendaItemDetailPanelProps {
  item: CurrentItem | null;
  meetingId: string;
  townId: string;
  allMembers: MemberInfo[];
  presentMembers: MemberInfo[];
  memberNameMap: Map<string, string>;
  attendanceRecords: AttendanceRecord[];
  votesByMotion: Map<string, VoteRecordData[]>;
  motionDisplayFormat: string | null;
  boardQuorumConfig: BoardQuorumConfig;
  onNavigatePrev: () => void;
  onNavigateNext: () => void;
  hasPrev: boolean;
  hasNext: boolean;
  readOnly?: boolean;
  /** External trigger: when set, opens the recusal dialog for this member */
  externalRecusalMember?: MemberInfo | null;
  /** Called after the external recusal trigger is consumed */
  onExternalRecusalConsumed?: () => void;
  /** Whether the board is currently in executive session */
  isInExecSession?: boolean;
  /** Opens the ExecutiveSessionDialog (citation picker) */
  onEnterExecSession?: () => void;
}

// ─── Component ──────────────────────────────────────────────────────

export function AgendaItemDetailPanel({
  item,
  meetingId,
  townId,
  allMembers,
  presentMembers,
  memberNameMap,
  attendanceRecords,
  votesByMotion,
  motionDisplayFormat,
  boardQuorumConfig,
  onNavigatePrev,
  onNavigateNext,
  hasPrev,
  hasNext,
  readOnly,
  externalRecusalMember,
  onExternalRecusalConsumed,
  isInExecSession,
  onEnterExecSession,
}: AgendaItemDetailPanelProps) {
  const supabase = useSupabase();
  const queryClient = useQueryClient();
  const [notesValue, setNotesValue] = useState(item?.operatorNotes ?? "");

  // ─── Motion dialog state ──────────────────────────────────────
  const [motionDialogOpen, setMotionDialogOpen] = useState(false);
  const [motionDialogMode, setMotionDialogMode] = useState<MotionDialogMode>({
    type: "main",
  });

  // ─── Recusal state ────────────────────────────────────────────
  const [recusalDialogOpen, setRecusalDialogOpen] = useState(false);
  const [recusalMember, setRecusalMember] = useState<MemberInfo | null>(null);
  // Track per-item recusals (boardMemberId → reason)
  const [itemRecusals, setItemRecusals] = useState<Map<string, string>>(
    new Map(),
  );

  // Reset state when item changes
  const itemId = item?.id;
  const [trackedItemId, setTrackedItemId] = useState(itemId);
  if (itemId !== trackedItemId) {
    setTrackedItemId(itemId);
    setNotesValue(item?.operatorNotes ?? "");
    setMotionDialogOpen(false);
    setRecusalDialogOpen(false);
    setItemRecusals(new Map());
  }

  // ─── Quorum impact check ──────────────────────────────────────
  const presentCount = presentMembers.length;
  const recusalCount = itemRecusals.size;
  const quorumCheck = useMemo(() => {
    if (recusalCount === 0) return null;
    return quorumAfterRecusal(
      presentCount,
      recusalCount,
      boardQuorumConfig.memberCount,
      boardQuorumConfig.quorumType as
        | "simple_majority"
        | "two_thirds"
        | "three_quarters"
        | "fixed_number"
        | null,
      boardQuorumConfig.quorumValue,
    );
  }, [presentCount, recusalCount, boardQuorumConfig]);

  const quorumBlocked = quorumCheck !== null && !quorumCheck.hasQuorum;

  // ─── Handlers ─────────────────────────────────────────────────

  const saveNotesMutation = useMutation({
    mutationFn: async ({ itemId, notes }: { itemId: string; notes: string | null }) => {
      const { error } = await supabase
        .from("agenda_item")
        .update({ operator_notes: notes, updated_at: new Date().toISOString() })
        .eq("id", itemId);
      if (error) throw error;
    },
    onSuccess: (_data, { itemId }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.agendaItems.detail(itemId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.agendaItems.byMeeting(meetingId) });
    },
  });

  const saveNotes = useCallback(() => {
    if (!item || readOnly) return;
    saveNotesMutation.mutate({ itemId: item.id, notes: notesValue.trim() || null });
  }, [item, notesValue, saveNotesMutation, readOnly]);

  const markCompleteMutation = useMutation({
    mutationFn: async (itemId: string) => {
      const { error } = await supabase
        .from("agenda_item")
        .update({ status: "completed", updated_at: new Date().toISOString() })
        .eq("id", itemId);
      if (error) throw error;
    },
    onSuccess: (_data, itemId) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.agendaItems.detail(itemId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.agendaItems.byMeeting(meetingId) });
      onNavigateNext();
    },
  });

  const markComplete = () => {
    if (!item || readOnly) return;
    markCompleteMutation.mutate(item.id);
  };

  const openMotionDialog = (mode: MotionDialogMode) => {
    setMotionDialogMode(mode);
    setMotionDialogOpen(true);
  };

  const openRecusalDialog = (member: MemberInfo) => {
    setRecusalMember(member);
    setRecusalDialogOpen(true);
  };

  const handleRecusalRecorded = (
    boardMemberId: string,
    reason: string,
    _scope: "item" | "remaining",
  ) => {
    setItemRecusals((prev) => {
      const next = new Map(prev);
      next.set(boardMemberId, reason);
      return next;
    });
  };

  // ─── External recusal trigger (from AttendancePanel) ────────
  useEffect(() => {
    if (externalRecusalMember && item) {
      openRecusalDialog(externalRecusalMember);
      onExternalRecusalConsumed?.();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalRecusalMember]);

  // Find active motion that's in_vote status (for recusal recording)
  const activeVotingMotionId =
    item?.motions.find((m) => m.status === "in_vote")?.id ?? null;

  // ─── Empty state ──────────────────────────────────────────────

  if (!item) {
    return (
      <div className="flex flex-1 items-center justify-center text-muted-foreground">
        <p>Select an agenda item to view details</p>
      </div>
    );
  }

  // Executive session: simplified locked view
  if (isInExecSession) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <Lock className="mb-4 h-12 w-12 text-red-400" />
        <h2 className="text-lg font-semibold text-red-700 dark:text-red-300">
          Executive Session In Progress
        </h2>
        <p className="mt-2 max-w-sm text-sm text-muted-foreground">
          Public recording is paused during executive session. No agenda item
          content or motions are displayed. Use the banner above to return to
          public session.
        </p>
      </div>
    );
  }

  const isPublicComment =
    item.sectionType === "public_input" ||
    item.sectionType === "public_hearing";

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Quorum alert banner */}
      {quorumBlocked && (
        <div className="border-b border-red-200 bg-red-50 px-6 py-3 dark:border-red-900 dark:bg-red-950/30">
          <div className="flex items-center gap-2 text-sm font-medium text-red-700 dark:text-red-400">
            <AlertTriangle className="h-4 w-4" />
            QUORUM ALERT: Recusals drop participating members to{" "}
            {quorumCheck!.eligibleVoters}. Quorum requires{" "}
            {quorumCheck!.adjustedQuorum}. This vote cannot proceed.
          </div>
        </div>
      )}

      {/* Header */}
      <div className="border-b px-6 py-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Badge variant="outline" className="text-xs">
            {item.sectionType.replace(/_/g, " ")}
          </Badge>
          <span>{item.sectionTitle}</span>
        </div>
        <h2 className="mt-1 text-xl font-bold">
          {item.sectionRef} {item.title}
        </h2>
        {item.presenter && (
          <p className="mt-1 text-sm text-muted-foreground">
            Presenter: {item.presenter}
          </p>
        )}
      </div>

      {/* Content — scrollable */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        {/* Description */}
        {item.description && (
          <div>
            <h3 className="mb-1 text-sm font-semibold text-muted-foreground">
              Description
            </h3>
            <p className="text-sm">{item.description}</p>
          </div>
        )}

        {/* Staff resource */}
        {item.staffResource && (
          <div>
            <h3 className="mb-1 text-sm font-semibold text-muted-foreground">
              Staff Resource
            </h3>
            <p className="text-sm">{item.staffResource}</p>
          </div>
        )}

        {/* Background */}
        {item.background && (
          <div>
            <h3 className="mb-1 text-sm font-semibold text-muted-foreground">
              Background
            </h3>
            <p className="whitespace-pre-wrap text-sm">{item.background}</p>
          </div>
        )}

        {/* Recommendation */}
        {item.recommendation && (
          <div>
            <h3 className="mb-1 text-sm font-semibold text-muted-foreground">
              Recommendation
            </h3>
            <p className="text-sm">{item.recommendation}</p>
          </div>
        )}

        {/* Suggested motion */}
        {item.suggestedMotion && (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/30">
            <div className="mb-1 flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400">
              <AlertTriangle className="h-3.5 w-3.5" />
              Pre-filled from agenda packet — verify before recording
            </div>
            <p className="text-sm italic">{item.suggestedMotion}</p>
          </div>
        )}

        {/* Sub-items */}
        {item.subItems.length > 0 && (
          <div>
            <h3 className="mb-1 text-sm font-semibold text-muted-foreground">
              Sub-Items
            </h3>
            <ul className="space-y-1 text-sm">
              {item.subItems.map((sub, i) => (
                <li key={sub.id} className="flex gap-2">
                  <span className="text-muted-foreground">
                    {toRoman(i + 1)}.
                  </span>
                  <span>{sub.title}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Exhibits */}
        {item.exhibits.length > 0 && (
          <div>
            <h3 className="mb-1 text-sm font-semibold text-muted-foreground">
              Exhibits
            </h3>
            <ul className="space-y-1">
              {item.exhibits.map((ex) => (
                <li
                  key={ex.id}
                  className="flex items-center gap-2 text-sm"
                >
                  <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                  <span>{ex.title || ex.fileName}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Motion Panel */}
        <MotionPanel
          motions={item.motions}
          votesByMotion={votesByMotion}
          memberNameMap={memberNameMap}
          motionDisplayFormat={motionDisplayFormat}
          meetingId={meetingId}
          townId={townId}
          agendaItemId={item.id}
          allMembers={allMembers}
          presentMembers={presentMembers}
          attendanceRecords={attendanceRecords}
          boardQuorumConfig={boardQuorumConfig}
          quorumBlocked={quorumBlocked}
          readOnly={readOnly}
          onAmend={(motionId, motionText) =>
            openMotionDialog({
              type: "amendment",
              parentMotionId: motionId,
              parentMotionText: motionText,
            })
          }
        />

        {/* Guest speakers (public comment sections) */}
        {isPublicComment && (
          <GuestSpeakerEntry
            meetingId={meetingId}
            agendaItemId={item.id}
            townId={townId}
            speakers={item.speakers}
            readOnly={readOnly}
          />
        )}

        {/* Operator notes */}
        {!readOnly && (
          <div>
            <h3 className="mb-1 text-sm font-semibold text-muted-foreground">
              Operator Notes
            </h3>
            <textarea
              className="w-full rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="Notes for this item..."
              rows={3}
              value={notesValue}
              onChange={(e) => setNotesValue(e.target.value)}
              onBlur={() => saveNotes()}
            />
          </div>
        )}
        {readOnly && item.operatorNotes && (
          <div>
            <h3 className="mb-1 text-sm font-semibold text-muted-foreground">
              Operator Notes
            </h3>
            <p className="whitespace-pre-wrap text-sm">{item.operatorNotes}</p>
          </div>
        )}
      </div>

      {/* Action bar */}
      <div className="flex items-center justify-between border-t px-6 py-3">
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onNavigatePrev}
            disabled={!hasPrev}
          >
            <ChevronLeft className="mr-1 h-4 w-4" /> Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onNavigateNext}
            disabled={!hasNext}
          >
            Next <ChevronRight className="ml-1 h-4 w-4" />
          </Button>
        </div>
        {!readOnly && (
          <div className="flex gap-2">
            {onEnterExecSession && item.sectionType === "executive_session" && (
              <Button
                variant="outline"
                size="sm"
                className="border-red-200 text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-400"
                onClick={onEnterExecSession}
              >
                <Lock className="mr-1 h-4 w-4" /> Enter Executive Session
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                openMotionDialog({
                  type: "main",
                  suggestedMotion: item.suggestedMotion,
                })
              }
            >
              <Gavel className="mr-1 h-4 w-4" /> Record Motion
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                openMotionDialog({
                  type: "table",
                  itemTitle: item.title,
                })
              }
            >
              <Pause className="mr-1 h-4 w-4" /> Table
            </Button>
            <Button size="sm" onClick={() => markComplete()}>
              <Check className="mr-1 h-4 w-4" /> Complete
            </Button>
          </div>
        )}
      </div>

      {/* Motion Capture Dialog */}
      {item && (
        <MotionCaptureDialog
          open={motionDialogOpen}
          onOpenChange={setMotionDialogOpen}
          mode={motionDialogMode}
          meetingId={meetingId}
          townId={townId}
          agendaItemId={item.id}
          presentMembers={presentMembers}
        />
      )}

      {/* Recusal Dialog */}
      {recusalMember && item && (
        <RecusalDialog
          open={recusalDialogOpen}
          onOpenChange={setRecusalDialogOpen}
          memberName={recusalMember.name}
          boardMemberId={recusalMember.boardMemberId}
          meetingId={meetingId}
          townId={townId}
          agendaItemId={item.id}
          activeMotionId={activeVotingMotionId}
          onRecusalRecorded={handleRecusalRecorded}
        />
      )}
    </div>
  );
}

function toRoman(n: number): string {
  const numerals = [
    "i",
    "ii",
    "iii",
    "iv",
    "v",
    "vi",
    "vii",
    "viii",
    "ix",
    "x",
  ];
  return numerals[n - 1] ?? String(n);
}
