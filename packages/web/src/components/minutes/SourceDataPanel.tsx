/**
 * The minutes editor's right-hand panel — what the live meeting actually
 * recorded for the section the clerk is editing.
 *
 * ─── Phase E, wave 6, Task 3 ──────────────────────────────────────────────
 *
 * Five raw `select("*")` reads moved to the five procedures that already
 * existed for them (`agendaItem`/`motion`/`voteRecord`/`agendaItemTransition`/
 * `guestSpeaker`, all `byMeeting`, all wave 3–5). Every row type below comes
 * from `RouterOutputs`, never `Record<string, unknown>` — conventions item 10,
 * and it is the bag type that hid what follows.
 *
 * ─── Five of this panel's reads were of columns that do not exist ─────────
 *
 * `select("*")` returns whatever the table has; a `Record<string, unknown>`
 * read of a key the table does NOT have compiles, evaluates to `undefined`,
 * and every one of these sat behind a `Boolean(...)`/`!= null` guard, so the
 * panel silently rendered less than it appears to. Checked against
 * `packages/api/drizzle/0000_baseline.sql`, not inferred from the procedures:
 *
 *   - `motion.moved_by_name` / `motion.seconded_by_name` — the columns are
 *     `moved_by` / `seconded_by`, `board_member.id` foreign keys. The
 *     "Moved: …" / "Seconded: …" spans have NEVER rendered. They are now
 *     resolved through `boardMember.roster`, the same mapping `live.tsx`
 *     builds for `VotePanel`.
 *   - `motion.yeas` / `nays` / `abstentions` — no such columns; the tally
 *     lives in the `vote_summary` JSONB that `voteRecord.recordForMotion`
 *     writes. `hasVoteData` was therefore always `false` and the three vote
 *     badges have never rendered either. Now read from `vote_summary`,
 *     through `lib/meeting/voteTally.ts`'s `voteTallyOf` — written here in
 *     Task 3, moved out unchanged in Task 4 when
 *     `routes/meetings.$meetingId.review.tsx` needed the same narrowing of
 *     the same column and a second copy would have been a second answer.
 *   - `vote_record.member_name` — the column is `board_member_id`. Each
 *     individual-vote badge rendered as ": yea". Same roster mapping.
 *   - `agenda_item_transition.transition_type` — no such column, so the
 *     `?? "Transition"` fallback was the only thing that ever rendered. The
 *     dead read is gone and the literal stays; naming the transition would
 *     need a product decision about what to call it, not a column rename.
 *
 * The roster read is the one procedure this panel did not already have a call
 * for. It needs a `boardId`, which is why this component takes one — threaded
 * from `minutes.tsx`'s `meeting.detail.board_id` through `MinutesEditor`,
 * the single source for it on that screen.
 *
 * No writes here, so no `pathFilter()` call: the writers that change these
 * tables (`AgendaSection`, `InlineItemForm`, `MotionPanel`, `VotePanel`,
 * `GuestSpeakerEntry`, `MeetingStartFlow`, …) already invalidate both the
 * legacy `queryKeys.*` keys and their routers' `pathFilter()`, so this
 * panel's reads are reached by the same invalidations that reach `live.tsx`'s.
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Clock } from "lucide-react";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { voteTallyOf } from "@/lib/meeting/voteTally";
import type { MinutesContentJson, MinutesContentSection } from "@town-meeting/shared/types";

interface SourceDataPanelProps {
  meetingId: string;
  /** The meeting's board — needed only to resolve seat ids to member names. */
  boardId: string;
  selectedSectionIndex: number;
  contentJson: MinutesContentJson;
}

type Motion = RouterOutputs["motion"]["byMeeting"][number];

function formatTime(timestamp: string | null): string {
  if (!timestamp) return "--";
  try {
    return new Date(timestamp).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return timestamp;
  }
}

export function SourceDataPanel({
  meetingId,
  boardId,
  selectedSectionIndex,
  contentJson,
}: SourceDataPanelProps) {
  // `enabled: !!meetingId` is carried over from the queries these replace. It
  // is load-bearing now in a way it was not before: every input below is
  // `z.string().uuid()`, so an empty id is a BAD_REQUEST rather than a query
  // that returns nothing.
  const { data: agendaItems = [] } = useQuery({
    ...trpc.agendaItem.byMeeting.queryOptions({ meetingId }),
    enabled: !!meetingId,
  });

  const { data: motions = [] } = useQuery({
    ...trpc.motion.byMeeting.queryOptions({ meetingId }),
    enabled: !!meetingId,
  });

  const { data: voteRecords = [] } = useQuery({
    ...trpc.voteRecord.byMeeting.queryOptions({ meetingId }),
    enabled: !!meetingId,
  });

  const { data: transitions = [] } = useQuery({
    ...trpc.agendaItemTransition.byMeeting.queryOptions({ meetingId }),
    enabled: !!meetingId,
  });

  const { data: guestSpeakers = [] } = useQuery({
    ...trpc.guestSpeaker.byMeeting.queryOptions({ meetingId }),
    enabled: !!meetingId,
  });

  const { data: roster = [] } = useQuery({
    ...trpc.boardMember.roster.queryOptions({ boardId }),
    enabled: !!boardId,
  });

  /** `board_member.id` → the person's name, for movers, seconders and voters. */
  const memberNames = useMemo(() => new Map(roster.map((seat) => [seat.id, seat.name])), [roster]);

  const section: MinutesContentSection | undefined = contentJson.sections[selectedSectionIndex];

  if (!section) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-muted-foreground">
        Select a section to view source data
      </div>
    );
  }

  // Find agenda items that match this section by section_type and sort_order
  const sectionAgendaItems = agendaItems.filter((ai) => ai.section_type === section.section_type);

  // Get motions for these agenda items
  const agendaItemIds = new Set(sectionAgendaItems.map((ai) => ai.id));
  const sectionMotions = motions.filter((m) => agendaItemIds.has(m.agenda_item_id));

  // Get vote records for these motions
  const motionIds = new Set(sectionMotions.map((m) => m.id));
  const sectionVoteRecords = voteRecords.filter((vr) => motionIds.has(vr.motion_id));

  // Get transitions for these agenda items
  const sectionTransitions = transitions.filter((t) => agendaItemIds.has(t.agenda_item_id));

  // Get guest speakers for these agenda items
  const sectionSpeakers = guestSpeakers.filter(
    (gs) => gs.agenda_item_id !== null && agendaItemIds.has(gs.agenda_item_id),
  );

  return (
    <div className="h-full overflow-y-auto p-4">
      <h3 className="mb-3 text-sm font-semibold text-muted-foreground uppercase tracking-wide">
        Source Data
      </h3>
      <p className="mb-4 text-xs text-muted-foreground">Section: {section.title}</p>

      {/* Timestamps / Transitions */}
      {sectionTransitions.length > 0 && (
        <div className="mb-4">
          <h4 className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Clock className="h-3.5 w-3.5" />
            Timestamps
          </h4>
          <div className="space-y-1.5">
            {sectionTransitions.map((t) => (
              <div
                key={t.id}
                className="rounded border border-border bg-muted/50 px-3 py-2 text-xs text-muted-foreground"
              >
                {/* Literal, not a column: see this file's header. */}
                <span className="font-medium">Transition</span>
                <span className="ml-2">
                  {formatTime(t.started_at)} &rarr; {formatTime(t.ended_at)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Motions */}
      {sectionMotions.length > 0 && (
        <div className="mb-4">
          <h4 className="mb-2 text-xs font-medium text-muted-foreground">Motions</h4>
          <div className="space-y-3">
            {sectionMotions.map((m: Motion) => {
              const tally = voteTallyOf(m.vote_summary);
              const movedByName = m.moved_by ? memberNames.get(m.moved_by) : undefined;
              const secondedByName = m.seconded_by ? memberNames.get(m.seconded_by) : undefined;
              const motionVotes = sectionVoteRecords.filter((vr) => vr.motion_id === m.id);
              return (
                <div key={m.id} className="rounded border border-border bg-muted/50 px-3 py-2">
                  <p className="mb-1 text-xs text-muted-foreground">{m.motion_text}</p>
                  <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    {movedByName && <span>Moved: {movedByName}</span>}
                    {secondedByName && <span>| Seconded: {secondedByName}</span>}
                  </div>
                  {/* Vote summary */}
                  {tally ? (
                    <div className="mt-1.5 flex items-center gap-2">
                      <Badge variant="outline" className="text-xs text-muted-foreground">
                        Yeas: {tally.yeas}
                      </Badge>
                      <Badge variant="outline" className="text-xs text-muted-foreground">
                        Nays: {tally.nays}
                      </Badge>
                      <Badge variant="outline" className="text-xs text-muted-foreground">
                        Abstentions: {tally.abstentions}
                      </Badge>
                    </div>
                  ) : null}
                  {Boolean(m.status) && (
                    <Badge variant="secondary" className="mt-1.5 text-xs text-muted-foreground">
                      {m.status}
                    </Badge>
                  )}
                  {/* Individual votes */}
                  {motionVotes.length > 0 && (
                    <div className="mt-2 border-t border-border pt-1.5">
                      <p className="mb-1 text-[10px] font-medium text-muted-foreground uppercase">
                        Individual Votes
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {motionVotes.map((vr) => (
                          <Badge
                            key={vr.id}
                            variant="outline"
                            className="text-[10px] text-muted-foreground"
                          >
                            {memberNames.get(vr.board_member_id) ?? "Unknown member"}: {vr.vote}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Guest Speakers */}
      {sectionSpeakers.length > 0 && (
        <div className="mb-4">
          <h4 className="mb-2 text-xs font-medium text-muted-foreground">Guest Speakers</h4>
          <div className="space-y-1.5">
            {sectionSpeakers.map((gs) => (
              <div
                key={gs.id}
                className="rounded border border-border bg-muted/50 px-3 py-2 text-xs text-muted-foreground"
              >
                <span className="font-medium">{gs.name}</span>
                {Boolean(gs.topic) && <span className="ml-2">- {gs.topic}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Operator Notes from Agenda Items */}
      {sectionAgendaItems.some((ai) => ai.operator_notes) && (
        <div className="mb-4">
          <h4 className="mb-2 text-xs font-medium text-muted-foreground">Operator Notes</h4>
          <div className="space-y-1.5">
            {sectionAgendaItems
              .filter((ai) => ai.operator_notes)
              .map((ai) => (
                <div
                  key={ai.id}
                  className="rounded border border-border bg-muted/50 px-3 py-2 text-xs italic text-muted-foreground"
                >
                  {ai.operator_notes}
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Empty state for section */}
      {sectionMotions.length === 0 &&
        sectionTransitions.length === 0 &&
        sectionSpeakers.length === 0 &&
        !sectionAgendaItems.some((ai) => ai.operator_notes) && (
          <p className="text-xs text-muted-foreground italic">
            No source data found for this section.
          </p>
        )}
    </div>
  );
}
