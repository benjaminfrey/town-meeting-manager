/**
 * Phase E, wave 5, Task 3 — where a live-meeting row's REAL board comes from.
 *
 * ─── Why this is a module and not seven copies ────────────────────────────
 *
 * Wave 4 put `assertMeetingOnAuthorizedBoard` inside `routers/agenda-item.ts`
 * because one router needed it. Wave 5 writes six more tables that derive
 * their board exactly the same way — `motion`, `vote_record`,
 * `meeting_attendance`, `executive_session`, `guest_speaker` and
 * `agenda_item_transition` each carry `meeting_id uuid NOT NULL` and no
 * `board_id` column at all (verified against `drizzle/0000_baseline.sql`'s
 * `CREATE TABLE` statements) — so the derivation moved here rather than being
 * copied. `agenda-item.ts` imports it from this file now; its behaviour is
 * unchanged, and this file's move is what wave 5's plan means by "reuse
 * `assertMeetingOnAuthorizedBoard`, do not reinvent it".
 *
 * It lives one directory ABOVE `routers/` on purpose. `trpc/__tests__/
 * router-wiring.test.ts`'s publish inventory reads every `.ts` in `routers/`
 * and attributes each file's mutations to its `export const …Router` — a file
 * in that directory with no router export and no live-meeting WRITE is
 * invisible to it, which is fine, but a helper module that later grew a write
 * would be a mutation the inventory could not attribute to anything. Nothing
 * here writes; keeping it out of the scanned directory keeps that true by
 * construction rather than by discipline.
 *
 * ─── What every function here has in common ───────────────────────────────
 *
 * All of them read INSIDE the caller's own `ctx.withTenant` transaction, so
 * RLS is running and another town's row simply is not there. That is what
 * makes `NOT_FOUND` the right answer for a foreign id (conventions item 3) and
 * what makes the derived board safe to hand to
 * `assertMatchesAuthorizedBoard` — the requirement there is about PROVENANCE
 * (read from the database inside the write's own transaction, never taken from
 * client input), not about the value being a column.
 *
 * ─── The existence checks are not a separate concern from the board ───────
 *
 * Postgres enforces a foreign key with row security BYPASSED. So an `INSERT`
 * naming another town's `board_member` or `agenda_item` succeeds — silently,
 * with no error to see — unless the procedure checks first. This project has
 * reproduced that eight times. Every `assert*` below that takes a LIST does
 * the check conventions item 2 spells out: it returns one row per requested
 * id and compares `rows.length` to the id count, rather than deriving a
 * `SELECT DISTINCT` that structurally cannot notice a missing id.
 */

import { sql, type SQL } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { toRows } from "../db/rows.js";
import type { TenantTx } from "../db/with-tenant.js";
import { assertMatchesAuthorizedBoard } from "./trpc.js";

/**
 * The context shape the defence helpers need — the board
 * `requireBoardPermission`/`requireBoardActor` authorized, carried on the
 * request context.
 */
export interface BoardAuthorizedContext {
  authorizedBoardId?: string;
}

/**
 * The six live-meeting tables whose board is `meeting.board_id`, one join out.
 *
 * A closed map rather than a string parameter: the table name goes into the
 * query as an IDENTIFIER, which cannot be bound as a parameter, so the only
 * safe form is one this file writes itself. A caller passes a key of this
 * object and TypeScript refuses anything else.
 *
 * `agenda_item` is deliberately absent even though it has the same shape —
 * `routers/agenda-item.ts` has its own `assertItemsOnAuthorizedBoard`, which
 * additionally returns the distinct meeting ids `reorder` needs, and two ways
 * to ask one question is one too many.
 *
 * `future_item_queue` is absent for the opposite reason: it carries
 * `board_id uuid NOT NULL` directly and its `source_meeting_id` is NULLABLE,
 * so deriving its board through a meeting is not merely unnecessary, it is
 * wrong — a queued item that outlived its source meeting would derive NULL.
 */
const MEETING_SCOPED_TABLES = {
  motion: sql.raw("motion"),
  vote_record: sql.raw("vote_record"),
  meeting_attendance: sql.raw("meeting_attendance"),
  executive_session: sql.raw("executive_session"),
  guest_speaker: sql.raw("guest_speaker"),
  agenda_item_transition: sql.raw("agenda_item_transition"),
} as const satisfies Record<string, SQL>;

export type MeetingScopedTable = keyof typeof MEETING_SCOPED_TABLES;

/**
 * Resolve a meeting's real board inside the caller's own tenant transaction
 * and refuse unless it is the board the guard authorized.
 *
 * This IS `routers/meeting.ts`'s exported `assertMeetingExists` — the same
 * `WHERE id = $1` against `meeting` under the same RLS, answering the same
 * NOT_FOUND for a foreign or nonexistent id — with the row's `board_id`
 * returned as well, because the mismatch defence needs it and a second query
 * for the same row would be two round trips for one question. Not a weakening
 * of that check: it is that check, plus a column.
 */
export async function assertMeetingOnAuthorizedBoard(
  ctx: BoardAuthorizedContext,
  tx: TenantTx,
  meetingId: string,
): Promise<string> {
  const rows = toRows<{ board_id: string }>(
    await tx.execute(sql`SELECT board_id FROM meeting WHERE id = ${meetingId}`),
    (message) => new Error(`assertMeetingOnAuthorizedBoard: ${message}`),
  );
  const row = rows[0];
  if (!row) throw new TRPCError({ code: "NOT_FOUND" });
  assertMatchesAuthorizedBoard(ctx, row.board_id);
  return row.board_id;
}

/**
 * The row-targeted form: a mutation names a `motion`/`vote_record`/… by its
 * own id, and the board is two columns away.
 *
 * An INNER JOIN, deliberately, for the reason `agenda-item.ts` already
 * records: `meeting_id` is NOT NULL with a foreign key, so a missing join
 * partner cannot happen for a row this town can see — but a LEFT JOIN would
 * answer `null` for one if it ever did, and a `null` board compared against
 * the authorized one is a comparison this defence must never be asked to
 * make.
 *
 * Returns the meeting id as well, because every caller needs it: it is what
 * `publishRealtimeEvent` names, and a mutation that knows the row but not its
 * meeting cannot tell anyone the row changed.
 */
export async function assertLiveRowOnAuthorizedBoard(
  ctx: BoardAuthorizedContext,
  tx: TenantTx,
  table: MeetingScopedTable,
  rowId: string,
): Promise<{ meetingId: string; boardId: string }> {
  const rows = toRows<{ meeting_id: string; board_id: string }>(
    await tx.execute(sql`
      SELECT r.meeting_id, m.board_id
      FROM ${MEETING_SCOPED_TABLES[table]} r
      JOIN meeting m ON m.id = r.meeting_id
      WHERE r.id = ${rowId}
    `),
    (message) => new Error(`assertLiveRowOnAuthorizedBoard(${table}): ${message}`),
  );
  const row = rows[0];
  if (!row) throw new TRPCError({ code: "NOT_FOUND" });
  assertMatchesAuthorizedBoard(ctx, row.board_id);
  return { meetingId: row.meeting_id, boardId: row.board_id };
}

/**
 * Every id in `itemIds` must be an agenda item OF THIS MEETING.
 *
 * Existence alone would not be enough, which is the lesson `agendaItem.insert`
 * already records for `parentItemId`: a real agenda item in ANOTHER meeting
 * satisfies the foreign key while attaching this motion, speaker or executive
 * session to a row that renders nowhere on the screen that created it.
 *
 * The row-count comparison is the many-row existence check — see this file's
 * header. It runs on the single-id case too, where it degrades to "the row
 * came back".
 */
export async function assertAgendaItemsOnMeeting(
  tx: TenantTx,
  meetingId: string,
  itemIds: readonly string[],
): Promise<void> {
  if (itemIds.length === 0) return;
  const idList = sql.join(
    itemIds.map((id) => sql`${id}`),
    sql`, `,
  );
  const rows = toRows<{ id: string }>(
    await tx.execute(sql`
      SELECT id FROM agenda_item WHERE id IN (${idList}) AND meeting_id = ${meetingId}
    `),
    (message) => new Error(`assertAgendaItemsOnMeeting: ${message}`),
  );
  if (new Set(rows.map((r) => r.id)).size !== new Set(itemIds).size) {
    throw new TRPCError({ code: "NOT_FOUND" });
  }
}

/** Every id in `motionIds` must be a motion OF THIS MEETING. Same reasoning. */
export async function assertMotionsOnMeeting(
  tx: TenantTx,
  meetingId: string,
  motionIds: readonly string[],
): Promise<void> {
  if (motionIds.length === 0) return;
  const idList = sql.join(
    motionIds.map((id) => sql`${id}`),
    sql`, `,
  );
  const rows = toRows<{ id: string }>(
    await tx.execute(sql`
      SELECT id FROM motion WHERE id IN (${idList}) AND meeting_id = ${meetingId}
    `),
    (message) => new Error(`assertMotionsOnMeeting: ${message}`),
  );
  if (new Set(rows.map((r) => r.id)).size !== new Set(motionIds).size) {
    throw new TRPCError({ code: "NOT_FOUND" });
  }
}

/**
 * Every id in `boardMemberIds` must be a seat ON THIS BOARD, and the caller
 * gets back each seat's `person_id`.
 *
 * `motion.moved_by`, `motion.seconded_by`, `vote_record.board_member_id` and
 * `meeting_attendance.board_member_id` are all foreign keys to `board_member`
 * taken from client input, and all four are written today with no check of any
 * kind — so a seat on another town's board satisfies the constraint and lands
 * a vote, a mover or an attendance row on a meeting whose board that person
 * has never sat on.
 *
 * **Seat STATUS is deliberately not filtered here.** A member whose term ended
 * mid-year still has an `archived` `board_member` row, and the minutes of the
 * meetings they sat in must keep naming them; an attendance or vote row for an
 * archived seat is a records question, not a tenancy one. The one place where
 * `status = 'active'` IS load-bearing is `assertCanInsertVoteRecord`'s
 * self-vote branch (`rules.ts` rule 5), which asks a different question — may
 * THIS caller cast a vote on that seat — and asks it itself.
 */
export async function assertBoardMembersOnBoard(
  tx: TenantTx,
  boardId: string,
  boardMemberIds: readonly string[],
): Promise<Map<string, string>> {
  const unique = [...new Set(boardMemberIds)];
  if (unique.length === 0) return new Map();
  const idList = sql.join(
    unique.map((id) => sql`${id}`),
    sql`, `,
  );
  const rows = toRows<{ id: string; person_id: string }>(
    await tx.execute(sql`
      SELECT id, person_id FROM board_member
      WHERE id IN (${idList}) AND board_id = ${boardId}
    `),
    (message) => new Error(`assertBoardMembersOnBoard: ${message}`),
  );
  if (rows.length !== unique.length) throw new TRPCError({ code: "NOT_FOUND" });
  return new Map(rows.map((r) => [r.id, r.person_id]));
}
