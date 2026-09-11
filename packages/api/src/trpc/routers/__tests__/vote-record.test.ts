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
  expectTrpcError,
  type TestDb,
  type TownFixture,
} from "../../__tests__/fixtures.js";
import { appRouter } from "../../router.js";
import {
  seedMeeting,
  seedAgendaItem,
  seedSeat,
  seedMotion,
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
