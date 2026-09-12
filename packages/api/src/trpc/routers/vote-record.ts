/**
 * Phase E, wave 5, Task 3 — the vote record router.
 *
 * Two writes, and they are governed by DIFFERENT rules, which is the whole
 * reason this file has a header worth reading:
 *
 *   `insert`           — one member's vote on one motion. `RecusalDialog.tsx`
 *                        files a `recusal` through it today. Rule 5,
 *                        `assertCanInsertVoteRecord`: **M3 for the board, OR
 *                        the caller's own active seat (M8)**.
 *   `recordForMotion`  — `VotePanel.tsx`'s "Record Vote": clear every vote on
 *                        the motion, write the roll, and stamp the motion with
 *                        the outcome. Rules 6a + 5 + 4, all resolving to
 *                        **M3 only**.
 *
 * ─── `assertCanInsertVoteRecord` is the one rule that cannot be a guard ───
 *
 * It is `(actor: Actor, tx: TenantTx, subject: VoteRecordSubject) => Promise<void>`
 * — the only `async` rule in `rules.ts`, and the only one taking a `TenantTx`.
 * Its second branch asks a question of the DATABASE (is `boardMemberId` one of
 * THIS person's currently-active seats?), because trusting a client-supplied
 * "this is me" would let any board member vote as any other, and an archived
 * seat must not vote at all. `requireBoardPermission` and `requireBoardActor`
 * both run BEFORE `.input()`, where there is no `TenantTx` and no transaction
 * to run one in. `phase-e-conventions.md` item 2 calls this a FIFTH guard
 * shape and says whichever wave wires it should record why it stays
 * resolver-side. This is that record.
 *
 * **How `insert` is guarded, and what that costs.** Not "resolver-side only":
 * that would surrender FORBIDDEN-before-BAD_REQUEST (item 2's central rule,
 * and the defect it spent two fix rounds on), and it would leave
 * `ctx.authorizedBoardId` unset, so `assertMatchesAuthorizedBoard` — the
 * board-mismatch defence every table in this wave needs — would throw its
 * wiring-bug `Error` on the first real call. So `insert` carries BOTH:
 *
 *   1. `.use(requireBoardActor(assertCouldRecordAVote))` — a NECESSARY
 *      CONDITION, declared before `.input()`. It is the synchronous part of
 *      rule 5 with the seat lookup removed: M3 for this board, or the
 *      `board_member` role at all. Structurally it is `assertCanInsertExhibit`
 *      (a code OR a role branch), which `exhibit.link` already runs through
 *      this same guard.
 *   2. `assertCanInsertVoteRecord(actor, tx, …)` in the resolver, inside the
 *      write's own transaction — the AUTHORITATIVE check, which is what
 *      actually refuses a board member naming somebody else's seat, or their
 *      own archived one.
 *
 * **The costs, stated rather than discovered.**
 *
 *   - **The rule is now expressed in two places.** `assertCouldRecordAVote`
 *     lives here rather than in `rules.ts` precisely so it cannot be mistaken
 *     for the rule: a reader auditing `rules.ts` for "what governs recording a
 *     vote" finds rule 5 and only rule 5. The drift risk is real and is pinned
 *     rather than argued away — `vote-record.test.ts` has a test for the exact
 *     gap between the two (a board member who passes the prefilter and is
 *     refused by the rule), so widening the prefilter to admit somebody rule 5
 *     rejects turns a named test red.
 *   - **A refusal can come from either, with different wording.** A staff
 *     account holding no M3 is refused by the prefilter and never reaches the
 *     resolver; a board member naming another seat is refused by rule 5. Both
 *     are FORBIDDEN, and the messages differ. That is deliberate — rule 5's
 *     message is the specific one and is the one a board member sees.
 *   - **The prefilter admits more than the rule.** Any board member of the
 *     TOWN passes it, including one who sits on no board at all
 *     (`isBoardMember(actor)` is `actor.role === "board_member"`, a town-level
 *     fact — the same inert-branch property conventions item 2 records for
 *     rules 14/15). Nothing is authorized by passing it; it only means the
 *     resolver gets to run the real check.
 *
 * `recordForMotion` needs none of that: every rule it touches resolves to M3,
 * so `requireBoardPermission("M3", boardIdFrom())` IS the complete check and
 * rule 5's self-vote branch is satisfied by its first branch for every caller
 * who gets through. It does not call `assertCanInsertVoteRecord` per row, and
 * that is not an omission — see its own doc comment.
 *
 * ─── The tally is computed HERE, not accepted from the browser ────────────
 *
 * `VotePanel.tsx` computes `calculateVoteResult(...)` client-side and posts
 * the motion's `status` and `vote_summary` along with the votes. A server that
 * takes those on trust is a server that lets a client declare a motion
 * carried — on a table whose own comment says "Required by Maine law to be
 * recorded". `recordForMotion` takes the VOTES and computes the outcome with
 * the same function, which moved into `@town-meeting/shared` in this task so
 * that there is one body rather than two. Same answer for every honest
 * caller; a different answer for a dishonest one.
 *
 * ─── The board is one join out, and the FKs are unchecked today ───────────
 *
 * `vote_record` carries `meeting_id uuid NOT NULL` and no `board_id`
 * (`0000_baseline.sql:2148`); `vote_record_tenant_isolation` is tenancy-only,
 * no board predicate, no role predicate. Both writes name their target through
 * `motionId`, so the real board comes from
 * `assertLiveRowOnAuthorizedBoard(ctx, tx, "motion", …)` and every
 * `board_member_id` from client input goes through
 * `assertBoardMembersOnBoard` — today neither is checked at all, so a
 * `board_member.id` from another town satisfies
 * `vote_record_board_member_id_fkey` and records a vote by somebody who has
 * never sat on that board.
 *
 * ─── `vote_record_unique_per_motion` ──────────────────────────────────────
 *
 * `UNIQUE (motion_id, board_member_id)` (`0000_baseline.sql:2507`). `insert`
 * translates a violation of it into CONFLICT with a message, rather than
 * letting a `23505` surface as INTERNAL_SERVER_ERROR — the raw insert it
 * replaces threw the driver error into `RecusalDialog`'s `setError`, so the
 * caller already saw a failure; this only makes the failure legible. It does
 * NOT become an upsert: replacing a member's recorded vote is
 * `assertCanUpdateVoteRecord`'s territory (rule 6, M3 with no self-branch),
 * and quietly overwriting one through a procedure named `insert` would route
 * a narrower action through a wider guard.
 */

import { sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { calculateVoteResult, type VoteEntry } from "@town-meeting/shared";
import {
  router,
  protectedProcedure,
  requireBoardPermission,
  requireBoardActor,
  boardIdFrom,
} from "../trpc.js";
import type { Actor } from "../authorization/actor.js";
import {
  AuthorizationError,
  isBoardMember,
  resolvePermission,
} from "../authorization/permission.js";
import { assertCanInsertVoteRecord, type BoardScope } from "../authorization/rules.js";
import { assertLiveRowOnAuthorizedBoard, assertBoardMembersOnBoard } from "../board-derivation.js";
import { publishRealtimeEvent, type LiveMeetingTopic } from "../../realtime/events.js";
import {
  assertMeetingExists,
  lockMeetingOnAuthorizedBoard,
  performAdjournment,
} from "./meeting.js";
import { approveMinutesForPassedMotion } from "./minutes-document.js";
import { toRows } from "../../db/rows.js";
import type { TenantTx } from "../../db/with-tenant.js";

/** The full `vote_type` enum (`0000_baseline.sql:278`). */
const VOTE_TYPES = ["yes", "no", "abstain", "recusal", "absent"] as const;

/**
 * The SYNCHRONOUS necessary condition for recording a vote — NOT the rule.
 *
 * See this file's header, "`assertCanInsertVoteRecord` is the one rule that
 * cannot be a guard". This exists so `insert` can carry a middleware guard at
 * all; `assertCanInsertVoteRecord` in the resolver is what decides. Everything
 * this admits, rule 5 still gets to refuse.
 *
 * It is deliberately NOT in `rules.ts`: a weaker copy of a rule, filed next to
 * the rule, is how the weaker copy eventually becomes the one people trust.
 */
function assertCouldRecordAVote(actor: Actor, scope: BoardScope): void {
  if (resolvePermission(actor, "M3", scope.boardId)) return;
  if (isBoardMember(actor)) return;
  throw new AuthorizationError(
    "This account cannot record a vote. Recording a vote requires M3 " +
      "(capture_motions_votes) for this board; a board member may record their own vote on a " +
      "seat they currently hold.",
    { code: "M3", boardId: scope.boardId },
  );
}

/**
 * `23505` is Postgres's unique_violation.
 *
 * The `cause` walk is not defensive padding: drizzle-orm wraps a driver error
 * in a `DrizzleQueryError` whose own `code` is undefined and whose `cause` is
 * the postgres.js `PostgresError` carrying the SQLSTATE. Reading `err.code`
 * alone answered `undefined` here and turned the CONFLICT below into an
 * INTERNAL_SERVER_ERROR — found by the test that asserts the CONFLICT, which
 * is why that test exists rather than the behaviour being assumed.
 */
function isUniqueViolation(err: unknown): boolean {
  for (let current: unknown = err, depth = 0; current && depth < 5; depth += 1) {
    if (typeof current !== "object") return false;
    if ((current as { code?: unknown }).code === "23505") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

export const voteRecordRouter = router({
  /**
   * `routes/meetings.$meetingId.live.tsx`'s vote-record query — every vote on
   * one meeting, which the screen groups by motion itself (`votesByMotion`).
   *
   * No permission guard (tenancy-only RLS, and the query this replaces had no
   * application-level check either). No ORDER BY in the query this replaces
   * either, and none added: the consumer builds a `Map` keyed by motion and
   * `VotePanel` sorts members by name, so row order is not read anywhere.
   */
  byMeeting: protectedProcedure
    .input(z.object({ meetingId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.withTenant(async (tx) => {
        await assertMeetingExists(tx, input.meetingId);
        return toRows<{
          id: string;
          motion_id: string;
          board_member_id: string;
          vote: string;
          recusal_reason: string | null;
          created_at: string;
        }>(
          await tx.execute(sql`
            SELECT id, motion_id, board_member_id, vote, recusal_reason, created_at
            FROM vote_record
            WHERE meeting_id = ${input.meetingId}
          `),
          (message) => new Error(`voteRecord.byMeeting: ${message}`),
        );
      });
    }),

  /**
   * One member's vote on one motion — `RecusalDialog.tsx`'s write today, and
   * the only path on which rule 5's self-vote branch is reachable.
   *
   * `meetingId` and `townId` are DERIVED, not accepted: the motion names its
   * meeting and `ctx.tenant` names the town. The raw insert sent both from
   * client state, which meant a caller could file a vote whose `meeting_id`
   * disagreed with its motion's.
   *
   * `recusalReason` is required non-empty when `vote` is `'recusal'`,
   * matching `RecusalDialog`'s own `reason.trim().length > 0` rule and the
   * column's documented requirement (30-A M.R.S.A. §2605(4)). That check is
   * deliberately NOT applied by `recordForMotion` — see its doc comment.
   */
  insert: protectedProcedure
    .use(requireBoardActor(assertCouldRecordAVote))
    .input(
      z
        .object({
          boardId: z.string().uuid(),
          motionId: z.string().uuid(),
          boardMemberId: z.string().uuid(),
          vote: z.enum(VOTE_TYPES),
          recusalReason: z.string().max(2000).nullable(),
        })
        .refine((v) => v.vote !== "recusal" || (v.recusalReason ?? "").trim().length > 0, {
          message: "A recusal must record a reason.",
          path: ["recusalReason"],
        }),
    )
    .mutation(async ({ ctx, input }) => {
      // Resolved BEFORE `ctx.withTenant` opens — `context.ts`'s reentrancy
      // guard refuses a COLD `ctx.actor()` from inside a transaction, and
      // relying on the guard's settled-memo branch (the middleware above has
      // already warmed it) would make this procedure depend on a guard's
      // internal state rather than on its own ordering.
      const actor = await ctx.actor();
      return ctx.withTenant(async (tx) => {
        const { meetingId, boardId } = await assertLiveRowOnAuthorizedBoard(
          ctx,
          tx,
          "motion",
          input.motionId,
        );
        await assertBoardMembersOnBoard(tx, boardId, [input.boardMemberId]);
        // THE rule. Everything above is a precondition to being allowed to
        // ask it.
        await assertCanInsertVoteRecord(actor, tx, {
          boardId,
          boardMemberId: input.boardMemberId,
        });

        let rows;
        try {
          rows = toRows<{ id: string }>(
            await tx.execute(sql`
              INSERT INTO vote_record (
                motion_id, meeting_id, town_id, board_member_id, vote, recusal_reason
              )
              VALUES (
                ${input.motionId}, ${meetingId}, ${ctx.tenant.townId}, ${input.boardMemberId},
                ${input.vote}::vote_type, ${input.recusalReason}
              )
              RETURNING id
            `),
            (message) => new Error(`voteRecord.insert: ${message}`),
          );
        } catch (err) {
          if (!isUniqueViolation(err)) throw err;
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "This member already has a recorded vote on that motion. Correcting a recorded " +
              "vote is a separate action from casting one.",
          });
        }

        await publishRealtimeEvent(tx, {
          townId: ctx.tenant.townId,
          meetingId,
          topic: "vote_record",
        });
        return { id: rows[0]!.id };
      });
    }),

  /**
   * `VotePanel.tsx`'s "Record Vote" — the whole roll call on one motion, and
   * the motion's outcome, in ONE transaction.
   *
   * Today this is `1 + N + 1` sequential round trips with no transaction: a
   * `delete().eq("motion_id", …)`, then an insert per member in a `for` loop,
   * then the motion update. A failure at member four leaves a motion with
   * three votes recorded, no outcome, and the previous roll already deleted —
   * a partially destroyed legal record with nothing to say so. The delete and
   * the inserts are now one statement each, and the whole thing commits or
   * does not.
   *
   * **M3 only, through `requireBoardPermission`.** Three rules apply and all
   * three resolve to M3: 6a (`assertCanDeleteVoteRecord`, which `rules.ts`
   * added in wave 5 Task 2 for exactly this delete and deliberately WITHOUT
   * rule 5's self-vote branch — the statement is keyed by motion, not by seat,
   * so a self-branch here would be a licence to erase other people's votes),
   * 5 (M3 satisfies its first branch for every caller who gets past the
   * guard), and 4 (`assertCanUpdateMotion`, for the outcome stamp). So this
   * procedure does NOT call `assertCanInsertVoteRecord` per row: the guard has
   * already established the branch that rule would take, and calling it N
   * times would be N `board_member` queries answering a question already
   * settled.
   *
   * **The outcome is computed here.** `status` and `vote_summary` are derived
   * from `votes` with `@town-meeting/shared`'s `calculateVoteResult` — see
   * this file's header. `vote_summary`'s seven keys are exactly what
   * `VotePanel` wrote, in the same shape, so `MotionCard`'s rendering of an
   * existing row is unchanged.
   *
   * **`recusalReason` is not required here even for a `recusal` vote**, unlike
   * `insert`. `VotePanel` builds a recusal entry from `recusalMap.get(id) ?? ""`,
   * so an empty reason is a value the current screen really produces (a
   * recusal recorded before this panel opened, whose `recusal_reason` was
   * already empty). Refusing it would turn a stale row into an unrecordable
   * vote mid-meeting.
   *
   * Duplicate `boardMemberId`s are refused at the schema rather than left to
   * `vote_record_unique_per_motion`: the constraint would abort the whole
   * transaction with a driver error, and the caller can be told what is wrong.
   *
   * ─── Phase E wave 5, Task 5: the consequences of the transition ──────────
   *
   * **This is where `live.tsx`'s reactive `useEffect`s went, and why they went
   * here rather than becoming procedures the client calls more carefully.**
   *
   * Four writes in that screen were not user actions. They fired when a motion
   * row arrived over the realtime subscription carrying a new `status`, on
   * EVERY connected device, deduplicated only by an in-memory `useRef<Set>`
   * that dies on reload and is shared with nobody:
   *
   *   | the observed transition                        | what every client then wrote        |
   *   | ---------------------------------------------- | ----------------------------------- |
   *   | an executive-session entry motion PASSES        | `executive_session.entered_at`      |
   *   | the same motion FAILS                           | DELETE that pending session         |
   *   | a motion on a minutes-approval item PASSES      | `minutes_document` + `notification_event` |
   *   | a motion to adjourn PASSES                      | the whole adjournment               |
   *
   * `motion.ts`'s header states the fact this design rests on: **an outcome
   * status is reachable only through this procedure.** So the transition has
   * exactly one origin, in one transaction, and its consequences belong in
   * that transaction — decided once by the server rather than N times by
   * whoever happened to have the screen open. The alternative the brief offers
   * (idempotent procedures the clients each call) was rejected for two
   * reasons: it leaves N-1 devices making a write they are not the author of,
   * and it surfaces a FORBIDDEN on every device whose operator merely watched
   * — a board member with the screen open would be told they lack permission
   * for something they did not do.
   *
   * **The authorization cost, stated as `callToOrder`'s doc comment states its
   * own — corrected in the single fix wave after wave 5's review, which found
   * this enumeration four rules short.** This is M3 (`capture_motions_votes`)
   * performing acts whose own rules are:
   *
   *   - **21b** (M6, executive session `entered_at` / delete)
   *   - **21** (admin/A1/M1, `meeting.status` — reached when the motion
   *     adjourns, via `performAdjournment` below)
   *   - **11/R1** (`assertCanUpdateMinutesDocument`, the `minutes_document`
   *     approve + `notification_event` insert — `approveMinutesForPassedMotion`,
   *     called directly here, not through `performAdjournment`)
   *   - **2a, 21d and 21e** — `agenda_item.status = 'deferred'`,
   *     `agenda_item_transition.ended_at`, and `future_item_queue` INSERT,
   *     all three arriving TRANSITIVELY through `performAdjournment` when the
   *     motion adjourns, exactly as `meeting.adjourn`'s own authorization-cost
   *     table (below, in `meeting.ts`) states them for its other caller.
   *
   * Requiring any of these in addition would refuse the recording secretary
   * mid-roll-call, which is `rules.ts` rule 2a's stated failure — "a partial
   * adjournment, worse than either answer" — and it is not what the act is:
   * the board decided, and M3 is the code for recording what the board
   * decided. It is a NARROWING either way, since every one of these writes was
   * authorized by nothing at all before. Revisit it with rule 21, not here.
   *
   * **Every branch is a no-op for a second concurrent caller**, and none of
   * them uses a check-then-write:
   *
   *   - `entered_at IS NULL` / the DELETE's own `RETURNING` — a blocked
   *     statement re-evaluates its WHERE against the committed row under READ
   *     COMMITTED, so the second caller matches zero rows.
   *   - `status <> 'approved'` in `approveMinutesForPassedMotion`, which gates
   *     the `notification_event` INSERT on its own `RETURNING` — so two clerks
   *     cannot queue two "minutes approved" emails.
   *   - `meeting.status = 'open'` read off a row held `FOR UPDATE`.
   *
   * And the motion itself is locked (`lockMotion` below), which serializes the
   * whole procedure per motion rather than letting two roll calls interleave.
   *
   * The return value grew three fields — `executiveSession`, `minutesApproved`
   * and `adjourned` — so the ONE client that made the call can do the three
   * things a server transaction cannot: invalidate the right caches, raise the
   * right toast, and issue the (pre-existing, and misdirected — see
   * `approveMinutesForPassedMotion`) PDF re-render. Other devices learn the
   * same facts the way they learn everything else, from the topics published
   * below.
   */
  recordForMotion: protectedProcedure
    .use(
      requireBoardPermission("M3", boardIdFrom(), {
        action: "to record the votes on a motion",
      }),
    )
    .input(
      z.object({
        boardId: z.string().uuid(),
        motionId: z.string().uuid(),
        votes: z
          .array(
            z.object({
              boardMemberId: z.string().uuid(),
              vote: z.enum(VOTE_TYPES),
              recusalReason: z.string().max(2000).nullable(),
            }),
          )
          .min(1)
          .refine((v) => new Set(v.map((e) => e.boardMemberId)).size === v.length, {
            message: "votes must not name the same board member twice",
          }),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.withTenant(async (tx) => {
        const { meetingId, boardId } = await assertLiveRowOnAuthorizedBoard(
          ctx,
          tx,
          "motion",
          input.motionId,
        );
        const motion = await lockMotion(tx, input.motionId);
        await assertBoardMembersOnBoard(
          tx,
          boardId,
          input.votes.map((v) => v.boardMemberId),
        );

        const entries: VoteEntry[] = input.votes.map((v) => ({
          boardMemberId: v.boardMemberId,
          vote: v.vote,
          recusalReason: v.recusalReason,
        }));
        const result = calculateVoteResult(entries);
        const voteSummary = JSON.stringify({
          yeas: result.yeas,
          nays: result.nays,
          abstentions: result.abstentions,
          recusals: result.recusals,
          absent: result.absent,
          result: result.result,
          passed: result.passed,
        });

        await tx.execute(sql`DELETE FROM vote_record WHERE motion_id = ${input.motionId}`);

        const values = sql.join(
          input.votes.map(
            (v) => sql`(
              ${input.motionId}, ${meetingId}, ${ctx.tenant.townId}, ${v.boardMemberId},
              ${v.vote}::vote_type, ${v.recusalReason}
            )`,
          ),
          sql`, `,
        );
        await tx.execute(sql`
          INSERT INTO vote_record (
            motion_id, meeting_id, town_id, board_member_id, vote, recusal_reason
          )
          VALUES ${values}
        `);

        await tx.execute(sql`
          UPDATE motion
          SET status = ${result.result}::motion_status, vote_summary = ${voteSummary}::jsonb
          WHERE id = ${input.motionId}
        `);

        // ─── The consequences of the transition ───────────────────────────
        //
        // See this procedure's doc comment. Each of these was a `useEffect` in
        // `live.tsx` firing on the row above arriving over the subscription,
        // on every connected device at once.

        let executiveSession: "entered" | "discarded" | null = null;
        if (result.result === "passed") {
          const entered = toRows<{ id: string }>(
            await tx.execute(sql`
              UPDATE executive_session SET entered_at = now()
              WHERE entry_motion_id = ${input.motionId}
                AND entered_at IS NULL AND exited_at IS NULL
              RETURNING id
            `),
            (message) => new Error(`voteRecord.recordForMotion: ${message}`),
          );
          if (entered[0]) executiveSession = "entered";
        } else {
          const discarded = toRows<{ id: string }>(
            await tx.execute(sql`
              DELETE FROM executive_session
              WHERE entry_motion_id = ${input.motionId}
                AND entered_at IS NULL AND exited_at IS NULL
              RETURNING id
            `),
            (message) => new Error(`voteRecord.recordForMotion: ${message}`),
          );
          if (discarded[0]) executiveSession = "discarded";
        }

        const minutesApproved =
          result.result === "passed"
            ? await approveMinutesForPassedMotion(tx, {
                townId: ctx.tenant.townId,
                meetingId,
                motionId: input.motionId,
                motionText: motion.motion_text,
              })
            : null;

        let adjourned = false;
        if (result.result === "passed" && motion.motion_type === "adjourn") {
          const meeting = await lockMeetingOnAuthorizedBoard(ctx, tx, meetingId, "recordForMotion");
          // `status === "open"` is `live.tsx`'s own condition, carried over
          // rather than replaced with `meeting.adjourn`'s "not already
          // adjourned" — and it is what makes a second concurrent caller a
          // no-op, because by the time it acquires the row lock the status is
          // `adjourned`.
          if (meeting.status === "open") {
            await performAdjournment(tx, {
              townId: ctx.tenant.townId,
              personId: ctx.tenant.personId,
              meetingId,
              meeting,
              method: "motion",
              adjournMotionId: input.motionId,
            });
            adjourned = true;
          }
        }

        // Sequential, and written out here rather than through `meeting.ts`'s
        // `publishLiveMeetingTopics`: `router-wiring.test.ts`'s inventory reads
        // this file's own text for the literal `publishRealtimeEvent(`, and a
        // publish reached through an imported helper is invisible to it — the
        // scan's own header says it is blind to writes and calls across a
        // module boundary. Keeping the call here is what keeps this mutation
        // inside the check rather than exempt from it by accident.
        const topics: LiveMeetingTopic[] = ["vote_record", "motion"];
        if (executiveSession !== null) topics.push("executive_session");
        if (adjourned) topics.push("meeting", "agenda_item", "agenda_item_transition");
        for (const topic of topics) {
          await publishRealtimeEvent(tx, { townId: ctx.tenant.townId, meetingId, topic });
        }

        return {
          motionId: input.motionId,
          status: result.result,
          recorded: input.votes.length,
          executiveSession,
          minutesApproved,
          adjourned,
        };
      });
    }),
});

/**
 * Read the motion's own columns and hold the row for the transaction.
 *
 * `FOR UPDATE` is new in Phase E wave 5, Task 5 and it is what makes the
 * consequences above safe. Two clerks pressing "Record Vote" on the same
 * motion used to run the delete/insert/stamp sequence concurrently, which
 * collided on `vote_record_unique_per_motion` and answered the loser an
 * INTERNAL_SERVER_ERROR; they now serialize here, and the second caller's
 * consequences find the work already done. It is also the cheapest place to
 * read `motion_type` and `motion_text`, which the adjournment and
 * minutes-approval branches need and which `assertLiveRowOnAuthorizedBoard`
 * (a join for the board) does not return.
 *
 * The row's existence and its board were established by the caller before this
 * runs, so a missing row here is a row deleted between two statements of the
 * same transaction — impossible under RLS for a caller who just read it — and
 * NOT_FOUND is the honest answer rather than a thrown invariant.
 */
async function lockMotion(
  tx: TenantTx,
  motionId: string,
): Promise<{ motion_type: string; motion_text: string }> {
  const rows = toRows<{ motion_type: string; motion_text: string }>(
    await tx.execute(sql`
      SELECT motion_type::text AS motion_type, motion_text FROM motion
      WHERE id = ${motionId}
      FOR UPDATE
    `),
    (message) => new Error(`voteRecord.recordForMotion: ${message}`),
  );
  const row = rows[0];
  if (!row) throw new TRPCError({ code: "NOT_FOUND" });
  return row;
}
