/**
 * The three counts a motion's `vote_summary` carries, narrowed from `jsonb`.
 *
 * Extracted in Phase E wave 6, Task 4 from `components/minutes/SourceDataPanel.tsx`,
 * where Task 3 wrote it — unchanged, byte for byte, apart from the move.
 * `routes/meetings.$meetingId.review.tsx` renders the same three numbers off
 * the same column, and two narrowings of one JSONB shape that can disagree is
 * how the phantom-column class of defect gets reintroduced one screen at a
 * time.
 *
 * `vote_summary` is JSONB, so `motion.byMeeting` declares it `unknown` and
 * this narrows rather than casts. `voteRecord.recordForMotion` writes seven
 * keys (`yeas`, `nays`, `abstentions`, `recusals`, `absent`, `result`,
 * `passed`); only the first three are read by either caller. A row written
 * before that procedure existed, or a null column, answers `null` and the
 * counts stay hidden.
 */
export function voteTallyOf(
  stored: unknown,
): { yeas: number; nays: number; abstentions: number } | null {
  if (typeof stored !== "object" || stored === null) return null;
  const record = stored as Record<string, unknown>;
  const yeas = record.yeas;
  const nays = record.nays;
  if (typeof yeas !== "number" && typeof nays !== "number") return null;
  return {
    yeas: typeof yeas === "number" ? yeas : 0,
    nays: typeof nays === "number" ? nays : 0,
    abstentions: typeof record.abstentions === "number" ? record.abstentions : 0,
  };
}
