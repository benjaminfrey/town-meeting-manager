/**
 * Shared seeding for the live-meeting router tests — Phase E, wave 5, Task 3.
 *
 * Six router test files in this directory need the same four rows (a meeting,
 * an agenda item, a seat, a motion) before they can say anything, and wave 5
 * writes seven tables that all hang off them. They are here rather than copied
 * per file for the reason `fixtures.ts` gives for its own helpers: a test that
 * builds its own row picks the shape that makes its assertion pass.
 *
 * Everything writes through `inTown`, so every fixture row is inserted under
 * `FORCE ROW LEVEL SECURITY` as the app role, exactly like the procedures
 * under test.
 *
 * `captureRealtimeEvents` is the only unusual one: it opens a SECOND app-role
 * connection, `LISTEN`s on the realtime channel, runs the callback and returns
 * what arrived. `realtime/__tests__/events.test.ts` proves `pg_notify` is
 * transactional; this is how a ROUTER test proves that a specific mutation
 * actually announced the specific topics it wrote — which is the one thing
 * `trpc/__tests__/router-wiring.test.ts`'s inventory cannot check, because its
 * `publishes` flag is a boolean per mutation rather than a set compared
 * against the tables that mutation writes.
 */

import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type postgres from "postgres";
import { connectAsAppRole } from "../../../test/db-harness.js";
import { toRows } from "../../../db/rows.js";
import { inTown, type TestDb, type TownFixture } from "../../__tests__/fixtures.js";
import {
  REALTIME_CHANNEL,
  parseRealtimeEvent,
  type RealtimeEvent,
} from "../../../realtime/events.js";

export async function seedMeeting(
  db: TestDb,
  town: TownFixture,
  boardId: string,
  opts: { status?: string; currentItemId?: string | null; presidingOfficerId?: string | null } = {},
): Promise<string> {
  const id = randomUUID();
  await inTown(db, town, async (tx) => {
    await tx.execute(sql`
      INSERT INTO meeting (
        id, board_id, town_id, title, scheduled_date, status, meeting_type, agenda_status,
        current_agenda_item_id, presiding_officer_id
      )
      VALUES (
        ${id}, ${boardId}, ${town.townId}, 'Regular Meeting', '2026-11-03'::date,
        ${opts.status ?? "open"}::meeting_status, 'regular', 'draft',
        ${opts.currentItemId ?? null}, ${opts.presidingOfficerId ?? null}
      )
    `);
  });
  return id;
}

export async function seedAgendaItem(
  db: TestDb,
  town: TownFixture,
  meetingId: string,
  opts: {
    title?: string;
    parentItemId?: string | null;
    status?: string;
    sortOrder?: number;
    /** Makes this a minutes-APPROVAL item, the shape `voteRecord.recordForMotion` acts on. */
    sourceMinutesDocumentId?: string | null;
  } = {},
): Promise<string> {
  const id = randomUUID();
  await inTown(db, town, async (tx) => {
    await tx.execute(sql`
      INSERT INTO agenda_item (
        id, meeting_id, town_id, section_type, title, sort_order, parent_item_id, status,
        source_minutes_document_id
      )
      VALUES (
        ${id}, ${meetingId}, ${town.townId}, 'new_business', ${opts.title ?? "Discuss the budget"},
        ${opts.sortOrder ?? 0}, ${opts.parentItemId ?? null},
        ${opts.status ?? "pending"}::agenda_item_status,
        ${opts.sourceMinutesDocumentId ?? null}
      )
    `);
  });
  return id;
}

/**
 * A `minutes_document` for `meetingId`, in `draft` unless told otherwise.
 *
 * Added in Phase E wave 5, Task 5: `voteRecord.recordForMotion` approves one
 * of these when a motion on a minutes-approval agenda item carries, so its
 * tests need one that the `agenda_item.source_minutes_document_id` FK can
 * point at. `meeting_id` is unique on this table, so a meeting gets at most
 * one.
 */
export async function seedMinutesDocument(
  db: TestDb,
  town: TownFixture,
  meetingId: string,
  opts: { status?: string } = {},
): Promise<string> {
  const id = randomUUID();
  await inTown(db, town, async (tx) => {
    await tx.execute(sql`
      INSERT INTO minutes_document (id, meeting_id, town_id, status)
      VALUES (${id}, ${meetingId}, ${town.townId}, ${opts.status ?? "draft"}::minutes_document_status)
    `);
  });
  return id;
}

/** A person plus a seat on `boardId`, which is what every FK here points at. */
export async function seedSeat(
  db: TestDb,
  town: TownFixture,
  boardId: string,
  opts: { name?: string; status?: "active" | "archived"; personId?: string } = {},
): Promise<{ boardMemberId: string; personId: string }> {
  const personId = opts.personId ?? randomUUID();
  const boardMemberId = randomUUID();
  await inTown(db, town, async (tx) => {
    if (!opts.personId) {
      await tx.execute(sql`
        INSERT INTO person (id, town_id, name, email)
        VALUES (${personId}, ${town.townId}, ${opts.name ?? `Member ${personId.slice(0, 8)}`},
                ${`${personId.slice(0, 8)}@example.test`})
      `);
    }
    await tx.execute(sql`
      INSERT INTO board_member (id, person_id, board_id, town_id, term_start, status)
      VALUES (${boardMemberId}, ${personId}, ${boardId}, ${town.townId}, CURRENT_DATE,
              ${opts.status ?? "active"}::board_member_status)
    `);
  });
  return { boardMemberId, personId };
}

export async function seedMotion(
  db: TestDb,
  town: TownFixture,
  meetingId: string,
  agendaItemId: string,
  opts: { status?: string; motionType?: string; text?: string } = {},
): Promise<string> {
  const id = randomUUID();
  await inTown(db, town, async (tx) => {
    await tx.execute(sql`
      INSERT INTO motion (id, agenda_item_id, meeting_id, town_id, motion_text, motion_type, status)
      VALUES (${id}, ${agendaItemId}, ${meetingId}, ${town.townId},
              ${opts.text ?? "to approve the budget"},
              ${opts.motionType ?? "main"}::motion_type,
              ${opts.status ?? "seconded"}::motion_status)
    `);
  });
  return id;
}

export async function seedExecutiveSession(
  db: TestDb,
  town: TownFixture,
  meetingId: string,
  opts: { agendaItemId?: string | null; entryMotionId?: string | null; enteredAt?: boolean } = {},
): Promise<string> {
  const id = randomUUID();
  await inTown(db, town, async (tx) => {
    await tx.execute(sql`
      INSERT INTO executive_session (
        id, meeting_id, agenda_item_id, town_id, statutory_basis, entry_motion_id, entered_at
      )
      VALUES (${id}, ${meetingId}, ${opts.agendaItemId ?? null}, ${town.townId},
              '1 M.R.S.A. §405(6)(A)', ${opts.entryMotionId ?? null},
              ${opts.enteredAt ? sql`now()` : sql`NULL`})
    `);
  });
  return id;
}

export async function seedGuestSpeaker(
  db: TestDb,
  town: TownFixture,
  meetingId: string,
  agendaItemId: string,
): Promise<string> {
  const id = randomUUID();
  await inTown(db, town, async (tx) => {
    await tx.execute(sql`
      INSERT INTO guest_speaker (id, meeting_id, agenda_item_id, town_id, name)
      VALUES (${id}, ${meetingId}, ${agendaItemId}, ${town.townId}, 'Jane Resident')
    `);
  });
  return id;
}

/** Run an arbitrary tenant-scoped SELECT and hand back typed rows. */
export function readRows<T>(
  db: TestDb,
  town: TownFixture,
  statement: ReturnType<typeof sql>,
): Promise<T[]> {
  return inTown(db, town, (tx) =>
    tx.execute(statement).then((r) => toRows<T>(r, (m) => new Error(m))),
  );
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Run `fn` with a `LISTEN`ing connection open, and return every realtime event
 * it published.
 *
 * `owner` is the raw client `withTestDb` hands back; the listener is a
 * separate app-role connection, which is the shape production runs (`bus.ts`
 * holds its own handle). Waits until `expected` events have arrived or a
 * two-second ceiling passes — so a test asserting a MISSING topic fails on the
 * assertion rather than on a timeout, and a passing test does not pay a fixed
 * sleep.
 */
export async function captureRealtimeEvents<T>(
  owner: postgres.Sql,
  expected: number,
  fn: () => Promise<T>,
): Promise<{ result: T; topics: string[]; events: RealtimeEvent[] }> {
  const listener = await connectAsAppRole(owner);
  const received: string[] = [];
  try {
    await listener.listen(REALTIME_CHANNEL, (payload) => received.push(payload));
    const result = await fn();
    const deadline = Date.now() + 2000;
    while (received.length < expected && Date.now() < deadline) {
      await delay(25);
    }
    const events = received
      .map((payload) => parseRealtimeEvent(payload))
      .filter((event): event is RealtimeEvent => event !== undefined);
    return { result, topics: events.map((event) => event.topic).sort(), events };
  } finally {
    await listener.end();
  }
}
