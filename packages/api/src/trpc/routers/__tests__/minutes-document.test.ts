/**
 * The `minutesDocument` router — wave 3, Task 3 (`byMeeting`) and wave 6,
 * Task 1 (everything else).
 *
 * Five of the six writes below reached the database through the Supabase
 * client with **no authorization check of any kind** until wave 6, under a
 * tenancy-only policy — so, as in `executive-session.test.ts`, the first
 * assertion for each is not "the right people can" but "the wrong people
 * cannot", and each mutation carries the same four: the code (or the admin
 * gate), the board mismatch, the reorder pin, and the cross-tenant existence
 * check.
 *
 * `publish` carries a FIFTH that no other procedure in this repository needs:
 * the R1-WITHOUT-R5 actor. `TEMPLATE_RECORDING_SECRETARY` grants R1 and
 * withholds R5 by design, and R1 is the guard a migration would naturally
 * reach for, so without that test rule 13a is unpinned and the widening it
 * exists to stop comes back silently — nothing fails, a caller simply gains
 * the public portal. See `routers/minutes-document.ts`'s header.
 *
 * Same connection discipline as every other router test in this phase: every
 * case that touches tenancy or RLS runs through `connectAsAppRole`, never the
 * owner connection `withTestDb` hands back.
 */

import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { withTestDb, connectAsAppRole } from "../../../test/db-harness.js";
import {
  seedTown,
  seedActor,
  contextFor,
  testDb,
  inTown,
  expectTrpcError,
  type TestDb,
  type TownFixture,
} from "../../__tests__/fixtures.js";
import { appRouter } from "../../router.js";
import { toRows } from "../../../db/rows.js";
import type { PermissionCode } from "../../authorization/permission.js";

async function seedMeeting(db: TestDb, town: TownFixture, boardId: string): Promise<string> {
  const id = randomUUID();
  await inTown(db, town, async (tx) => {
    await tx.execute(sql`
      INSERT INTO meeting (id, board_id, town_id, title, scheduled_date, status, meeting_type, agenda_status)
      VALUES (${id}, ${boardId}, ${town.townId}, 'Regular Meeting', '2026-11-03'::date,
              'draft'::meeting_status, 'regular', 'draft')
    `);
  });
  return id;
}

async function seedMinutesDocument(
  db: TestDb,
  town: TownFixture,
  meetingId: string,
  boardId: string | null,
  status = "draft",
): Promise<string> {
  const id = randomUUID();
  await inTown(db, town, async (tx) => {
    await tx.execute(sql`
      INSERT INTO minutes_document (id, meeting_id, town_id, board_id, status)
      VALUES (${id}, ${meetingId}, ${town.townId}, ${boardId}, ${status}::minutes_document_status)
    `);
  });
  return id;
}

/** The columns every write assertion below reads back. */
interface DocRow {
  id: string;
  status: string;
  content_json: unknown;
  amendments_history: unknown;
  submitted_for_review_at: string | null;
  approved_at: string | null;
  published_at: string | null;
}

async function readDoc(db: TestDb, town: TownFixture, docId: string): Promise<DocRow> {
  const rows = await inTown(db, town, (tx) =>
    tx
      .execute(
        sql`SELECT id, status::text AS status, content_json, amendments_history,
                   submitted_for_review_at, approved_at, published_at
              FROM minutes_document WHERE id = ${docId}`,
      )
      .then((r) => toRows<DocRow>(r, (m) => new Error(m))),
  );
  const row = rows[0];
  if (!row) throw new Error(`no minutes_document ${docId}`);
  return row;
}

async function readEvents(
  db: TestDb,
  town: TownFixture,
): Promise<Array<{ event_type: string; payload: Record<string, unknown> }>> {
  return inTown(db, town, (tx) =>
    tx
      .execute(sql`SELECT event_type, payload FROM notification_event ORDER BY created_at, id`)
      .then((r) =>
        toRows<{ event_type: string; payload: Record<string, unknown> }>(r, (m) => new Error(m)),
      ),
  );
}

/** Staff holding exactly the codes named, on `town.boardId` and nowhere else. */
function staffOn(town: TownFixture, permissions: Partial<Record<PermissionCode, boolean>>) {
  return {
    role: "staff" as const,
    global: [],
    boardOverrides: [{ boardId: town.boardId, permissions }],
  };
}

/**
 * The actor rule 13a exists to refuse — `TEMPLATE_RECORDING_SECRETARY`'s
 * exact code set (M2 M3 M4 M5 R1 R2 R3 R4 R6), granted per board with nothing
 * global, which is how that `designated_boards` template writes it.
 */
function recordingSecretary(town: TownFixture) {
  return staffOn(town, {
    M2: true,
    M3: true,
    M4: true,
    M5: true,
    R1: true,
    R2: true,
    R3: true,
    R4: true,
    R6: true,
  });
}

describe("minutesDocument.byMeeting", () => {
  it("returns the meeting's minutes document", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const meetingId = await seedMeeting(db, town, town.boardId);
        const docId = await seedMinutesDocument(db, town, meetingId, town.boardId, "review");
        const actor = await seedActor(db, town, { role: "admin" });
        const caller = appRouter.createCaller(contextFor(db, town, actor));

        expect(await caller.minutesDocument.byMeeting({ meetingId })).toEqual({
          id: docId,
          status: "review",
        });
      } finally {
        await app.end();
      }
    });
  });

  it("answers null for a meeting with no minutes document yet", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const meetingId = await seedMeeting(db, town, town.boardId);
        const actor = await seedActor(db, town, { role: "admin" });
        const caller = appRouter.createCaller(contextFor(db, town, actor));

        expect(await caller.minutesDocument.byMeeting({ meetingId })).toBeNull();
      } finally {
        await app.end();
      }
    });
  });

  it("answers NOT_FOUND for a meeting in another town", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const mine = await seedTown(db, "Newcastle");
        const theirs = await seedTown(db, "Bristol");
        const theirMeeting = await seedMeeting(db, theirs, theirs.boardId);
        const actor = await seedActor(db, mine, { role: "admin" });
        const caller = appRouter.createCaller(contextFor(db, mine, actor));

        const err = await expectTrpcError(() =>
          caller.minutesDocument.byMeeting({ meetingId: theirMeeting }),
        );
        expect(err.code).toBe("NOT_FOUND");
      } finally {
        await app.end();
      }
    });
  });

  it("answers NOT_FOUND for an id that never existed", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const actor = await seedActor(db, town, { role: "admin" });
        const caller = appRouter.createCaller(contextFor(db, town, actor));

        const err = await expectTrpcError(() =>
          caller.minutesDocument.byMeeting({ meetingId: randomUUID() }),
        );
        expect(err.code).toBe("NOT_FOUND");
      } finally {
        await app.end();
      }
    });
  });
});

/** A meeting and its minutes document, in one call. */
async function scene(
  db: TestDb,
  town: TownFixture,
  opts: {
    /** The board the MEETING is on — the only board that authorizes anything. */
    board?: string;
    status?: string;
    /**
     * What to write into the denormalised `minutes_document.board_id` column.
     * Defaults to the meeting's board; pass something else to prove the
     * derivation does not read it.
     */
    denormalisedBoardId?: string | null;
  } = {},
): Promise<{ meetingId: string; docId: string; boardId: string }> {
  const boardId = opts.board ?? town.boardId;
  const meetingId = await seedMeeting(db, town, boardId);
  const docId = await seedMinutesDocument(
    db,
    town,
    meetingId,
    opts.denormalisedBoardId === undefined ? boardId : opts.denormalisedBoardId,
    opts.status ?? "draft",
  );
  return { meetingId, docId, boardId };
}

describe("minutesDocument.detail", () => {
  it("returns the document to a caller holding R4 for the meeting's board", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const { meetingId, docId } = await scene(db, town);
        const actor = await seedActor(db, town, staffOn(town, { R4: true }));
        const caller = appRouter.createCaller(contextFor(db, town, actor));

        const doc = await caller.minutesDocument.detail({ meetingId });
        expect(doc).toMatchObject({ id: docId, meeting_id: meetingId, status: "draft" });
        // Explicit columns: the five `select("*")` returned and this does not.
        expect(doc).not.toHaveProperty("board_id");
        expect(doc).not.toHaveProperty("town_id");
        expect(doc).not.toHaveProperty("pdf_storage_path");
        expect(doc).toMatchObject({ has_pdf: false });
      } finally {
        await app.end();
      }
    });
  });

  it("refuses a DRAFT to a caller with no R4 — rule 9, which select(*) never applied", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const { meetingId } = await scene(db, town);
        const actor = await seedActor(db, town, { role: "staff", global: [] });
        const caller = appRouter.createCaller(contextFor(db, town, actor));

        const err = await expectTrpcError(() => caller.minutesDocument.detail({ meetingId }));
        expect(err.code).toBe("FORBIDDEN");
        expect(err.message).toContain("R4");
      } finally {
        await app.end();
      }
    });
  });

  it("returns an APPROVED document to any signed-in member, with no R4 anywhere", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const { meetingId, docId } = await scene(db, town, { status: "approved" });
        const actor = await seedActor(db, town, { role: "staff", global: [] });
        const caller = appRouter.createCaller(contextFor(db, town, actor));

        expect(await caller.minutesDocument.detail({ meetingId })).toMatchObject({
          id: docId,
          status: "approved",
        });
      } finally {
        await app.end();
      }
    });
  });

  it("does NOT resolve R4 against the denormalised minutes_document.board_id", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        // The meeting is on `otherBoardId`; the document's own column claims
        // `boardId`. A rule reading the column would allow this caller.
        const { meetingId } = await scene(db, town, {
          board: town.otherBoardId,
          denormalisedBoardId: town.boardId,
        });
        const actor = await seedActor(db, town, staffOn(town, { R4: true }));
        const caller = appRouter.createCaller(contextFor(db, town, actor));

        const err = await expectTrpcError(() => caller.minutesDocument.detail({ meetingId }));
        expect(err.code).toBe("FORBIDDEN");
      } finally {
        await app.end();
      }
    });
  });

  it("answers null for a meeting with no minutes document yet", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const meetingId = await seedMeeting(db, town, town.boardId);
        const actor = await seedActor(db, town, { role: "admin" });
        const caller = appRouter.createCaller(contextFor(db, town, actor));

        expect(await caller.minutesDocument.detail({ meetingId })).toBeNull();
      } finally {
        await app.end();
      }
    });
  });

  it("answers NOT_FOUND for a meeting in another town", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const mine = await seedTown(db, "Newcastle");
        const theirs = await seedTown(db, "Bristol");
        const there = await scene(db, theirs);
        const actor = await seedActor(db, mine, { role: "admin" });
        const caller = appRouter.createCaller(contextFor(db, mine, actor));

        const err = await expectTrpcError(() =>
          caller.minutesDocument.detail({ meetingId: there.meetingId }),
        );
        expect(err.code).toBe("NOT_FOUND");
      } finally {
        await app.end();
      }
    });
  });
});

describe("minutesDocument.pendingByTown", () => {
  it("returns the town's draft and review documents, and nothing adopted", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const draft = await scene(db, town, { status: "draft" });
        const review = await scene(db, town, { status: "review" });
        await scene(db, town, { status: "approved" });
        await scene(db, town, { status: "published" });
        const actor = await seedActor(db, town, { role: "admin" });
        const caller = appRouter.createCaller(contextFor(db, town, actor));

        const rows = await caller.minutesDocument.pendingByTown();
        expect([...rows].sort((a, b) => a.meeting_id.localeCompare(b.meeting_id))).toEqual(
          [
            { meeting_id: draft.meetingId, status: "draft" },
            { meeting_id: review.meetingId, status: "review" },
          ].sort((a, b) => a.meeting_id.localeCompare(b.meeting_id)),
        );
      } finally {
        await app.end();
      }
    });
  });

  it("filters per ROW, so a board-scoped R4 sees its own board only", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const mine = await scene(db, town, { board: town.boardId, status: "draft" });
        await scene(db, town, { board: town.otherBoardId, status: "review" });
        const actor = await seedActor(db, town, staffOn(town, { R4: true }));
        const caller = appRouter.createCaller(contextFor(db, town, actor));

        expect(await caller.minutesDocument.pendingByTown()).toEqual([
          { meeting_id: mine.meetingId, status: "draft" },
        ]);
      } finally {
        await app.end();
      }
    });
  });

  it("answers an empty list to a caller with no R4 anywhere — the narrowing", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        await scene(db, town, { status: "draft" });
        const actor = await seedActor(db, town, { role: "staff", global: [] });
        const caller = appRouter.createCaller(contextFor(db, town, actor));

        expect(await caller.minutesDocument.pendingByTown()).toEqual([]);
      } finally {
        await app.end();
      }
    });
  });

  it("does not reach another town's pending documents", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const mine = await seedTown(db, "Newcastle");
        const theirs = await seedTown(db, "Bristol");
        await scene(db, theirs, { status: "draft" });
        const actor = await seedActor(db, mine, { role: "admin" });
        const caller = appRouter.createCaller(contextFor(db, mine, actor));

        expect(await caller.minutesDocument.pendingByTown()).toEqual([]);
      } finally {
        await app.end();
      }
    });
  });
});

describe("minutesDocument.saveDraft", () => {
  it("writes the content for a caller holding R1", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const { docId } = await scene(db, town);
        const actor = await seedActor(db, town, staffOn(town, { R1: true }));
        const caller = appRouter.createCaller(contextFor(db, town, actor));

        await caller.minutesDocument.saveDraft({
          boardId: town.boardId,
          minutesDocumentId: docId,
          contentJson: { sections: [{ heading: "Call to Order" }] },
        });

        expect((await readDoc(db, town, docId)).content_json).toEqual({
          sections: [{ heading: "Call to Order" }],
        });
      } finally {
        await app.end();
      }
    });
  });

  it("refuses a caller with no R1 on this board, and writes nothing", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const { docId } = await scene(db, town);
        const actor = await seedActor(db, town, staffOn(town, { R4: true }));
        const caller = appRouter.createCaller(contextFor(db, town, actor));

        const err = await expectTrpcError(() =>
          caller.minutesDocument.saveDraft({
            boardId: town.boardId,
            minutesDocumentId: docId,
            contentJson: { sections: [] },
          }),
        );
        expect(err.code).toBe("FORBIDDEN");
        expect(err.message).toContain("R1");
        expect((await readDoc(db, town, docId)).content_json).toEqual({});
      } finally {
        await app.end();
      }
    });
  });

  it("refuses when the document's meeting is on a different board than the one claimed", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const { docId } = await scene(db, town, {
          board: town.otherBoardId,
          denormalisedBoardId: town.boardId,
        });
        const actor = await seedActor(db, town, staffOn(town, { R1: true }));
        const caller = appRouter.createCaller(contextFor(db, town, actor));

        const err = await expectTrpcError(() =>
          caller.minutesDocument.saveDraft({
            boardId: town.boardId,
            minutesDocumentId: docId,
            contentJson: { sections: [] },
          }),
        );
        expect(err.code).toBe("FORBIDDEN");
        expect((await readDoc(db, town, docId)).content_json).toEqual({});
      } finally {
        await app.end();
      }
    });
  });

  it("answers FORBIDDEN, not BAD_REQUEST, when a refused caller's input also fails validation (the reorder pin)", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const actor = await seedActor(db, town, { role: "staff", global: [] });
        const caller = appRouter.createCaller(contextFor(db, town, actor));

        const err = await expectTrpcError(() =>
          caller.minutesDocument.saveDraft({
            boardId: town.boardId,
            minutesDocumentId: "not-a-uuid",
            contentJson: { sections: [] },
          }),
        );
        expect(err.code).toBe("FORBIDDEN");
      } finally {
        await app.end();
      }
    });
  });

  it("answers NOT_FOUND for a document in another town, and leaves it untouched", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const mine = await seedTown(db, "Newcastle");
        const theirs = await seedTown(db, "Bristol");
        const there = await scene(db, theirs);
        const actor = await seedActor(db, mine, staffOn(mine, { R1: true }));
        const caller = appRouter.createCaller(contextFor(db, mine, actor));

        const err = await expectTrpcError(() =>
          caller.minutesDocument.saveDraft({
            boardId: mine.boardId,
            minutesDocumentId: there.docId,
            contentJson: { sections: [{ heading: "injected" }] },
          }),
        );
        expect(err.code).toBe("NOT_FOUND");
        expect((await readDoc(db, theirs, there.docId)).content_json).toEqual({});
      } finally {
        await app.end();
      }
    });
  });

  it("answers CONFLICT for minutes that are already approved — the ADDED lock", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const { docId } = await scene(db, town, { status: "approved" });
        const actor = await seedActor(db, town, staffOn(town, { R1: true }));
        const caller = appRouter.createCaller(contextFor(db, town, actor));

        const err = await expectTrpcError(() =>
          caller.minutesDocument.saveDraft({
            boardId: town.boardId,
            minutesDocumentId: docId,
            contentJson: { sections: [{ heading: "rewritten" }] },
          }),
        );
        expect(err.code).toBe("CONFLICT");
        expect((await readDoc(db, town, docId)).content_json).toEqual({});
      } finally {
        await app.end();
      }
    });
  });
});

describe("minutesDocument.submitForReview", () => {
  it("moves a draft to review and queues minutes_review carrying board_id", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const { docId } = await scene(db, town);
        const actor = await seedActor(db, town, staffOn(town, { R3: true }));
        const caller = appRouter.createCaller(contextFor(db, town, actor));

        await caller.minutesDocument.submitForReview({
          boardId: town.boardId,
          minutesDocumentId: docId,
        });

        const doc = await readDoc(db, town, docId);
        expect(doc.status).toBe("review");
        expect(doc.submitted_for_review_at).not.toBeNull();

        const events = await readEvents(db, town);
        expect(events).toHaveLength(1);
        expect(events[0]?.event_type).toBe("minutes_review");
        // Not cosmetic: getSubscribersForEvent returns NOBODY without it.
        expect(events[0]?.payload).toMatchObject({
          board_id: town.boardId,
          minutes_document_id: docId,
        });
      } finally {
        await app.end();
      }
    });
  });

  it("stamps resubmitted_at on an open amendment round", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const { docId } = await scene(db, town);
        await inTown(db, town, async (tx) => {
          await tx.execute(sql`
            UPDATE minutes_document
               SET amendments_history = ${JSON.stringify([
                 {
                   round: 1,
                   returned_at: "2026-01-01T00:00:00.000Z",
                   reason: "Fix the vote tally",
                   returned_by: randomUUID(),
                   resubmitted_at: null,
                 },
               ])}::jsonb
             WHERE id = ${docId}
          `);
        });
        const actor = await seedActor(db, town, staffOn(town, { R3: true }));
        const caller = appRouter.createCaller(contextFor(db, town, actor));

        await caller.minutesDocument.submitForReview({
          boardId: town.boardId,
          minutesDocumentId: docId,
        });

        const history = (await readDoc(db, town, docId)).amendments_history as Array<{
          round: number;
          resubmitted_at: string | null;
        }>;
        expect(history).toHaveLength(1);
        expect(history[0]?.round).toBe(1);
        expect(history[0]?.resubmitted_at).not.toBeNull();
      } finally {
        await app.end();
      }
    });
  });

  it("refuses a caller with no R3 on this board, and changes nothing", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const { docId } = await scene(db, town);
        const actor = await seedActor(db, town, staffOn(town, { R1: true }));
        const caller = appRouter.createCaller(contextFor(db, town, actor));

        const err = await expectTrpcError(() =>
          caller.minutesDocument.submitForReview({
            boardId: town.boardId,
            minutesDocumentId: docId,
          }),
        );
        expect(err.code).toBe("FORBIDDEN");
        expect(err.message).toContain("R3");
        expect((await readDoc(db, town, docId)).status).toBe("draft");
        expect(await readEvents(db, town)).toEqual([]);
      } finally {
        await app.end();
      }
    });
  });

  it("refuses when the document's meeting is on a different board than the one claimed", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const { docId } = await scene(db, town, { board: town.otherBoardId });
        const actor = await seedActor(db, town, staffOn(town, { R3: true }));
        const caller = appRouter.createCaller(contextFor(db, town, actor));

        const err = await expectTrpcError(() =>
          caller.minutesDocument.submitForReview({
            boardId: town.boardId,
            minutesDocumentId: docId,
          }),
        );
        expect(err.code).toBe("FORBIDDEN");
        expect((await readDoc(db, town, docId)).status).toBe("draft");
      } finally {
        await app.end();
      }
    });
  });

  it("answers FORBIDDEN, not BAD_REQUEST, when a refused caller's input also fails validation (the reorder pin)", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const actor = await seedActor(db, town, { role: "staff", global: [] });
        const caller = appRouter.createCaller(contextFor(db, town, actor));

        const err = await expectTrpcError(() =>
          caller.minutesDocument.submitForReview({
            boardId: town.boardId,
            minutesDocumentId: "not-a-uuid",
          }),
        );
        expect(err.code).toBe("FORBIDDEN");
      } finally {
        await app.end();
      }
    });
  });

  it("answers NOT_FOUND for a document in another town, and leaves it untouched", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const mine = await seedTown(db, "Newcastle");
        const theirs = await seedTown(db, "Bristol");
        const there = await scene(db, theirs);
        const actor = await seedActor(db, mine, staffOn(mine, { R3: true }));
        const caller = appRouter.createCaller(contextFor(db, mine, actor));

        const err = await expectTrpcError(() =>
          caller.minutesDocument.submitForReview({
            boardId: mine.boardId,
            minutesDocumentId: there.docId,
          }),
        );
        expect(err.code).toBe("NOT_FOUND");
        expect((await readDoc(db, theirs, there.docId)).status).toBe("draft");
      } finally {
        await app.end();
      }
    });
  });

  it("answers CONFLICT for minutes already under review", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const { docId } = await scene(db, town, { status: "review" });
        const actor = await seedActor(db, town, staffOn(town, { R3: true }));
        const caller = appRouter.createCaller(contextFor(db, town, actor));

        const err = await expectTrpcError(() =>
          caller.minutesDocument.submitForReview({
            boardId: town.boardId,
            minutesDocumentId: docId,
          }),
        );
        expect(err.code).toBe("CONFLICT");
        expect(await readEvents(db, town)).toEqual([]);
      } finally {
        await app.end();
      }
    });
  });
});

describe("minutesDocument.approve", () => {
  it("adopts minutes under review and queues minutes_approved carrying board_id", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const { docId } = await scene(db, town, { status: "review" });
        const actor = await seedActor(db, town, { role: "admin" });
        const caller = appRouter.createCaller(contextFor(db, town, actor));

        await caller.minutesDocument.approve({ minutesDocumentId: docId });

        const doc = await readDoc(db, town, docId);
        expect(doc.status).toBe("approved");
        expect(doc.approved_at).not.toBeNull();

        const events = await readEvents(db, town);
        expect(events).toHaveLength(1);
        expect(events[0]?.event_type).toBe("minutes_approved");
        expect(events[0]?.payload).toMatchObject({
          board_id: town.boardId,
          minutes_document_id: docId,
        });
      } finally {
        await app.end();
      }
    });
  });

  it("refuses a staff caller holding every minutes code — adoption is not delegable today", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const { docId } = await scene(db, town, { status: "review" });
        const actor = await seedActor(
          db,
          town,
          staffOn(town, { R1: true, R2: true, R3: true, R4: true, R5: true, R6: true }),
        );
        const caller = appRouter.createCaller(contextFor(db, town, actor));

        const err = await expectTrpcError(() =>
          caller.minutesDocument.approve({ minutesDocumentId: docId }),
        );
        expect(err.code).toBe("FORBIDDEN");
        expect(err.message).toContain("administrator");
        expect((await readDoc(db, town, docId)).status).toBe("review");
        expect(await readEvents(db, town)).toEqual([]);
      } finally {
        await app.end();
      }
    });
  });

  it("adopts a document on ANY board, because the guard authorizes no board at all", async () => {
    // The board-mismatch case every board-scoped mutation above carries has no
    // analogue here: `requireActor` takes no board, the input has no `boardId`
    // to claim, and an administrator's authority is town-wide. This is the
    // positive statement of that — the same admin, a document on the OTHER
    // board, no boardId anywhere, allowed. `assertMinutesDocumentOnAuthorizedBoard`
    // would throw a wiring Error here; `resolveMinutesDocumentScope` is what
    // this procedure calls, and this test is what says so.
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const { docId } = await scene(db, town, {
          board: town.otherBoardId,
          status: "review",
        });
        const actor = await seedActor(db, town, { role: "admin" });
        const caller = appRouter.createCaller(contextFor(db, town, actor));

        await caller.minutesDocument.approve({ minutesDocumentId: docId });
        expect((await readDoc(db, town, docId)).status).toBe("approved");
      } finally {
        await app.end();
      }
    });
  });

  it("answers FORBIDDEN, not BAD_REQUEST, when a refused caller's input also fails validation (the reorder pin)", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const actor = await seedActor(db, town, { role: "staff", global: [] });
        const caller = appRouter.createCaller(contextFor(db, town, actor));

        const err = await expectTrpcError(() =>
          caller.minutesDocument.approve({ minutesDocumentId: "not-a-uuid" }),
        );
        expect(err.code).toBe("FORBIDDEN");
      } finally {
        await app.end();
      }
    });
  });

  it("answers NOT_FOUND for a document in another town, and leaves it untouched", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const mine = await seedTown(db, "Newcastle");
        const theirs = await seedTown(db, "Bristol");
        const there = await scene(db, theirs, { status: "review" });
        const actor = await seedActor(db, mine, { role: "admin" });
        const caller = appRouter.createCaller(contextFor(db, mine, actor));

        const err = await expectTrpcError(() =>
          caller.minutesDocument.approve({ minutesDocumentId: there.docId }),
        );
        expect(err.code).toBe("NOT_FOUND");
        expect((await readDoc(db, theirs, there.docId)).status).toBe("review");
      } finally {
        await app.end();
      }
    });
  });

  it("answers CONFLICT for a document still in draft", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const { docId } = await scene(db, town);
        const actor = await seedActor(db, town, { role: "admin" });
        const caller = appRouter.createCaller(contextFor(db, town, actor));

        const err = await expectTrpcError(() =>
          caller.minutesDocument.approve({ minutesDocumentId: docId }),
        );
        expect(err.code).toBe("CONFLICT");
        expect(await readEvents(db, town)).toEqual([]);
      } finally {
        await app.end();
      }
    });
  });
});

describe("minutesDocument.publish", () => {
  it("publishes approved minutes for a caller holding R5, and queues minutes_published", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const { docId } = await scene(db, town, { status: "approved" });
        const actor = await seedActor(db, town, staffOn(town, { R5: true }));
        const caller = appRouter.createCaller(contextFor(db, town, actor));

        await caller.minutesDocument.publish({
          boardId: town.boardId,
          minutesDocumentId: docId,
        });

        const doc = await readDoc(db, town, docId);
        expect(doc.status).toBe("published");
        expect(doc.published_at).not.toBeNull();

        const events = await readEvents(db, town);
        expect(events).toHaveLength(1);
        expect(events[0]?.event_type).toBe("minutes_published");
        expect(events[0]?.payload).toMatchObject({
          board_id: town.boardId,
          minutes_document_id: docId,
        });
      } finally {
        await app.end();
      }
    });
  });

  it("REFUSES a recording secretary — R1 without R5, the actor rule 13a exists for", async () => {
    // The whole reason rule 13a is written before any screen is wired. This
    // actor is TEMPLATE_RECORDING_SECRETARY's exact code set, granted per board
    // with nothing global — the shape that template really produces. If this
    // procedure's guard were `R1` (the nearest existing minutes-write rule,
    // `assertCanUpdateMinutesDocument`), every other test in this file would
    // still pass and this caller would have the public portal.
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const { docId } = await scene(db, town, { status: "approved" });
        const actor = await seedActor(db, town, recordingSecretary(town));
        const caller = appRouter.createCaller(contextFor(db, town, actor));

        const err = await expectTrpcError(() =>
          caller.minutesDocument.publish({
            boardId: town.boardId,
            minutesDocumentId: docId,
          }),
        );
        expect(err.code).toBe("FORBIDDEN");
        expect(err.message).toContain("R5");
        expect((await readDoc(db, town, docId)).status).toBe("approved");
        expect(await readEvents(db, town)).toEqual([]);
      } finally {
        await app.end();
      }
    });
  });

  it("refuses a caller with no R5 on this board, and publishes nothing", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const { docId } = await scene(db, town, { status: "approved" });
        const actor = await seedActor(db, town, { role: "staff", global: [] });
        const caller = appRouter.createCaller(contextFor(db, town, actor));

        const err = await expectTrpcError(() =>
          caller.minutesDocument.publish({
            boardId: town.boardId,
            minutesDocumentId: docId,
          }),
        );
        expect(err.code).toBe("FORBIDDEN");
        expect((await readDoc(db, town, docId)).status).toBe("approved");
      } finally {
        await app.end();
      }
    });
  });

  it("refuses when the document's meeting is on a different board than the one claimed", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        // `minutes_document.board_id` says `boardId`, the MEETING says
        // `otherBoardId`. A derivation reading the denormalised column would
        // allow this; the join through `meeting.board_id` refuses it.
        const { docId } = await scene(db, town, {
          board: town.otherBoardId,
          denormalisedBoardId: town.boardId,
          status: "approved",
        });
        const actor = await seedActor(db, town, staffOn(town, { R5: true }));
        const caller = appRouter.createCaller(contextFor(db, town, actor));

        const err = await expectTrpcError(() =>
          caller.minutesDocument.publish({
            boardId: town.boardId,
            minutesDocumentId: docId,
          }),
        );
        expect(err.code).toBe("FORBIDDEN");
        expect((await readDoc(db, town, docId)).status).toBe("approved");
      } finally {
        await app.end();
      }
    });
  });

  it("answers FORBIDDEN, not BAD_REQUEST, when a refused caller's input also fails validation (the reorder pin)", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const actor = await seedActor(db, town, { role: "staff", global: [] });
        const caller = appRouter.createCaller(contextFor(db, town, actor));

        const err = await expectTrpcError(() =>
          caller.minutesDocument.publish({
            boardId: town.boardId,
            minutesDocumentId: "not-a-uuid",
          }),
        );
        expect(err.code).toBe("FORBIDDEN");
      } finally {
        await app.end();
      }
    });
  });

  it("answers NOT_FOUND for a document in another town, and does not publish it", async () => {
    // The FK-bypasses-RLS hazard at its worst: remove the existence check in
    // `resolveMinutesDocumentScope` and this UPDATE succeeds silently, putting
    // ANOTHER TOWN'S minutes on the public portal.
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const mine = await seedTown(db, "Newcastle");
        const theirs = await seedTown(db, "Bristol");
        const there = await scene(db, theirs, { status: "approved" });
        const actor = await seedActor(db, mine, staffOn(mine, { R5: true }));
        const caller = appRouter.createCaller(contextFor(db, mine, actor));

        const err = await expectTrpcError(() =>
          caller.minutesDocument.publish({
            boardId: mine.boardId,
            minutesDocumentId: there.docId,
          }),
        );
        expect(err.code).toBe("NOT_FOUND");
        const doc = await readDoc(db, theirs, there.docId);
        expect(doc.status).toBe("approved");
        expect(doc.published_at).toBeNull();
      } finally {
        await app.end();
      }
    });
  });

  it("answers CONFLICT for a draft — an unadopted record must not reach the portal", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const { docId } = await scene(db, town);
        const actor = await seedActor(db, town, staffOn(town, { R5: true }));
        const caller = appRouter.createCaller(contextFor(db, town, actor));

        const err = await expectTrpcError(() =>
          caller.minutesDocument.publish({
            boardId: town.boardId,
            minutesDocumentId: docId,
          }),
        );
        expect(err.code).toBe("CONFLICT");
        expect((await readDoc(db, town, docId)).status).toBe("draft");
      } finally {
        await app.end();
      }
    });
  });
});

describe("minutesDocument.returnForAmendments", () => {
  it("returns minutes to draft and records the round", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const { docId } = await scene(db, town, { status: "review" });
        await inTown(db, town, async (tx) => {
          await tx.execute(
            sql`UPDATE minutes_document SET submitted_for_review_at = now() WHERE id = ${docId}`,
          );
        });
        const actor = await seedActor(db, town, { role: "admin" });
        const caller = appRouter.createCaller(contextFor(db, town, actor));

        await caller.minutesDocument.returnForAmendments({
          minutesDocumentId: docId,
          reason: "The vote tally on item 4 is wrong",
        });

        const doc = await readDoc(db, town, docId);
        expect(doc.status).toBe("draft");
        expect(doc.submitted_for_review_at).toBeNull();
        expect(doc.amendments_history).toEqual([
          {
            round: 1,
            returned_at: expect.any(String),
            reason: "The vote tally on item 4 is wrong",
            returned_by: actor.userAccountId,
            resubmitted_at: null,
          },
        ]);
      } finally {
        await app.end();
      }
    });
  });

  it("refuses a staff caller holding every minutes code", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const { docId } = await scene(db, town, { status: "review" });
        const actor = await seedActor(
          db,
          town,
          staffOn(town, { R1: true, R2: true, R3: true, R4: true, R5: true, R6: true }),
        );
        const caller = appRouter.createCaller(contextFor(db, town, actor));

        const err = await expectTrpcError(() =>
          caller.minutesDocument.returnForAmendments({
            minutesDocumentId: docId,
            reason: "No",
          }),
        );
        expect(err.code).toBe("FORBIDDEN");
        expect((await readDoc(db, town, docId)).status).toBe("review");
      } finally {
        await app.end();
      }
    });
  });

  it("answers FORBIDDEN, not BAD_REQUEST, when a refused caller's input also fails validation (the reorder pin)", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const actor = await seedActor(db, town, { role: "staff", global: [] });
        const caller = appRouter.createCaller(contextFor(db, town, actor));

        const err = await expectTrpcError(() =>
          caller.minutesDocument.returnForAmendments({
            minutesDocumentId: "not-a-uuid",
            reason: "",
          }),
        );
        expect(err.code).toBe("FORBIDDEN");
      } finally {
        await app.end();
      }
    });
  });

  it("answers NOT_FOUND for a document in another town, and leaves it untouched", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const mine = await seedTown(db, "Newcastle");
        const theirs = await seedTown(db, "Bristol");
        const there = await scene(db, theirs, { status: "review" });
        const actor = await seedActor(db, mine, { role: "admin" });
        const caller = appRouter.createCaller(contextFor(db, mine, actor));

        const err = await expectTrpcError(() =>
          caller.minutesDocument.returnForAmendments({
            minutesDocumentId: there.docId,
            reason: "Not mine to return",
          }),
        );
        expect(err.code).toBe("NOT_FOUND");
        const doc = await readDoc(db, theirs, there.docId);
        expect(doc.status).toBe("review");
        expect(doc.amendments_history).toEqual([]);
      } finally {
        await app.end();
      }
    });
  });

  it("answers CONFLICT for a document that is not under review", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const { docId } = await scene(db, town);
        const actor = await seedActor(db, town, { role: "admin" });
        const caller = appRouter.createCaller(contextFor(db, town, actor));

        const err = await expectTrpcError(() =>
          caller.minutesDocument.returnForAmendments({
            minutesDocumentId: docId,
            reason: "Too early",
          }),
        );
        expect(err.code).toBe("CONFLICT");
        expect((await readDoc(db, town, docId)).amendments_history).toEqual([]);
      } finally {
        await app.end();
      }
    });
  });
});

describe("minutesDocument.unpublish", () => {
  it("takes published minutes off the portal for a caller holding R5, leaving the adoption intact", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const { docId } = await scene(db, town, { status: "published" });
        await inTown(db, town, async (tx) => {
          await tx.execute(
            sql`UPDATE minutes_document SET approved_at = now(), published_at = now() WHERE id = ${docId}`,
          );
        });
        const actor = await seedActor(db, town, staffOn(town, { R5: true }));
        const caller = appRouter.createCaller(contextFor(db, town, actor));

        await caller.minutesDocument.unpublish({
          boardId: town.boardId,
          minutesDocumentId: docId,
        });

        const doc = await readDoc(db, town, docId);
        expect(doc.status).toBe("approved");
        expect(doc.published_at).toBeNull();
        expect(doc.approved_at).not.toBeNull();
      } finally {
        await app.end();
      }
    });
  });

  it("refuses a caller with no R5 on this board, and leaves the minutes published", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const { docId } = await scene(db, town, { status: "published" });
        const actor = await seedActor(db, town, recordingSecretary(town));
        const caller = appRouter.createCaller(contextFor(db, town, actor));

        const err = await expectTrpcError(() =>
          caller.minutesDocument.unpublish({
            boardId: town.boardId,
            minutesDocumentId: docId,
          }),
        );
        expect(err.code).toBe("FORBIDDEN");
        expect(err.message).toContain("R5");
        expect((await readDoc(db, town, docId)).status).toBe("published");
      } finally {
        await app.end();
      }
    });
  });

  it("refuses when the document's meeting is on a different board than the one claimed", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const { docId } = await scene(db, town, {
          board: town.otherBoardId,
          denormalisedBoardId: town.boardId,
          status: "published",
        });
        const actor = await seedActor(db, town, staffOn(town, { R5: true }));
        const caller = appRouter.createCaller(contextFor(db, town, actor));

        const err = await expectTrpcError(() =>
          caller.minutesDocument.unpublish({
            boardId: town.boardId,
            minutesDocumentId: docId,
          }),
        );
        expect(err.code).toBe("FORBIDDEN");
        expect((await readDoc(db, town, docId)).status).toBe("published");
      } finally {
        await app.end();
      }
    });
  });

  it("answers FORBIDDEN, not BAD_REQUEST, when a refused caller's input also fails validation (the reorder pin)", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const actor = await seedActor(db, town, { role: "staff", global: [] });
        const caller = appRouter.createCaller(contextFor(db, town, actor));

        const err = await expectTrpcError(() =>
          caller.minutesDocument.unpublish({
            boardId: town.boardId,
            minutesDocumentId: "not-a-uuid",
          }),
        );
        expect(err.code).toBe("FORBIDDEN");
      } finally {
        await app.end();
      }
    });
  });

  it("answers NOT_FOUND for a document in another town, and leaves it published", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const mine = await seedTown(db, "Newcastle");
        const theirs = await seedTown(db, "Bristol");
        const there = await scene(db, theirs, { status: "published" });
        const actor = await seedActor(db, mine, staffOn(mine, { R5: true }));
        const caller = appRouter.createCaller(contextFor(db, mine, actor));

        const err = await expectTrpcError(() =>
          caller.minutesDocument.unpublish({
            boardId: mine.boardId,
            minutesDocumentId: there.docId,
          }),
        );
        expect(err.code).toBe("NOT_FOUND");
        expect((await readDoc(db, theirs, there.docId)).status).toBe("published");
      } finally {
        await app.end();
      }
    });
  });

  it("answers CONFLICT for minutes that are only approved", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const { docId } = await scene(db, town, { status: "approved" });
        const actor = await seedActor(db, town, staffOn(town, { R5: true }));
        const caller = appRouter.createCaller(contextFor(db, town, actor));

        const err = await expectTrpcError(() =>
          caller.minutesDocument.unpublish({
            boardId: town.boardId,
            minutesDocumentId: docId,
          }),
        );
        expect(err.code).toBe("CONFLICT");
        expect((await readDoc(db, town, docId)).status).toBe("approved");
      } finally {
        await app.end();
      }
    });
  });
});
