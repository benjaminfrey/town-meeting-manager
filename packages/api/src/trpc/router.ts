/**
 * Stage 1, Task D1 — the root router.
 *
 * Task 2 adds `boards` here, and Phase E fans out from it. What lives here now
 * is the smallest thing that proves the stack end to end: a procedure that
 * reads the caller's own identity through `withTenant`, and one that reports
 * the caller's resolved permissions.
 *
 * `permissions` exists for a reason beyond diagnostics. Phase D's open
 * question 2 asks what a permission denial should look like to a clerk; every
 * answer except "hide the control" needs the client to know what the caller
 * holds, and the client must learn it from the same resolver the API enforces
 * with, or the UI and the API disagree about what is allowed.
 */

import { sql } from "drizzle-orm";
import { router, protectedProcedure } from "./trpc.js";
import { toRows } from "../db/rows.js";
import { PERMISSION_CODES, resolvePermission } from "./authorization/permission.js";
import { townRouter } from "./routers/town.js";
import { boardRouter } from "./routers/board.js";
import { boardMemberRouter } from "./routers/board-member.js";
import { agendaTemplateRouter } from "./routers/agenda-template.js";
import { personRouter } from "./routers/person.js";
import { invitationRouter } from "./routers/invitation.js";
import { notificationPreferenceRouter } from "./routers/notification-preference.js";
import { meetingRouter } from "./routers/meeting.js";
import { agendaItemRouter } from "./routers/agenda-item.js";
import { exhibitRouter } from "./routers/exhibit.js";
import { minutesDocumentRouter } from "./routers/minutes-document.js";
import { meetingAttendanceRouter } from "./routers/meeting-attendance.js";
import { agendaItemTransitionRouter } from "./routers/agenda-item-transition.js";
import { motionRouter } from "./routers/motion.js";
import { voteRecordRouter } from "./routers/vote-record.js";
import { executiveSessionRouter } from "./routers/executive-session.js";
import { guestSpeakerRouter } from "./routers/guest-speaker.js";
import { realtimeRouter } from "./routers/realtime.js";
import { futureItemRouter } from "./routers/future-item.js";

export const appRouter = router({
  /**
   * The town's own settings. Task D1b added the one procedure the public
   * portal cannot function without — see `routers/town.ts`.
   */
  town: townRouter,

  /**
   * Board reads and writes. No permission guard on the reads — see
   * `routers/board.ts` for why.
   */
  board: boardRouter,

  /**
   * Board membership: seats, the staff/board-member accounts that come with
   * them, and the invitations both paths issue. `memberCount` has no
   * permission guard (tenancy-only, moved from `board.ts`); `roster`,
   * `searchCandidates` and `personEmailExists` are tenancy-only reads for the
   * same reason; `addBoardMember` and `addStaffMember` are admin gates — see
   * `routers/board-member.ts`.
   */
  boardMember: boardMemberRouter,

  /**
   * Agenda template reads and writes, scoped to one board at a time. No
   * permission guard on the reads — see `routers/agenda-template.ts` for why.
   */
  agendaTemplate: agendaTemplateRouter,

  /**
   * The people directory and its writes, plus `detail` (wave 3, Task 3) — one
   * person's name, by id. No permission guard on either read — see
   * `routers/person.ts` for why. The four writes are all admin gates.
   */
  person: personRouter,

  /**
   * `AddPersonDialog.tsx`'s invitation write — the one invitation insert
   * `boardMember.ts`'s private `insertInvitation` helper cannot reach (that
   * dialog never seats anyone on a board). One admin-gated procedure — see
   * `routers/invitation.ts`.
   */
  invitation: invitationRouter,

  /**
   * A person's own notification preferences. No permission guard — see
   * `routers/notification-preference.ts` for why (self-scoped by
   * construction, not by an `assertCan*` rule).
   */
  notificationPreference: notificationPreferenceRouter,

  /**
   * Meetings: a town-wide list (the kanban), a board-scoped list, one
   * meeting's detail, and three writes — `insert`, `cancel` and
   * `updateStatus`, matching `routers/meeting.ts`'s own header. `insert`/
   * `cancel` are this codebase's first real call sites for the board-scoped
   * half of conventions item 2 — see `routers/meeting.ts` for why `cancel`'s
   * guard is not a copy of `insert`'s, and `updateStatus` (added in the same
   * task's fix round) for the raw-write hole it closed.
   */
  meeting: meetingRouter,

  /**
   * The agenda surface: the shell's item count, the builder's ordered read,
   * and every `agenda_item` write — `insert`, `update`, `reorder`, a
   * cascading `delete`, and `instantiateFromTemplate`. `setOperatorNotes`
   * and `markComplete` ship here UNWIRED for wave 5's live screen. Every
   * write is board-scoped through a JOIN (`agenda_item` has no `board_id`)
   * — see `routers/agenda-item.ts`'s header for the derivation and the
   * mismatch defence it feeds.
   */
  agendaItem: agendaItemRouter,

  /**
   * An agenda item's attachments: one read, and the LINK creation path only.
   * The file-upload path and the delete both stay at the D1e endpoints
   * (`routes/files.ts` → `storage/documents.ts`), which already apply the
   * same rules against the same derived board and additionally manage the
   * bytes — see `routers/exhibit.ts`'s header for why duplicating either
   * here would weaken it.
   */
  exhibit: exhibitRouter,

  /**
   * The one minutes document a meeting has, if any — `routes/
   * meetings.$meetingId.tsx`'s status pill. Wave 6 owns the full minutes
   * surface and extends this router. See `routers/minutes-document.ts`.
   */
  minutesDocument: minutesDocumentRouter,

  /**
   * The attendance count `routes/meetings.$meetingId.tsx`'s shell needs, the
   * live meeting's whole roll, and the two writes behind roll call and the
   * attendance cycle — both M2, both upserts on
   * `attendance_unique_per_meeting`. See `routers/meeting-attendance.ts`.
   */
  meetingAttendance: meetingAttendanceRouter,

  /**
   * The live meeting's clock. ONE read and no writes, on purpose — every
   * `agenda_item_transition` write happens inside `meeting.callToOrder`,
   * `meeting.navigateToAgendaItem` or `meeting.adjourn`, in the same
   * transaction as the `meeting.current_agenda_item_id` change that causes
   * it. See `routers/agenda-item-transition.ts`.
   */
  agendaItemTransition: agendaItemTransitionRouter,

  /**
   * Motions: the live meeting's read, the capture dialog's insert, and the
   * two status moves a clerk performs by hand. The outcome stamp a completed
   * vote applies lives in `voteRecord.recordForMotion`, because it is derived
   * from the tally. All M3 — see `routers/motion.ts`.
   */
  motion: motionRouter,

  /**
   * Votes: the live meeting's read, one member's vote (the only path where
   * `assertCanInsertVoteRecord`'s self-vote branch is reachable, and the
   * codebase's first resolver-side rule needing a `TenantTx`), and the whole
   * roll call on one motion in a single transaction. See
   * `routers/vote-record.ts` for how the async rule is guarded and what that
   * costs.
   */
  voteRecord: voteRecordRouter,

  /**
   * Executive sessions — M6, the code wave 5 Task 2 gave a rule for and this
   * router applies for the first time. Five writes that were reaching the
   * database with no authorization check of any kind. See
   * `routers/executive-session.ts`.
   */
  executiveSession: executiveSessionRouter,

  /**
   * The public-comment speaker queue — M7, the same shape of hole as M6 and
   * closed the same way. See `routers/guest-speaker.ts`.
   */
  guestSpeaker: guestSpeakerRouter,

  /**
   * The SSE transport, replacing Supabase Realtime. One subscription today
   * (`onMeetingChange`), which is the whole of `live.tsx`'s eight channels —
   * see `routers/realtime.ts` for why eight streams would not work in a
   * browser. Phase E wave 5, Task 1.
   */
  realtime: realtimeRouter,

  /**
   * The future item queue's only read — `review.tsx`'s deferred/tabled list
   * for one meeting. No writes here; every row is written by
   * `meeting.performAdjournment`. See `routers/future-item.ts`. Phase E wave
   * 6, Task 2.
   */
  futureItem: futureItemRouter,

  /**
   * Who the caller is, read back through the tenant context rather than echoed
   * from the session — so a green answer here means RLS, the tenant bridge and
   * the actor loader all agree.
   */
  whoami: protectedProcedure.query(async ({ ctx }) => {
    const actor = await ctx.actor();
    const rows = await ctx.withTenant(async (tx) =>
      toRows<{ name: string; town_name: string }>(
        await tx.execute(sql`
          SELECT p.name, t.name AS town_name
          FROM person p
          JOIN town t ON t.id = p.town_id
          WHERE p.id = ${ctx.tenant.personId}
        `),
        (message) => new Error(`whoami: ${message}`),
      ),
    );
    const row = rows[0];
    return {
      townId: ctx.tenant.townId,
      personId: ctx.tenant.personId,
      userAccountId: ctx.tenant.userAccountId,
      role: actor.role,
      name: row?.name ?? null,
      townName: row?.town_name ?? null,
    };
  }),

  /**
   * The caller's effective global permissions, by action CODE.
   *
   * Codes, not names, because that is what the database stores and what the
   * permissions UI writes. Board-scoped answers are deliberately not included:
   * they depend on a board, and returning a matrix "for every board" would be
   * a snapshot the client would then be tempted to cache and act on.
   */
  permissions: protectedProcedure.query(async ({ ctx }) => {
    const actor = await ctx.actor();
    const granted: Record<string, boolean> = {};
    for (const code of PERMISSION_CODES) {
      granted[code] = resolvePermission(actor, code);
    }
    return { role: actor.role, global: granted };
  }),
});

export type AppRouter = typeof appRouter;
