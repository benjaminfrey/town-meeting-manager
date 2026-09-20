/**
 * The `voteRecord` router — Phase E, wave 5, Task 3.
 *
 * This file carries one claim no other router test in this phase can:
 * `voteRecord.insert` is guarded by TWO things that are not the same check —
 * a synchronous necessary condition in middleware
 * (`assertCouldRecordAVote`, declared before `.input()` so a refusal beats a
 * parse error and so `ctx.authorizedBoardId` gets set) and the real,
 * `async`, `TenantTx`-taking rule in the resolver
 * (`assertCanInsertVoteRecord`, rule 5). See `routers/vote-record.ts`'s header
 * for why, and what it costs.
 *
 * **The test that makes that arrangement honest** is "refuses a board member
 * recording SOMEBODY ELSE'S vote": that caller PASSES the middleware (they
 * hold the `board_member` role) and is refused by the resolver. Widen the
 * prefilter and nothing changes; weaken the resolver's call and this goes red.
 * Its sibling, "refuses a board member whose seat is ARCHIVED", covers the
 * other half of rule 5's database question.
 *
 * Everything else is the standard four per procedure — the code, the
 * board-mismatch, the reorder pin, and the FK existence check — plus, for
 * `recordForMotion`, that the OUTCOME is computed here rather than accepted.
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
import { getBoardSubscribers } from "../../../services/notification-service.js";
import {
  seedMeeting,
  seedAgendaItem,
  seedSeat,
  seedMotion,
  seedExecutiveSession,
  seedMinutesDocument,
  readRows,
  captureRealtimeEvents,
} from "./live-fixtures.js";

interface VoteRow {
  id: string;
  motion_id: string;
  board_member_id: string;
  vote: string;
  recusal_reason: string | null;
}

function readVotes(db: TestDb, town: TownFixture, motionId: string): Promise<VoteRow[]> {
  return readRows<VoteRow>(
    db,
    town,
    sql`SELECT id, motion_id, board_member_id, vote::text AS vote, recusal_reason
        FROM vote_record WHERE motion_id = ${motionId} ORDER BY board_member_id`,
  );
}

function readMotion(db: TestDb, town: TownFixture, motionId: string) {
  return readRows<{ status: string; vote_summary: Record<string, unknown> | null }>(
    db,
    town,
    sql`SELECT status::text AS status, vote_summary FROM motion WHERE id = ${motionId}`,
  );
}

function clerkSpec(town: TownFixture) {
  return {
    role: "staff" as const,
    global: [],
    boardOverrides: [{ boardId: town.boardId, permissions: { M3: true } }],
  };
}

describe("voteRecord.byMeeting", () => {
  it("returns the meeting's vote records", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const meetingId = await seedMeeting(db, town, town.boardId);
        const itemId = await seedAgendaItem(db, town, meetingId);
        const motionId = await seedMotion(db, town, meetingId, itemId);
        const seat = await seedSeat(db, town, town.boardId);
        const clerk = await seedActor(db, town, clerkSpec(town));
        const caller = appRouter.createCaller(contextFor(db, town, clerk));
        await caller.voteRecord.insert({
          boardId: town.boardId,
          motionId,
          boardMemberId: seat.boardMemberId,
          vote: "yes",
          recusalReason: null,
        });

        const rows = await caller.voteRecord.byMeeting({ meetingId });
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ motion_id: motionId, vote: "yes" });
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
          caller.voteRecord.byMeeting({ meetingId: theirMeeting }),
        );
        expect(err.code).toBe("NOT_FOUND");
      } finally {
        await app.end();
      }
    });
  });
});

describe("voteRecord.insert", () => {
  it("records a vote for a clerk holding M3, and announces it", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const meetingId = await seedMeeting(db, town, town.boardId);
        const itemId = await seedAgendaItem(db, town, meetingId);
        const motionId = await seedMotion(db, town, meetingId, itemId);
        const seat = await seedSeat(db, town, town.boardId);
        const clerk = await seedActor(db, town, clerkSpec(town));
        const caller = appRouter.createCaller(contextFor(db, town, clerk));

        const { topics, events } = await captureRealtimeEvents(client, 1, () =>
          caller.voteRecord.insert({
            boardId: town.boardId,
            motionId,
            boardMemberId: seat.boardMemberId,
            vote: "recusal",
            recusalReason: "owns the abutting parcel",
          }),
        );

        const votes = await readVotes(db, town, motionId);
        expect(votes).toHaveLength(1);
        expect(votes[0]).toMatchObject({
          board_member_id: seat.boardMemberId,
          vote: "recusal",
          recusal_reason: "owns the abutting parcel",
        });
        expect(topics).toEqual(["vote_record"]);
        expect(events[0]?.meetingId).toBe(meetingId);
      } finally {
        await app.end();
      }
    });
  });

  it("lets a board member record their OWN vote with no M3 at all (rule 5's self-vote branch)", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const meetingId = await seedMeeting(db, town, town.boardId);
        const itemId = await seedAgendaItem(db, town, meetingId);
        const motionId = await seedMotion(db, town, meetingId, itemId);
        const member = await seedActor(db, town, { role: "board_member", global: [] });
        const seat = await seedSeat(db, town, town.boardId, { personId: member.personId });
        const caller = appRouter.createCaller(contextFor(db, town, member));

        await caller.voteRecord.insert({
          boardId: town.boardId,
          motionId,
          boardMemberId: seat.boardMemberId,
          vote: "no",
          recusalReason: null,
        });
        expect((await readVotes(db, town, motionId))[0]?.vote).toBe("no");
      } finally {
        await app.end();
      }
    });
  });

  it("refuses a board member recording SOMEBODY ELSE'S vote — the gap between the guard and the rule", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const meetingId = await seedMeeting(db, town, town.boardId);
        const itemId = await seedAgendaItem(db, town, meetingId);
        const motionId = await seedMotion(db, town, meetingId, itemId);
        const member = await seedActor(db, town, { role: "board_member", global: [] });
        await seedSeat(db, town, town.boardId, { personId: member.personId });
        const colleague = await seedSeat(db, town, town.boardId);
        const caller = appRouter.createCaller(contextFor(db, town, member));

        // This caller PASSES `assertCouldRecordAVote` (they hold the
        // board_member role). Only `assertCanInsertVoteRecord`, in the
        // resolver, knows the seat is not theirs.
        const err = await expectTrpcError(() =>
          caller.voteRecord.insert({
            boardId: town.boardId,
            motionId,
            boardMemberId: colleague.boardMemberId,
            vote: "yes",
            recusalReason: null,
          }),
        );
        expect(err.code).toBe("FORBIDDEN");
        expect(await readVotes(db, town, motionId)).toEqual([]);
      } finally {
        await app.end();
      }
    });
  });

  it("refuses a board member whose seat is ARCHIVED", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const meetingId = await seedMeeting(db, town, town.boardId);
        const itemId = await seedAgendaItem(db, town, meetingId);
        const motionId = await seedMotion(db, town, meetingId, itemId);
        const member = await seedActor(db, town, { role: "board_member", global: [] });
        const seat = await seedSeat(db, town, town.boardId, {
          personId: member.personId,
          status: "archived",
        });
        const caller = appRouter.createCaller(contextFor(db, town, member));

        const err = await expectTrpcError(() =>
          caller.voteRecord.insert({
            boardId: town.boardId,
            motionId,
            boardMemberId: seat.boardMemberId,
            vote: "yes",
            recusalReason: null,
          }),
        );
        expect(err.code).toBe("FORBIDDEN");
        expect(await readVotes(db, town, motionId)).toEqual([]);
      } finally {
        await app.end();
      }
    });
  });

  it("refuses staff with no M3 on this board, and creates nothing", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const meetingId = await seedMeeting(db, town, town.boardId);
        const itemId = await seedAgendaItem(db, town, meetingId);
        const motionId = await seedMotion(db, town, meetingId, itemId);
        const seat = await seedSeat(db, town, town.boardId);
        const actor = await seedActor(db, town, { role: "staff", global: [] });
        const caller = appRouter.createCaller(contextFor(db, town, actor));

        const err = await expectTrpcError(() =>
          caller.voteRecord.insert({
            boardId: town.boardId,
            motionId,
            boardMemberId: seat.boardMemberId,
            vote: "yes",
            recusalReason: null,
          }),
        );
        expect(err.code).toBe("FORBIDDEN");
        expect(err.message).toContain("M3");
        expect(await readVotes(db, town, motionId)).toEqual([]);
      } finally {
        await app.end();
      }
    });
  });

  it("refuses when the motion's meeting belongs to a different board than the one claimed", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const theirMeeting = await seedMeeting(db, town, town.otherBoardId);
        const theirItem = await seedAgendaItem(db, town, theirMeeting);
        const theirMotion = await seedMotion(db, town, theirMeeting, theirItem);
        const theirSeat = await seedSeat(db, town, town.otherBoardId);
        const clerk = await seedActor(db, town, clerkSpec(town));
        const caller = appRouter.createCaller(contextFor(db, town, clerk));

        const err = await expectTrpcError(() =>
          caller.voteRecord.insert({
            boardId: town.boardId,
            motionId: theirMotion,
            boardMemberId: theirSeat.boardMemberId,
            vote: "yes",
            recusalReason: null,
          }),
        );
        expect(err.code).toBe("FORBIDDEN");
        expect(await readVotes(db, town, theirMotion)).toEqual([]);
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
          caller.voteRecord.insert({
            boardId: town.boardId,
            motionId: "not-a-uuid" as string,
            boardMemberId: randomUUID(),
            vote: "yes",
            recusalReason: null,
          }),
        );
        expect(err.code).toBe("FORBIDDEN");
      } finally {
        await app.end();
      }
    });
  });

  it("answers NOT_FOUND when the seat is on another town's board, and creates nothing", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const mine = await seedTown(db, "Newcastle");
        const theirs = await seedTown(db, "Bristol");
        const meetingId = await seedMeeting(db, mine, mine.boardId);
        const itemId = await seedAgendaItem(db, mine, meetingId);
        const motionId = await seedMotion(db, mine, meetingId, itemId);
        const foreignSeat = await seedSeat(db, theirs, theirs.boardId);
        const clerk = await seedActor(db, mine, clerkSpec(mine));
        const caller = appRouter.createCaller(contextFor(db, mine, clerk));

        const err = await expectTrpcError(() =>
          caller.voteRecord.insert({
            boardId: mine.boardId,
            motionId,
            boardMemberId: foreignSeat.boardMemberId,
            vote: "yes",
            recusalReason: null,
          }),
        );
        expect(err.code).toBe("NOT_FOUND");
        expect(await readVotes(db, mine, motionId)).toEqual([]);
      } finally {
        await app.end();
      }
    });
  });

  it("answers CONFLICT when the member already has a vote on that motion", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const meetingId = await seedMeeting(db, town, town.boardId);
        const itemId = await seedAgendaItem(db, town, meetingId);
        const motionId = await seedMotion(db, town, meetingId, itemId);
        const seat = await seedSeat(db, town, town.boardId);
        const clerk = await seedActor(db, town, clerkSpec(town));
        const caller = appRouter.createCaller(contextFor(db, town, clerk));

        const args = {
          boardId: town.boardId,
          motionId,
          boardMemberId: seat.boardMemberId,
          vote: "yes" as const,
          recusalReason: null,
        };
        await caller.voteRecord.insert(args);
        const err = await expectTrpcError(() => caller.voteRecord.insert(args));
        expect(err.code).toBe("CONFLICT");
        expect(await readVotes(db, town, motionId)).toHaveLength(1);
      } finally {
        await app.end();
      }
    });
  });

  it("rejects a recusal with no reason", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const meetingId = await seedMeeting(db, town, town.boardId);
        const itemId = await seedAgendaItem(db, town, meetingId);
        const motionId = await seedMotion(db, town, meetingId, itemId);
        const seat = await seedSeat(db, town, town.boardId);
        const clerk = await seedActor(db, town, clerkSpec(town));
        const caller = appRouter.createCaller(contextFor(db, town, clerk));

        const err = await expectTrpcError(() =>
          caller.voteRecord.insert({
            boardId: town.boardId,
            motionId,
            boardMemberId: seat.boardMemberId,
            vote: "recusal",
            recusalReason: "   ",
          }),
        );
        // BAD_REQUEST, not FORBIDDEN: this caller is authorized, the request
        // is not well formed. The reorder pin above is what proves the guard
        // still beats the parser for a caller who is NOT authorized.
        expect(err.code).toBe("BAD_REQUEST");
        expect(await readVotes(db, town, motionId)).toEqual([]);
      } finally {
        await app.end();
      }
    });
  });
});

describe("voteRecord.recordForMotion", () => {
  it("clears the old roll, records the new one, stamps the motion, and announces both tables", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const meetingId = await seedMeeting(db, town, town.boardId);
        const itemId = await seedAgendaItem(db, town, meetingId);
        const motionId = await seedMotion(db, town, meetingId, itemId);
        const a = await seedSeat(db, town, town.boardId);
        const b = await seedSeat(db, town, town.boardId);
        const c = await seedSeat(db, town, town.boardId);
        const clerk = await seedActor(db, town, clerkSpec(town));
        const caller = appRouter.createCaller(contextFor(db, town, clerk));

        // A first, wrong roll — so the DELETE has something to remove and
        // "re-vote replaces" is what the assertions below observe.
        await caller.voteRecord.recordForMotion({
          boardId: town.boardId,
          motionId,
          votes: [
            { boardMemberId: a.boardMemberId, vote: "no", recusalReason: null },
            { boardMemberId: b.boardMemberId, vote: "no", recusalReason: null },
          ],
        });
        expect((await readMotion(db, town, motionId))[0]?.status).toBe("failed");

        const { result, topics } = await captureRealtimeEvents(client, 2, () =>
          caller.voteRecord.recordForMotion({
            boardId: town.boardId,
            motionId,
            votes: [
              { boardMemberId: a.boardMemberId, vote: "yes", recusalReason: null },
              { boardMemberId: b.boardMemberId, vote: "yes", recusalReason: null },
              { boardMemberId: c.boardMemberId, vote: "abstain", recusalReason: null },
            ],
          }),
        );

        expect(result).toMatchObject({ status: "passed", recorded: 3 });
        const votes = await readVotes(db, town, motionId);
        expect(votes).toHaveLength(3);
        const motion = (await readMotion(db, town, motionId))[0];
        expect(motion?.status).toBe("passed");
        // The summary is DERIVED — the caller sent no tally at all.
        expect(motion?.vote_summary).toEqual({
          yeas: 2,
          nays: 0,
          abstentions: 1,
          recusals: 0,
          absent: 0,
          result: "passed",
          passed: true,
        });
        expect(topics).toEqual(["motion", "vote_record"]);
      } finally {
        await app.end();
      }
    });
  });

  it("counts an abstention out of the majority base rather than against the motion", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const meetingId = await seedMeeting(db, town, town.boardId);
        const itemId = await seedAgendaItem(db, town, meetingId);
        const motionId = await seedMotion(db, town, meetingId, itemId);
        const a = await seedSeat(db, town, town.boardId);
        const b = await seedSeat(db, town, town.boardId);
        const clerk = await seedActor(db, town, clerkSpec(town));
        const caller = appRouter.createCaller(contextFor(db, town, clerk));

        // One yea, one abstention: the base is 1, the threshold is 1, so it
        // carries. Counted as a nay it would fail — this is the assertion
        // that the server runs the real rule and not a simpler one.
        const result = await caller.voteRecord.recordForMotion({
          boardId: town.boardId,
          motionId,
          votes: [
            { boardMemberId: a.boardMemberId, vote: "yes", recusalReason: null },
            { boardMemberId: b.boardMemberId, vote: "abstain", recusalReason: null },
          ],
        });
        expect(result.status).toBe("passed");
        expect((await readMotion(db, town, motionId))[0]?.vote_summary).toMatchObject({
          yeas: 1,
          abstentions: 1,
          passed: true,
        });
      } finally {
        await app.end();
      }
    });
  });

  it("refuses a caller with no M3 on this board, and records nothing", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const meetingId = await seedMeeting(db, town, town.boardId);
        const itemId = await seedAgendaItem(db, town, meetingId);
        const motionId = await seedMotion(db, town, meetingId, itemId);
        const seat = await seedSeat(db, town, town.boardId);
        const actor = await seedActor(db, town, { role: "staff", global: [] });
        const caller = appRouter.createCaller(contextFor(db, town, actor));

        const err = await expectTrpcError(() =>
          caller.voteRecord.recordForMotion({
            boardId: town.boardId,
            motionId,
            votes: [{ boardMemberId: seat.boardMemberId, vote: "yes", recusalReason: null }],
          }),
        );
        expect(err.code).toBe("FORBIDDEN");
        expect(await readVotes(db, town, motionId)).toEqual([]);
        expect((await readMotion(db, town, motionId))[0]?.status).toBe("seconded");
      } finally {
        await app.end();
      }
    });
  });

  it("refuses a board member acting on their OWN seat — this procedure is M3 only", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const meetingId = await seedMeeting(db, town, town.boardId);
        const itemId = await seedAgendaItem(db, town, meetingId);
        const motionId = await seedMotion(db, town, meetingId, itemId);
        const member = await seedActor(db, town, { role: "board_member", global: [] });
        const seat = await seedSeat(db, town, town.boardId, { personId: member.personId });
        const caller = appRouter.createCaller(contextFor(db, town, member));

        // `insert` would allow this exact caller on this exact seat. This
        // procedure deletes EVERY vote on the motion first, so rule 6a gives
        // it no self-vote branch — `rules.ts` says so in as many words.
        const err = await expectTrpcError(() =>
          caller.voteRecord.recordForMotion({
            boardId: town.boardId,
            motionId,
            votes: [{ boardMemberId: seat.boardMemberId, vote: "yes", recusalReason: null }],
          }),
        );
        expect(err.code).toBe("FORBIDDEN");
        expect(await readVotes(db, town, motionId)).toEqual([]);
      } finally {
        await app.end();
      }
    });
  });

  it("refuses when the motion's meeting belongs to a different board than the one claimed", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const theirMeeting = await seedMeeting(db, town, town.otherBoardId);
        const theirItem = await seedAgendaItem(db, town, theirMeeting);
        const theirMotion = await seedMotion(db, town, theirMeeting, theirItem);
        const theirSeat = await seedSeat(db, town, town.otherBoardId);
        const clerk = await seedActor(db, town, clerkSpec(town));
        const caller = appRouter.createCaller(contextFor(db, town, clerk));

        const err = await expectTrpcError(() =>
          caller.voteRecord.recordForMotion({
            boardId: town.boardId,
            motionId: theirMotion,
            votes: [{ boardMemberId: theirSeat.boardMemberId, vote: "yes", recusalReason: null }],
          }),
        );
        expect(err.code).toBe("FORBIDDEN");
        expect(await readVotes(db, town, theirMotion)).toEqual([]);
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
          caller.voteRecord.recordForMotion({
            boardId: town.boardId,
            motionId: randomUUID(),
            // Empty — fails `min(1)`.
            votes: [],
          }),
        );
        expect(err.code).toBe("FORBIDDEN");
      } finally {
        await app.end();
      }
    });
  });

  it("answers NOT_FOUND when any seat in the roll is on another town's board, and records nothing", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const mine = await seedTown(db, "Newcastle");
        const theirs = await seedTown(db, "Bristol");
        const meetingId = await seedMeeting(db, mine, mine.boardId);
        const itemId = await seedAgendaItem(db, mine, meetingId);
        const motionId = await seedMotion(db, mine, meetingId, itemId);
        const ourSeat = await seedSeat(db, mine, mine.boardId);
        const foreignSeat = await seedSeat(db, theirs, theirs.boardId);
        const clerk = await seedActor(db, mine, clerkSpec(mine));
        const caller = appRouter.createCaller(contextFor(db, mine, clerk));

        // The many-row form of the FK existence check: one good id and one
        // foreign one, so a `SELECT DISTINCT` over the board would have seen
        // nothing wrong. The ROW COUNT is what catches it.
        const err = await expectTrpcError(() =>
          caller.voteRecord.recordForMotion({
            boardId: mine.boardId,
            motionId,
            votes: [
              { boardMemberId: ourSeat.boardMemberId, vote: "yes", recusalReason: null },
              { boardMemberId: foreignSeat.boardMemberId, vote: "yes", recusalReason: null },
            ],
          }),
        );
        expect(err.code).toBe("NOT_FOUND");
        expect(await readVotes(db, mine, motionId)).toEqual([]);
      } finally {
        await app.end();
      }
    });
  });

  it("rejects a roll naming the same member twice", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const meetingId = await seedMeeting(db, town, town.boardId);
        const itemId = await seedAgendaItem(db, town, meetingId);
        const motionId = await seedMotion(db, town, meetingId, itemId);
        const seat = await seedSeat(db, town, town.boardId);
        const clerk = await seedActor(db, town, clerkSpec(town));
        const caller = appRouter.createCaller(contextFor(db, town, clerk));

        const err = await expectTrpcError(() =>
          caller.voteRecord.recordForMotion({
            boardId: town.boardId,
            motionId,
            votes: [
              { boardMemberId: seat.boardMemberId, vote: "yes", recusalReason: null },
              { boardMemberId: seat.boardMemberId, vote: "no", recusalReason: null },
            ],
          }),
        );
        expect(err.code).toBe("BAD_REQUEST");
        expect(await readVotes(db, town, motionId)).toEqual([]);
      } finally {
        await app.end();
      }
    });
  });
});

/**
 * The consequences of a motion's outcome — Phase E, wave 5, Task 5.
 *
 * These are `routes/meetings.$meetingId.live.tsx`'s four reactive `useEffect`s,
 * moved into the transaction that decides the outcome. See
 * `recordForMotion`'s doc comment for why they moved rather than becoming
 * idempotent procedures the clients each call.
 *
 * **Every one of them is proved with TWO CONCURRENT CALLERS, on two separate
 * database connections, not one.** A single-caller test says nothing about the
 * race this task exists to close: the harm was never "the write happens", it
 * was "the write happens once per connected device". `concurrently` below runs
 * both calls with `Promise.all` against two `connectAsAppRole` handles, so they
 * really are two backends contending for the same rows, and each assertion is
 * on the COUNT of what landed.
 */

/** Two callers, two connections, one `Promise.all`. */
async function concurrently<T>(
  client: Parameters<typeof connectAsAppRole>[0],
  town: TownFixture,
  seeded: { personId: string; userAccountId: string },
  call: (caller: ReturnType<typeof appRouter.createCaller>) => Promise<T>,
): Promise<PromiseSettledResult<T>[]> {
  const [one, two] = await Promise.all([connectAsAppRole(client), connectAsAppRole(client)]);
  try {
    return await Promise.allSettled([
      call(appRouter.createCaller(contextFor(testDb(one), town, seeded))),
      call(appRouter.createCaller(contextFor(testDb(two), town, seeded))),
    ]);
  } finally {
    await Promise.all([one.end(), two.end()]);
  }
}

function fulfilled<T>(results: PromiseSettledResult<T>[]): T[] {
  for (const r of results) {
    if (r.status === "rejected") throw r.reason as Error;
  }
  return results.map((r) => (r as PromiseFulfilledResult<T>).value);
}

describe("voteRecord.recordForMotion — the executive-session consequence", () => {
  it("stamps entered_at when the entry motion carries, and announces executive_session", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const meetingId = await seedMeeting(db, town, town.boardId);
        const itemId = await seedAgendaItem(db, town, meetingId);
        const motionId = await seedMotion(db, town, meetingId, itemId, {
          text: "to enter Executive Session",
        });
        const sessionId = await seedExecutiveSession(db, town, meetingId, {
          agendaItemId: itemId,
          entryMotionId: motionId,
        });
        const seat = await seedSeat(db, town, town.boardId);
        const clerk = await seedActor(db, town, clerkSpec(town));
        const caller = appRouter.createCaller(contextFor(db, town, clerk));

        const { result, topics } = await captureRealtimeEvents(client, 3, () =>
          caller.voteRecord.recordForMotion({
            boardId: town.boardId,
            motionId,
            votes: [{ boardMemberId: seat.boardMemberId, vote: "yes", recusalReason: null }],
          }),
        );

        expect(result.executiveSession).toBe("entered");
        expect(topics).toEqual(["executive_session", "motion", "vote_record"]);
        const rows = await readRows<{ entered_at: string | null }>(
          db,
          town,
          sql`SELECT entered_at FROM executive_session WHERE id = ${sessionId}`,
        );
        expect(rows[0]?.entered_at).not.toBeNull();
      } finally {
        await app.end();
      }
    });
  });

  it("discards the pending session when the entry motion fails", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const meetingId = await seedMeeting(db, town, town.boardId);
        const itemId = await seedAgendaItem(db, town, meetingId);
        const motionId = await seedMotion(db, town, meetingId, itemId);
        const sessionId = await seedExecutiveSession(db, town, meetingId, {
          agendaItemId: itemId,
          entryMotionId: motionId,
        });
        const a = await seedSeat(db, town, town.boardId);
        const b = await seedSeat(db, town, town.boardId);
        const clerk = await seedActor(db, town, clerkSpec(town));
        const caller = appRouter.createCaller(contextFor(db, town, clerk));

        const result = await caller.voteRecord.recordForMotion({
          boardId: town.boardId,
          motionId,
          votes: [
            { boardMemberId: a.boardMemberId, vote: "no", recusalReason: null },
            { boardMemberId: b.boardMemberId, vote: "no", recusalReason: null },
          ],
        });

        expect(result.status).toBe("failed");
        expect(result.executiveSession).toBe("discarded");
        const rows = await readRows<{ id: string }>(
          db,
          town,
          sql`SELECT id FROM executive_session WHERE id = ${sessionId}`,
        );
        expect(rows).toEqual([]);
      } finally {
        await app.end();
      }
    });
  });

  it("leaves a session that has ALREADY BEGUN alone when a later motion fails", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const meetingId = await seedMeeting(db, town, town.boardId);
        const itemId = await seedAgendaItem(db, town, meetingId);
        const motionId = await seedMotion(db, town, meetingId, itemId);
        // Entered already — the minute of a closed session the board really
        // held. `executiveSession.discard`'s own CONFLICT precondition says
        // this row must never be removed; the folded path says the same thing
        // with `entered_at IS NULL` in its WHERE.
        const sessionId = await seedExecutiveSession(db, town, meetingId, {
          agendaItemId: itemId,
          entryMotionId: motionId,
          enteredAt: true,
        });
        const a = await seedSeat(db, town, town.boardId);
        const b = await seedSeat(db, town, town.boardId);
        const clerk = await seedActor(db, town, clerkSpec(town));
        const caller = appRouter.createCaller(contextFor(db, town, clerk));

        const result = await caller.voteRecord.recordForMotion({
          boardId: town.boardId,
          motionId,
          votes: [
            { boardMemberId: a.boardMemberId, vote: "no", recusalReason: null },
            { boardMemberId: b.boardMemberId, vote: "no", recusalReason: null },
          ],
        });

        expect(result.executiveSession).toBeNull();
        const rows = await readRows<{ id: string }>(
          db,
          town,
          sql`SELECT id FROM executive_session WHERE id = ${sessionId}`,
        );
        expect(rows).toHaveLength(1);
      } finally {
        await app.end();
      }
    });
  });

  it("stamps entered_at ONCE under two concurrent callers", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      const db = testDb(app);
      const town = await seedTown(db);
      const meetingId = await seedMeeting(db, town, town.boardId);
      const itemId = await seedAgendaItem(db, town, meetingId);
      const motionId = await seedMotion(db, town, meetingId, itemId);
      await seedExecutiveSession(db, town, meetingId, {
        agendaItemId: itemId,
        entryMotionId: motionId,
      });
      const seat = await seedSeat(db, town, town.boardId);
      const clerk = await seedActor(db, town, clerkSpec(town));

      try {
        const results = await concurrently(client, town, clerk, (caller) =>
          caller.voteRecord.recordForMotion({
            boardId: town.boardId,
            motionId,
            votes: [{ boardMemberId: seat.boardMemberId, vote: "yes", recusalReason: null }],
          }),
        );

        // Both calls succeed — recording the roll twice is legitimate. Only
        // ONE of them reports having moved the board into closed session.
        const outcomes = fulfilled(results).map((r) => r.executiveSession);
        expect(outcomes.filter((o) => o === "entered")).toHaveLength(1);
        expect(outcomes.filter((o) => o === null)).toHaveLength(1);
      } finally {
        await app.end();
      }
    });
  });
});

describe("voteRecord.recordForMotion — the minutes-approval consequence", () => {
  it("approves the minutes the motion was about, as amended, and queues the notification", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        // The document belongs to an EARLIER meeting; the live meeting's
        // agenda item merely points at it.
        const earlier = await seedMeeting(db, town, town.boardId, { status: "adjourned" });
        const documentId = await seedMinutesDocument(db, town, earlier);
        const meetingId = await seedMeeting(db, town, town.boardId);
        const itemId = await seedAgendaItem(db, town, meetingId, {
          sourceMinutesDocumentId: documentId,
        });
        const motionId = await seedMotion(db, town, meetingId, itemId, {
          text: "to approve the minutes of October 6 AS AMENDED",
        });
        const seat = await seedSeat(db, town, town.boardId);
        const clerk = await seedActor(db, town, clerkSpec(town));
        const caller = appRouter.createCaller(contextFor(db, town, clerk));

        const result = await caller.voteRecord.recordForMotion({
          boardId: town.boardId,
          motionId,
          votes: [{ boardMemberId: seat.boardMemberId, vote: "yes", recusalReason: null }],
        });

        expect(result.minutesApproved).toBe(documentId);
        const docs = await readRows<{
          status: string;
          approved_by_motion_id: string | null;
          approved_as_amended: boolean;
          approved_at: string | null;
        }>(
          db,
          town,
          sql`SELECT status::text AS status, approved_by_motion_id, approved_as_amended, approved_at
              FROM minutes_document WHERE id = ${documentId}`,
        );
        expect(docs[0]).toMatchObject({
          status: "approved",
          approved_by_motion_id: motionId,
          approved_as_amended: true,
        });
        expect(docs[0]?.approved_at).not.toBeNull();

        const events = await readRows<{ event_type: string; payload: Record<string, unknown> }>(
          db,
          town,
          sql`SELECT event_type, payload FROM notification_event`,
        );
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({
          event_type: "minutes_approved",
          payload: {
            minutes_document_id: documentId,
            meeting_id: meetingId,
            approved_by_motion_id: motionId,
          },
        });

        // ── The event must reach someone (backlog 12) ──────────────────
        //
        // The row existing is not the guarantee: `getSubscribersForEvent`
        // reads `payload.board_id` and returns `[]` without it, so this
        // notification was queued and delivered to nobody. Asserting the
        // payload's shape alone is what let that survive — this asserts the
        // lookup the pipeline actually performs.
        const payload = events[0]!.payload;
        expect(payload.board_id, "no board_id: the subscriber lookup returns []").toBe(
          town.boardId,
        );
        const subscribers = await inTown(db, town, (tx) =>
          getBoardSubscribers(tx, payload.board_id as string),
        );
        expect(
          subscribers.map((s) => s.email).filter(Boolean).length,
          "the queued minutes_approved event resolves to no deliverable subscriber",
        ).toBeGreaterThan(0);

        // The email template renders these; without them the message goes out
        // naming neither the town nor the meeting.
        expect(payload).toMatchObject({
          townName: expect.any(String),
          boardName: expect.any(String),
        });
      } finally {
        await app.end();
      }
    });
  });

  it("records approved_as_amended false for a plain approval motion", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const earlier = await seedMeeting(db, town, town.boardId, { status: "adjourned" });
        const documentId = await seedMinutesDocument(db, town, earlier);
        const meetingId = await seedMeeting(db, town, town.boardId);
        const itemId = await seedAgendaItem(db, town, meetingId, {
          sourceMinutesDocumentId: documentId,
        });
        const motionId = await seedMotion(db, town, meetingId, itemId, {
          text: "to approve the minutes of October 6",
        });
        const seat = await seedSeat(db, town, town.boardId);
        const clerk = await seedActor(db, town, clerkSpec(town));
        const caller = appRouter.createCaller(contextFor(db, town, clerk));

        await caller.voteRecord.recordForMotion({
          boardId: town.boardId,
          motionId,
          votes: [{ boardMemberId: seat.boardMemberId, vote: "yes", recusalReason: null }],
        });

        const docs = await readRows<{ approved_as_amended: boolean }>(
          db,
          town,
          sql`SELECT approved_as_amended FROM minutes_document WHERE id = ${documentId}`,
        );
        expect(docs[0]?.approved_as_amended).toBe(false);
      } finally {
        await app.end();
      }
    });
  });

  it("touches nothing when the motion's item is not a minutes-approval item", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const meetingId = await seedMeeting(db, town, town.boardId);
        const itemId = await seedAgendaItem(db, town, meetingId);
        const motionId = await seedMotion(db, town, meetingId, itemId);
        const seat = await seedSeat(db, town, town.boardId);
        const clerk = await seedActor(db, town, clerkSpec(town));
        const caller = appRouter.createCaller(contextFor(db, town, clerk));

        const result = await caller.voteRecord.recordForMotion({
          boardId: town.boardId,
          motionId,
          votes: [{ boardMemberId: seat.boardMemberId, vote: "yes", recusalReason: null }],
        });

        expect(result.minutesApproved).toBeNull();
        expect(await readRows(db, town, sql`SELECT id FROM notification_event`)).toEqual([]);
      } finally {
        await app.end();
      }
    });
  });

  it("queues exactly ONE notification under two concurrent callers", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      const db = testDb(app);
      const town = await seedTown(db);
      const earlier = await seedMeeting(db, town, town.boardId, { status: "adjourned" });
      const documentId = await seedMinutesDocument(db, town, earlier);
      const meetingId = await seedMeeting(db, town, town.boardId);
      const itemId = await seedAgendaItem(db, town, meetingId, {
        sourceMinutesDocumentId: documentId,
      });
      const motionId = await seedMotion(db, town, meetingId, itemId, {
        text: "to approve the minutes of October 6",
      });
      const seat = await seedSeat(db, town, town.boardId);
      const clerk = await seedActor(db, town, clerkSpec(town));

      try {
        const results = await concurrently(client, town, clerk, (caller) =>
          caller.voteRecord.recordForMotion({
            boardId: town.boardId,
            motionId,
            votes: [{ boardMemberId: seat.boardMemberId, vote: "yes", recusalReason: null }],
          }),
        );

        // This is the harm the `useRef<Set>` was the only thing standing
        // against: two clerks with the screen open, two "minutes approved"
        // emails queued to every subscriber in the town.
        const approved = fulfilled(results).map((r) => r.minutesApproved);
        expect(approved.filter((d) => d === documentId)).toHaveLength(1);
        expect(approved.filter((d) => d === null)).toHaveLength(1);
        expect(await readRows(db, town, sql`SELECT id FROM notification_event`)).toHaveLength(1);
      } finally {
        await app.end();
      }
    });
  });
});

describe("voteRecord.recordForMotion — the adjournment consequence", () => {
  it("adjourns the meeting when a motion to adjourn carries, deferring the unreached items", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const meetingId = await seedMeeting(db, town, town.boardId);
        const sectionId = await seedAgendaItem(db, town, meetingId, { title: "New Business" });
        const currentId = await seedAgendaItem(db, town, meetingId, {
          parentItemId: sectionId,
          status: "active",
          title: "The item under discussion",
        });
        const unreachedId = await seedAgendaItem(db, town, meetingId, {
          parentItemId: sectionId,
          status: "pending",
          title: "The item nobody got to",
        });
        await inTown(db, town, (tx) =>
          tx.execute(
            sql`UPDATE meeting SET current_agenda_item_id = ${currentId} WHERE id = ${meetingId}`,
          ),
        );
        const motionId = await seedMotion(db, town, meetingId, currentId, {
          motionType: "adjourn",
          text: "to adjourn the meeting",
        });
        const seat = await seedSeat(db, town, town.boardId);
        const clerk = await seedActor(db, town, clerkSpec(town));
        const caller = appRouter.createCaller(contextFor(db, town, clerk));

        const { result, topics } = await captureRealtimeEvents(client, 5, () =>
          caller.voteRecord.recordForMotion({
            boardId: town.boardId,
            motionId,
            votes: [{ boardMemberId: seat.boardMemberId, vote: "yes", recusalReason: null }],
          }),
        );

        expect(result.adjourned).toBe(true);
        expect(topics).toEqual([
          "agenda_item",
          "agenda_item_transition",
          "meeting",
          "motion",
          "vote_record",
        ]);

        const meetings = await readRows<{ status: string; ended_at: string | null }>(
          db,
          town,
          sql`SELECT status::text AS status, ended_at FROM meeting WHERE id = ${meetingId}`,
        );
        expect(meetings[0]?.status).toBe("adjourned");
        expect(meetings[0]?.ended_at).not.toBeNull();

        const deferred = await readRows<{ id: string; status: string }>(
          db,
          town,
          sql`SELECT id, status::text AS status FROM agenda_item WHERE id = ${unreachedId}`,
        );
        expect(deferred[0]?.status).toBe("deferred");
        const queued = await readRows<{ source_agenda_item_id: string; source: string }>(
          db,
          town,
          sql`SELECT source_agenda_item_id, source::text AS source FROM future_item_queue
              WHERE source_meeting_id = ${meetingId}`,
        );
        expect(queued).toEqual([{ source_agenda_item_id: unreachedId, source: "deferred" }]);
      } finally {
        await app.end();
      }
    });
  });

  it("does not adjourn on a motion of any other type", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const meetingId = await seedMeeting(db, town, town.boardId);
        const itemId = await seedAgendaItem(db, town, meetingId);
        const motionId = await seedMotion(db, town, meetingId, itemId, { motionType: "main" });
        const seat = await seedSeat(db, town, town.boardId);
        const clerk = await seedActor(db, town, clerkSpec(town));
        const caller = appRouter.createCaller(contextFor(db, town, clerk));

        const result = await caller.voteRecord.recordForMotion({
          boardId: town.boardId,
          motionId,
          votes: [{ boardMemberId: seat.boardMemberId, vote: "yes", recusalReason: null }],
        });

        expect(result.adjourned).toBe(false);
        const meetings = await readRows<{ status: string }>(
          db,
          town,
          sql`SELECT status::text AS status FROM meeting WHERE id = ${meetingId}`,
        );
        expect(meetings[0]?.status).toBe("open");
      } finally {
        await app.end();
      }
    });
  });

  it("adjourns ONCE under two concurrent callers, with one set of queue rows", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      const db = testDb(app);
      const town = await seedTown(db);
      const meetingId = await seedMeeting(db, town, town.boardId);
      const sectionId = await seedAgendaItem(db, town, meetingId, { title: "New Business" });
      const unreachedId = await seedAgendaItem(db, town, meetingId, {
        parentItemId: sectionId,
        status: "pending",
      });
      const motionId = await seedMotion(db, town, meetingId, unreachedId, {
        motionType: "adjourn",
        text: "to adjourn the meeting",
      });
      const seat = await seedSeat(db, town, town.boardId);
      const clerk = await seedActor(db, town, clerkSpec(town));

      try {
        const results = await concurrently(client, town, clerk, (caller) =>
          caller.voteRecord.recordForMotion({
            boardId: town.boardId,
            motionId,
            votes: [{ boardMemberId: seat.boardMemberId, vote: "yes", recusalReason: null }],
          }),
        );

        const adjourned = fulfilled(results).map((r) => r.adjourned);
        expect(adjourned.filter(Boolean)).toHaveLength(1);
        // The duplicate the old client-side race produced: a second
        // adjournment with a later `ended_at` and a second copy of every
        // deferred item in the board's future queue.
        const queued = await readRows<{ source_agenda_item_id: string }>(
          db,
          town,
          sql`SELECT source_agenda_item_id FROM future_item_queue
              WHERE source_meeting_id = ${meetingId}`,
        );
        expect(queued).toEqual([{ source_agenda_item_id: unreachedId }]);
      } finally {
        await app.end();
      }
    });
  });
});
