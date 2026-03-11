/**
 * Agenda item detail panel for the live meeting center area.
 *
 * Shows the full details of the currently active agenda item:
 * description, commentary, suggested motion, exhibits, operator notes.
 * Provides action buttons for completing/tabling items, recording motions,
 * and navigating between items.
 */

import { useCallback, useState } from "react";
import { usePowerSync } from "@powersync/react";
import {
  ChevronLeft,
  ChevronRight,
  Check,
  Pause,
  FileText,
  Gavel,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { GuestSpeakerEntry } from "./GuestSpeakerEntry";

interface MemberInfo {
  boardMemberId: string;
  personId: string;
  name: string;
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

interface Motion {
  id: string;
  motionText: string;
  motionType: string;
  movedBy: string | null;
  secondedBy: string | null;
  status: string;
}

interface CurrentItem {
  id: string;
  title: string;
  sectionTitle: string;
  sectionType: string;
  sectionRef: string; // e.g. "6A"
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
  motions: Motion[];
}

interface AgendaItemDetailPanelProps {
  item: CurrentItem | null;
  meetingId: string;
  townId: string;
  presentMembers: MemberInfo[];
  memberNameMap: Map<string, string>;
  onNavigatePrev: () => void;
  onNavigateNext: () => void;
  hasPrev: boolean;
  hasNext: boolean;
  readOnly?: boolean;
}

export function AgendaItemDetailPanel({
  item,
  meetingId,
  townId,
  presentMembers,
  memberNameMap,
  onNavigatePrev,
  onNavigateNext,
  hasPrev,
  hasNext,
  readOnly,
}: AgendaItemDetailPanelProps) {
  const powerSync = usePowerSync();
  const [notesValue, setNotesValue] = useState(item?.operatorNotes ?? "");
  const [showMotionForm, setShowMotionForm] = useState(false);

  // Reset notes when item changes
  const itemId = item?.id;
  const [trackedItemId, setTrackedItemId] = useState(itemId);
  if (itemId !== trackedItemId) {
    setTrackedItemId(itemId);
    setNotesValue(item?.operatorNotes ?? "");
    setShowMotionForm(false);
  }

  const saveNotes = useCallback(async () => {
    if (!item || readOnly) return;
    const now = new Date().toISOString();
    await powerSync.execute(
      "UPDATE agenda_items SET operator_notes = ?, updated_at = ? WHERE id = ?",
      [notesValue.trim() || null, now, item.id],
    );
  }, [item, notesValue, powerSync, readOnly]);

  const markComplete = async () => {
    if (!item || readOnly) return;
    const now = new Date().toISOString();
    await powerSync.execute(
      "UPDATE agenda_items SET status = 'completed', updated_at = ? WHERE id = ?",
      [now, item.id],
    );
    onNavigateNext();
  };

  const tableItem = async () => {
    if (!item || readOnly) return;
    const now = new Date().toISOString();
    await powerSync.execute(
      "UPDATE agenda_items SET status = 'tabled', updated_at = ? WHERE id = ?",
      [now, item.id],
    );
    onNavigateNext();
  };

  if (!item) {
    return (
      <div className="flex flex-1 items-center justify-center text-muted-foreground">
        <p>Select an agenda item to view details</p>
      </div>
    );
  }

  const isPublicComment = item.sectionType === "public_input" || item.sectionType === "public_hearing";

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="border-b px-6 py-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Badge variant="outline" className="text-xs">{item.sectionType.replace(/_/g, " ")}</Badge>
          <span>{item.sectionTitle}</span>
        </div>
        <h2 className="mt-1 text-xl font-bold">
          {item.sectionRef} {item.title}
        </h2>
        {item.presenter && (
          <p className="mt-1 text-sm text-muted-foreground">Presenter: {item.presenter}</p>
        )}
      </div>

      {/* Content — scrollable */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        {/* Description */}
        {item.description && (
          <div>
            <h3 className="mb-1 text-sm font-semibold text-muted-foreground">Description</h3>
            <p className="text-sm">{item.description}</p>
          </div>
        )}

        {/* Staff resource */}
        {item.staffResource && (
          <div>
            <h3 className="mb-1 text-sm font-semibold text-muted-foreground">Staff Resource</h3>
            <p className="text-sm">{item.staffResource}</p>
          </div>
        )}

        {/* Background */}
        {item.background && (
          <div>
            <h3 className="mb-1 text-sm font-semibold text-muted-foreground">Background</h3>
            <p className="whitespace-pre-wrap text-sm">{item.background}</p>
          </div>
        )}

        {/* Recommendation */}
        {item.recommendation && (
          <div>
            <h3 className="mb-1 text-sm font-semibold text-muted-foreground">Recommendation</h3>
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
            <h3 className="mb-1 text-sm font-semibold text-muted-foreground">Sub-Items</h3>
            <ul className="space-y-1 text-sm">
              {item.subItems.map((sub, i) => (
                <li key={sub.id} className="flex gap-2">
                  <span className="text-muted-foreground">{toRoman(i + 1)}.</span>
                  <span>{sub.title}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Exhibits */}
        {item.exhibits.length > 0 && (
          <div>
            <h3 className="mb-1 text-sm font-semibold text-muted-foreground">Exhibits</h3>
            <ul className="space-y-1">
              {item.exhibits.map((ex) => (
                <li key={ex.id} className="flex items-center gap-2 text-sm">
                  <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                  <span>{ex.title || ex.fileName}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Motions */}
        {item.motions.length > 0 && (
          <div>
            <h3 className="mb-2 text-sm font-semibold text-muted-foreground">Motions</h3>
            <div className="space-y-2">
              {item.motions.map((m) => (
                <div key={m.id} className="rounded-md border p-3 text-sm">
                  <div className="flex items-center justify-between">
                    <Badge variant="outline" className="text-xs">{m.motionType}</Badge>
                    <Badge
                      variant={m.status === "passed" ? "default" : m.status === "failed" ? "destructive" : "secondary"}
                      className="text-xs"
                    >
                      {m.status}
                    </Badge>
                  </div>
                  <p className="mt-1 italic">{m.motionText}</p>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {m.movedBy && <span>Moved: {memberNameMap.get(m.movedBy) ?? "Unknown"}</span>}
                    {m.secondedBy && <span className="ml-3">Seconded: {memberNameMap.get(m.secondedBy) ?? "Unknown"}</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Inline motion form */}
        {!readOnly && showMotionForm && (
          <MotionForm
            meetingId={meetingId}
            townId={townId}
            agendaItemId={item.id}
            suggestedMotion={item.suggestedMotion}
            presentMembers={presentMembers}
            onClose={() => setShowMotionForm(false)}
          />
        )}

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
            <h3 className="mb-1 text-sm font-semibold text-muted-foreground">Operator Notes</h3>
            <textarea
              className="w-full rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="Notes for this item..."
              rows={3}
              value={notesValue}
              onChange={(e) => setNotesValue(e.target.value)}
              onBlur={() => void saveNotes()}
            />
          </div>
        )}
        {readOnly && item.operatorNotes && (
          <div>
            <h3 className="mb-1 text-sm font-semibold text-muted-foreground">Operator Notes</h3>
            <p className="whitespace-pre-wrap text-sm">{item.operatorNotes}</p>
          </div>
        )}
      </div>

      {/* Action bar */}
      <div className="flex items-center justify-between border-t px-6 py-3">
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onNavigatePrev} disabled={!hasPrev}>
            <ChevronLeft className="mr-1 h-4 w-4" /> Previous
          </Button>
          <Button variant="outline" size="sm" onClick={onNavigateNext} disabled={!hasNext}>
            Next <ChevronRight className="ml-1 h-4 w-4" />
          </Button>
        </div>
        {!readOnly && (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowMotionForm(true)}>
              <Gavel className="mr-1 h-4 w-4" /> Record Motion
            </Button>
            <Button variant="outline" size="sm" onClick={() => void tableItem()}>
              <Pause className="mr-1 h-4 w-4" /> Table
            </Button>
            <Button size="sm" onClick={() => void markComplete()}>
              <Check className="mr-1 h-4 w-4" /> Complete
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Inline Motion Form ────────────────────────────────────────────

interface MotionFormProps {
  meetingId: string;
  townId: string;
  agendaItemId: string;
  suggestedMotion: string | null;
  presentMembers: MemberInfo[];
  onClose: () => void;
}

function MotionForm({
  meetingId,
  townId,
  agendaItemId,
  suggestedMotion,
  presentMembers,
  onClose,
}: MotionFormProps) {
  const powerSync = usePowerSync();
  const [text, setText] = useState(suggestedMotion ?? "");
  const [movedBy, setMovedBy] = useState("");
  const [secondedBy, setSecondedBy] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!text.trim() || !movedBy) return;
    setSaving(true);
    try {
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      await powerSync.execute(
        `INSERT INTO motions (id, agenda_item_id, meeting_id, town_id, motion_text, motion_type, moved_by, seconded_by, status, created_at)
         VALUES (?, ?, ?, ?, ?, 'main', ?, ?, ?, ?)`,
        [id, agendaItemId, meetingId, townId, text.trim(), movedBy, secondedBy || null, secondedBy ? "seconded" : "pending", now],
      );
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-md border p-4 space-y-3">
      <h3 className="text-sm font-semibold">Record Motion</h3>
      <textarea
        className="w-full rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        placeholder="Motion text..."
        rows={3}
        value={text}
        onChange={(e) => setText(e.target.value)}
        autoFocus
      />
      <div className="flex gap-3">
        <div className="flex-1">
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Moved by</label>
          <select
            className="w-full rounded-md border bg-background px-3 py-1.5 text-sm"
            value={movedBy}
            onChange={(e) => setMovedBy(e.target.value)}
          >
            <option value="">Select member...</option>
            {presentMembers.map((m) => (
              <option key={m.boardMemberId} value={m.boardMemberId}>{m.name}</option>
            ))}
          </select>
        </div>
        <div className="flex-1">
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Seconded by</label>
          <select
            className="w-full rounded-md border bg-background px-3 py-1.5 text-sm"
            value={secondedBy}
            onChange={(e) => setSecondedBy(e.target.value)}
          >
            <option value="">Select member...</option>
            {presentMembers.map((m) => (
              <option key={m.boardMemberId} value={m.boardMemberId}>{m.name}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="flex gap-2">
        <Button size="sm" onClick={() => void handleSave()} disabled={!text.trim() || !movedBy || saving}>
          Save Motion
        </Button>
        <Button size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
      </div>
    </div>
  );
}

function toRoman(n: number): string {
  const numerals = ["i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x"];
  return numerals[n - 1] ?? String(n);
}
