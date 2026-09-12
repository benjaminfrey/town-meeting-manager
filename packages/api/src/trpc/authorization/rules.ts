/**
 * Stage 1, Task D1 — THE AUTHORIZATION RULES.
 *
 * This file is the TypeScript half of the split Phase B made deliberately:
 * tenancy is enforced by row level security, permissions are enforced here.
 * Phase B removed 21 action-code policies, ~25 admin gates and 5 self-scoping
 * predicates from the database because leaving them in would have let the
 * tenancy gate pass for the wrong reason — a policy reading
 * `town_id = get_current_town_id() AND has_permission('R4')` denies every row
 * when the permission half fails for an unrelated reason, which from outside
 * looks exactly like working tenancy. The rules were written down in that
 * task's report and are restored here, one function each.
 *
 * ─── Read this before adding a rule ───────────────────────────────────────
 *
 * 1. **Rules take an `Actor`, never a request.** Everything an `Actor` knows
 *    came out of the database inside the caller's own tenant context, so no
 *    rule can be steered by anything a client sent.
 *
 * 2. **Board-scoped rules take the board — required, never optional.**
 *    Passing no board is NOT fail-closed: an override that grants is ignored
 *    (a board-specific clerk is wrongly refused) and an override that revokes
 *    is ignored too (a barred clerk is wrongly ALLOWED). The signatures below
 *    require a `boardId`, so the mistake is a type error rather than a quiet
 *    global check.
 *
 *    Most of the guards are board-scoped, not the two that were obviously
 *    so. This paragraph used to say SIXTEEN, and stayed at sixteen through
 *    three waves that changed it — quote the grep, not the number
 *    (conventions item 11). The grep is the one in `trpc.ts`'s
 *    `requireBoardActor` doc comment: it counts the `BoardScope`-taking
 *    signatures in THIS file, and answered 16 at Stage 1 Task D1d, 18 at
 *    `860a469`, 19 at `5d11393`, 29 after Phase E wave 5 Task 2 added
 *    rules 2a, 6a and 21b–21e below, and 30 after wave 6 Task 1 added rule
 *    13a (`assertCanPublishMinutes`, R5).
 *
 *    **The command itself is deliberately not reproduced here**, and that is
 *    not squeamishness: its pattern is a substring of every signature it
 *    counts, so writing it in this file makes the file match itself and the
 *    command answers one MORE than the number of rules. That happened — a
 *    draft of this very paragraph pasted the command and turned 29 into 30,
 *    caught by re-running it rather than by reading. Quote it from `trpc.ts`,
 *    the conventions, or `board-scope.test.ts`; never from here.
 *
 *    Every code the two `designated_boards` permission templates grant —
 *    `TEMPLATE_BOARD_SPECIFIC_STAFF` (A1 A2 A3 A5 A6 M1–M7 R1–R6) and
 *    `TEMPLATE_RECORDING_SECRETARY` (M2 M3 M4 M5 R1 R2 R3 R4 R6) — is granted
 *    ONLY inside `board_overrides`, with global all-false. A guard that
 *    resolves such a code globally answers "no" to every account either
 *    template ever created. Those templates have never worked, and this is
 *    half of why (the other half was a stale closure in
 *    `StaffAccountFlow.tsx`, which discarded the overrides before they were
 *    ever persisted).
 *
 *    What stays town-level is stated positively: C2 (the notification rules,
 *    17–19). Neither `designated_boards` template grants C2, and a
 *    notification event belongs to a town, not to a board — there is no board
 *    column to scope it by.
 *
 * 3. **SELECT rules come in three forms.** `canX` answers the question,
 *    `assertCanX` throws, and `visibleX` filters a list. A list endpoint that
 *    threw on the first invisible row would be unusable; a detail endpoint
 *    that filtered would return 200 with nothing. Both shapes exist so the
 *    caller picks rather than improvises.
 *
 *    The list forms are why board scope arrives on the ROW rather than as one
 *    argument: `visibleMinutesDocuments` filters minutes from many meetings,
 *    and a single `scope` would apply one board's answer to another board's
 *    row. The board is a property of the row, so the row carries it, and the
 *    type makes it non-optional so a caller cannot forget the join. See
 *    `BoardScopedRow` below for where that value must come from.
 *
 * 4. **The message is part of the rule.** A refusal names the code and says
 *    who can grant it. "Forbidden" gives a town clerk nothing to act on and
 *    gives support nothing to diagnose.
 *
 * ─── What is deliberately NOT here ────────────────────────────────────────
 *
 * Tenancy. Not one rule in this file compares a `town_id`, because RLS does
 * that underneath every query and doing it twice — in two places, with two
 * chances to drift — is how the weaker copy eventually becomes the one people
 * trust. If a rule in this file looks like it wants to check a town id, the
 * query it guards is not inside `withTenant` and that is the bug.
 */

import type { Actor } from "./actor.js";
import type { TenantTx } from "../../db/with-tenant.js";
import { sql } from "drizzle-orm";
import { toRows } from "../../db/rows.js";
import {
  AuthorizationError,
  assertAdmin,
  assertPermission,
  isAdmin,
  isBoardMember,
  resolvePermission,
} from "./permission.js";

/** Exported so tests can hold these guards in a uniformly typed list. */
export type ActorArg = Actor;

/**
 * The board a board-scoped check is about. Required wherever it appears.
 *
 * Not optional, and not defaulted. An optional board silently performs the
 * GLOBAL check, which is wrong in both directions — see this file's header,
 * point 2 — and "wrong quietly" is the failure mode this whole layer exists
 * to remove.
 */
export interface BoardScope {
  boardId: string;
}

/**
 * A row a board-scoped SELECT rule can be asked about.
 *
 * ─── Where `boardId` must come from ───────────────────────────────────────
 *
 * `meeting.board_id` is NOT NULL, and every row these rules filter reaches a
 * meeting: `minutes_document.meeting_id`, `exhibit.agenda_item_id` →
 * `agenda_item.meeting_id`. So a board is always available and the field is
 * `string`, not `string | null` — there is no legitimate row without one.
 *
 * `minutes_document` ALSO carries its own nullable `board_id` column. Do not
 * read that one. It is denormalised and nullable, so a row where it is NULL
 * would have to be either dropped from the list or resolved globally, and
 * both of those are the silent-wrong-answer this type exists to prevent.
 * Join through the meeting.
 */
export interface BoardScopedRow {
  boardId: string;
}

// ═══════════════════════════════════════════════════════════════════════
// The 21 action-code rules
// ═══════════════════════════════════════════════════════════════════════

// ─── 1, 2 — agenda_item INSERT / UPDATE: A2, BOARD-SCOPED ─────────────
//
// A2 is in `TEMPLATE_BOARD_SPECIFIC_STAFF`, which grants it per board only.
//
// DELETE is A2 as well, and has no function here on purpose (Phase E wave 4,
// Task 1 — read this before adding one). There is no delete-specific
// `PermissionCode`: A2 (`edit_agenda`) is the governing action for the
// agenda's contents, so an `assertCanDeleteAgendaItem` would be a third body
// identical to the two below — and one with no caller, because
// `agendaItem.delete`'s guard is `requireBoardPermission("A2", boardIdFrom(),
// {action: "to remove an agenda item"})`, which IS this same
// `assertPermission` call (conventions item 2's "reach for
// requireBoardPermission first" for a single-code rule; `meeting.ts`'s header
// makes the same argument for `assertCanInsertMeeting`). The absence is a
// decision, not an oversight — see `routers/agenda-item.ts`'s header.

export function assertCanInsertAgendaItem(actor: Actor, scope: BoardScope): void {
  assertPermission(actor, "A2", { boardId: scope.boardId, action: "to add an agenda item" });
}

export function assertCanUpdateAgendaItem(actor: Actor, scope: BoardScope): void {
  assertPermission(actor, "A2", { boardId: scope.boardId, action: "to edit an agenda item" });
}

// ─── 2a — agenda_item's LIVE-RUN columns: A2 or M1, BOARD-SCOPED ──────
//
// Phase E wave 5, Task 2. This settles the question wave 4, Task 1 wrote
// down and deliberately did not answer, in `routers/agenda-item.ts`'s header:
//
//   "both use A2, matching every other `agenda_item` write, but a live-meeting
//    operator may hold M1/M2 and no A2 — if the product wants a presiding
//    officer with no agenda-editing rights to mark items complete, that is a
//    rules change (a second code, hence `requireBoardActor`), not a wiring
//    change, and it should be made deliberately rather than discovered when a
//    clerk is refused mid-meeting."
//
// **Answered: A2 OR M1, for the live-run columns only.** Two columns on
// `agenda_item` are not agenda CONTENT and are never written from the agenda
// builder:
//
//   `status`         — pending / active / completed / deferred: where the
//                      MEETING has got to. Written by navigating to an item
//                      (`active`), by marking one done (`completed`) and by
//                      adjourning with items unreached (`deferred`).
//   `operator_notes` — the presiding officer's running note on how an item
//                      went. Nothing outside the live screen writes it and
//                      nothing published reads it.
//
// Neither changes what the agenda SAYS, which is what A2 (`edit_agenda`)
// governs; both are produced by running the meeting, which is M1
// (`start_run_meeting`). Requiring A2 for them is the mid-meeting refusal the
// header predicted: an operator seated to run a board's meetings holds M1 and
// need not hold A2 at all.
//
// **A2 stays in the rule rather than being replaced by M1**, deliberately.
// Dropping it would NARROW what ships today. `setOperatorNotes` and
// `markComplete` were guarded `requireBoardPermission("A2", …)` before this
// task; at HEAD they are `requireBoardActor(assertCanUpdateAgendaItemProgress)`
// below, and dropping the A2 branch out of that function would refuse a
// hand-built matrix holding A2 without M1. Nothing in the five shipped
// templates is affected either way (every template granting A2 also grants
// M1: Town Clerk, Deputy Clerk and Board-Specific Staff; Recording Secretary
// and General Staff grant neither), so the widening costs nothing and the
// narrowing would buy nothing.
//
// It is also the rule that makes ADJOURNMENT coherent. `handleMeetingEnd`
// (`routes/meetings.$meetingId.live.tsx`, which wave 5 Task 3 moves whole into
// one procedure) writes `agenda_item.status = 'deferred'` in the same
// transaction as `future_item_queue` INSERT, `agenda_item_transition` UPDATE
// and `meeting.status = 'adjourned'`. The other three are M1 (rules 21d, 21e,
// and `assertCanUpdateMeeting`'s M1 branch). Had this one stayed A2-only, an
// M1 presiding officer's adjournment would have been refused halfway through —
// a partial adjournment, which is worse than either answer.
//
// NOT admin-branched, unlike `assertCanUpdateMeeting` which opens with
// `isAdmin(actor)`: `resolvePermission` already short-circuits `admin` to true
// for every code (`permission.ts`), so an explicit branch here would be a
// second statement of the same fact.
//
// Sibling writes NOT covered by this rule: every content column on
// `agenda_item` — title, description, sort_order, section_type, parent_item_id
// — stays A2 through `assertCanUpdateAgendaItem` above. A rule wide enough for
// the live screen must not become the rule the agenda builder uses.

export function assertCanUpdateAgendaItemProgress(actor: Actor, scope: BoardScope): void {
  if (resolvePermission(actor, "A2", scope.boardId)) return;
  if (resolvePermission(actor, "M1", scope.boardId)) return;
  throw new AuthorizationError(
    "Recording an agenda item's progress during a meeting requires M1 (start_run_meeting) " +
      "or A2 (edit_agenda) for this board.",
    { code: "M1", boardId: scope.boardId },
  );
}

// ─── 3, 4 — motion INSERT / UPDATE: M3, BOARD-SCOPED ──────────────────
//
// M3 is in BOTH `designated_boards` templates — a recording secretary
// appointed to one board is the canonical holder of it.

export function assertCanInsertMotion(actor: Actor, scope: BoardScope): void {
  assertPermission(actor, "M3", { boardId: scope.boardId, action: "to record a motion" });
}

export function assertCanUpdateMotion(actor: Actor, scope: BoardScope): void {
  assertPermission(actor, "M3", {
    boardId: scope.boardId,
    action: "to record a motion's outcome",
  });
}

// ─── 5 — vote_record INSERT: M3, or your own seat ─────────────────────

export interface VoteRecordSubject extends BoardScope {
  /** The `board_member.id` the vote is being recorded against. */
  boardMemberId: string;
}

/**
 * A vote may be recorded by a clerk holding M3, or by a board member casting
 * their own vote (M8).
 *
 * The self-vote branch is a database question, not a claim: it asks whether
 * `boardMemberId` is one of THIS person's ACTIVE seats. Trusting a
 * client-supplied "this is me" would let any board member vote as any other,
 * and an archived seat must not vote at all — a member whose term ended still
 * has a `board_member` row, and it is the `status` that stops it counting.
 *
 * The M3 branch is board-scoped like every other M3 check. `boardId` is the
 * MEETING's board, which is also the board the seat is on; it is carried on
 * the subject rather than as a separate argument because this guard already
 * takes one, and two ways of saying "which board" is one too many.
 */
export async function assertCanInsertVoteRecord(
  actor: Actor,
  tx: TenantTx,
  subject: VoteRecordSubject,
): Promise<void> {
  if (resolvePermission(actor, "M3", subject.boardId)) return;

  if (isBoardMember(actor) && actor.personId) {
    const rows = toRows<{ id: string }>(
      await tx.execute(sql`
        SELECT id FROM board_member
        WHERE id = ${subject.boardMemberId}
          AND person_id = ${actor.personId}
          AND status = 'active'
      `),
      (message) => new Error(`assertCanInsertVoteRecord: ${message}`),
    );
    if (rows.length === 1) return;
  }

  throw new AuthorizationError(
    "This account cannot record that vote. Recording another member's vote requires M3 " +
      "(capture_motions_votes) for this board; a board member may record their own vote on a " +
      "seat they currently hold.",
    { code: "M3", boardId: subject.boardId },
  );
}

// ─── 6 — vote_record UPDATE: M3, BOARD-SCOPED ─────────────────────────

/**
 * Correcting a recorded vote is narrower than casting one, on purpose: it is a
 * records action over a legal record, so the self-vote branch does not apply.
 */
export function assertCanUpdateVoteRecord(actor: Actor, scope: BoardScope): void {
  assertPermission(actor, "M3", {
    boardId: scope.boardId,
    action: "to correct a recorded vote",
  });
}

// ─── 6a — vote_record DELETE: M3, BOARD-SCOPED. NOT the self-vote ─────
//
// Phase E wave 5, Task 2. This is NOT the third identical copy that
// `assertCanDeleteAgendaItem` would have been (rules 1/2's comment above):
// `vote_record` has TWO rules with DIFFERENT answers, so "which one does
// DELETE resemble" is a real question with a wrong answer available, where
// `agenda_item`'s DELETE had one code stated twice and nothing to decide.
//
// It resembles UPDATE, not INSERT. Rule 5's second branch lets a board member
// record their OWN vote on a seat they currently hold (M8, the one code in
// `BOARD_MEMBER_ALWAYS_ACTIONS` any rule here consults). Carried into DELETE
// that branch would let a member erase a recorded vote of theirs — and the
// erasure the product actually performs is worse than one row:
// `VotePanel.tsx`'s re-vote is
// `supabase.from("vote_record").delete().eq("motion_id", motionId)`, which
// removes EVERY member's vote on that motion before re-inserting the tally. A
// self-vote branch would be a licence to delete other people's votes, since
// the statement is not keyed by seat at all.
//
// So: M3 only, the same reading rule 6 gives for correcting a vote — a records
// action over a legal record, not the act of casting one.

export function assertCanDeleteVoteRecord(actor: Actor, scope: BoardScope): void {
  assertPermission(actor, "M3", {
    boardId: scope.boardId,
    action: "to clear a motion's recorded votes",
  });
}

// ─── 7, 8 — meeting_attendance INSERT / UPDATE: M2, BOARD-SCOPED ──────

export function assertCanInsertMeetingAttendance(actor: Actor, scope: BoardScope): void {
  assertPermission(actor, "M2", { boardId: scope.boardId, action: "to record attendance" });
}

export function assertCanUpdateMeetingAttendance(actor: Actor, scope: BoardScope): void {
  assertPermission(actor, "M2", {
    boardId: scope.boardId,
    action: "to change recorded attendance",
  });
}

// ─── 9 — minutes_document SELECT: R4, or adopted ──────────────────────

export type MinutesStatus = "draft" | "review" | "approved" | "published";

const ADOPTED_MINUTES_STATUSES: readonly MinutesStatus[] = ["approved", "published"];

/**
 * Draft and in-review minutes are visible only with R4. Approved and published
 * minutes are visible to every member of the town — they are the public record.
 *
 * This is one of the three reads that Phase B's tenancy-only RLS left open to
 * any session with a tenant context, and it is the one that matters most:
 * unadopted minutes of an executive session are the single most sensitive
 * document this product holds.
 */
export interface MinutesDocumentRow extends BoardScopedRow {
  status: MinutesStatus;
}

export function canSelectMinutesDocument(actor: Actor, row: MinutesDocumentRow): boolean {
  // Deliberately STRICTER than the policy this restores, which read
  // `has_permission('R4') OR status IN ('approved','published')` — no actor
  // term at all in the second branch, because a policy only ever evaluated
  // inside an authenticated town context. The portal is about to get a tenant
  // context too, and then that second branch would hand the public a town's
  // APPROVED-but-unpublished minutes: adopted by the board, not yet put on the
  // website. Requiring a signed-in actor closes that, changes nothing for any
  // signed-in caller, and forces the portal to go through
  // `portalCanSelectMinutesDocument` below, which is `published` only.
  if (actor.kind !== "user") return false;
  if (ADOPTED_MINUTES_STATUSES.includes(row.status)) return true;
  // R4 board-scoped: `TEMPLATE_RECORDING_SECRETARY` grants R4 per board and
  // nothing globally, so a global check answers "no" to every secretary the
  // product has ever created for a designated board.
  return resolvePermission(actor, "R4", row.boardId);
}

export function assertCanSelectMinutesDocument(actor: Actor, row: MinutesDocumentRow): void {
  if (canSelectMinutesDocument(actor, row)) return;
  throw new AuthorizationError(
    `These minutes are still ${row.status}. Reading minutes before they are adopted ` +
      "requires R4 (view_draft_minutes) for this board.",
    { code: "R4", boardId: row.boardId },
  );
}

export function visibleMinutesDocuments<T extends MinutesDocumentRow>(
  actor: Actor,
  rows: readonly T[],
): T[] {
  // Per ROW, not per call: a list can span boards, and one `scope` argument
  // would answer for the first board and apply it to all of them.
  return rows.filter((row) => canSelectMinutesDocument(actor, row));
}

// ─── 10, 11, 12, 13 — minutes writes: R1, BOARD-SCOPED ────────────────
//
// R1 is in both `designated_boards` templates.

export function assertCanInsertMinutesDocument(actor: Actor, scope: BoardScope): void {
  assertPermission(actor, "R1", { boardId: scope.boardId, action: "to create minutes" });
}

export function assertCanUpdateMinutesDocument(actor: Actor, scope: BoardScope): void {
  assertPermission(actor, "R1", { boardId: scope.boardId, action: "to edit minutes" });
}

export function assertCanInsertMinutesSection(actor: Actor, scope: BoardScope): void {
  assertPermission(actor, "R1", { boardId: scope.boardId, action: "to add a minutes section" });
}

export function assertCanUpdateMinutesSection(actor: Actor, scope: BoardScope): void {
  assertPermission(actor, "R1", { boardId: scope.boardId, action: "to edit a minutes section" });
}

// ─── 13a — minutes_document PUBLISH/UNPUBLISH: R5, BOARD-SCOPED ───────
//
// Phase E wave 6, Task 1. The third consecutive wave to find a code the
// product defines, a screen acts on, and nothing in `packages/api` stands
// between: A5 in wave 4 (rule 21a), M6/M7 in wave 5 (21b, 21e), R5 here.
// Before this commit:
//
//   $ grep -rn '"R5"\|"R6"' packages/api/src --include='*.ts' | grep -v __tests__
//   (no output)
//
// — the same fixture-only footprint the other three had, and for R5 the same
// two fixtures: `admin-gates.test.ts`'s maximal matrix and
// `require-permission.test.ts`'s `BOARD_SCOPED_CODES` roster.
//
// **This one widens silently, which the other three did not.** A5, M6 and M7
// governed actions that were simply unguarded; adding a rule REFUSED callers
// who had been allowed, and anything relying on the old behaviour broke
// loudly. R5's hazard runs the other way: `minutes.tsx` gates its Publish
// button on R5 in the browser, and the write behind it is a raw, unauthorized
// `minutes_document` UPDATE. The only minutes-document write rule that exists
// is `assertCanUpdateMinutesDocument` — **R1** — so migrating publish behind
// the nearest existing guard would compile, pass every test, refuse nobody who
// is refused today, and hand `TEMPLATE_RECORDING_SECRETARY` (M2 M3 M4 M5 R1 R2
// R3 R4 R6 — R1 WITHOUT R5, by design) the power to put minutes on the public
// portal. Nothing would have failed. That is why this rule is written before
// any screen is wired, not after.
//
// Publishing is a SEPARATE act from editing, exactly as rule 21a argues for
// A5 against A2: R1 (`edit_draft_minutes`) is who may change what the minutes
// SAY; R5 (`publish_approved_minutes`) is who may make an adopted record
// public. Two of the five shipped templates grant R1 and withhold R5
// (`TEMPLATE_RECORDING_SECRETARY`, `TEMPLATE_DEPUTY_CLERK`), so the
// distinction is one towns have already been offered.
//
// **UNPUBLISHING is R5 too**, not a narrower gate, for the reason rule 21b
// gives for `executive_session`'s DELETE being M6: it is the undoing of the
// act this code governs, and an authority that can publish minutes but cannot
// pull them back has no way to correct its own mistake without an
// administrator. `TEMPLATE_TOWN_CLERK` grants R5 to a `staff` account, so
// "ask an admin" is a real operational cost, not a formality. Recorded as a
// decision: today's UI shows Unpublish to administrators only (`isAdmin`),
// while the server enforces nothing at all, so R5 here is a large narrowing
// against the server and a small widening against the button.
//
// **That widening is reversible, but not in the one line it looks like.**
// Swapping only this `.use()` for `requireActor(assertAdmin, ...)` throws
// `assertMatchesAuthorizedBoard`'s wiring `Error` — reproduced directly, an
// admin caller gets a 500 — because `unpublish` still resolves scope through
// `assertMinutesDocumentOnAuthorizedBoard`, which sets and checks
// `ctx.authorizedBoardId`, and `requireActor` never sets it. The real
// reversal is TWO lines: that guard swap, plus trading
// `assertMinutesDocumentOnAuthorizedBoard` for `resolveMinutesDocumentScope`
// in the procedure body, after which `boardId` in the input is dead. See
// `minutes-document.ts`'s `unpublish` doc comment for the exact two lines.
//
// `minutesDocument.publish`/`unpublish` reach this code through
// `requireBoardPermission("R5", boardIdFrom())` rather than importing this
// function — that middleware resolves exactly one `PermissionCode` via
// `assertPermission`, which IS the call below (rule 21a's own note, and
// conventions item 2's "reach for `requireBoardPermission` FIRST"). The
// function exists for the reason rule 21a's does: R5 had no entry in this file
// at all, so a reader auditing "what governs publishing minutes" found
// nothing, and `board-scope.test.ts`'s rule-by-rule table needs a callable
// form to cover R5 the way it covers A1–A3, A5, M1, M2, M3, M6, M7, R1 and R4.
//
// ─── R6 (`export_minutes`) deliberately gets NO rule ──────────────────
//
// It is the other half of the same grep and the answer came out differently.
// R6's only consumer anywhere is `minutes.tsx`'s `canExport`, which gates a
// "Download PDF" link — a READ of a minutes document, and reads of that
// document are already decided, on every fetch, by rule 9 above:
// `GET /api/files/minutes/:documentId` → `resolveMinutesDocumentForDownload`
// → `assertCanSelectMinutesDocument`. Three reasons not to add a second gate
// in front of it:
//
//   1. It would NARROW a read the portal already serves to the anonymous
//      public once published, which is rule 9b's "a narrower rule for members
//      would be theatre" argument, unchanged.
//   2. It would refuse every `board_member` reading their own board's adopted
//      minutes: R6 is a delegable staff code and no board-member account is
//      created with one.
//   3. It discriminates nobody today in any case. Across all five shipped
//      templates R6 is granted exactly where R4 is — TOWN_CLERK (R4 R5 R6),
//      DEPUTY_CLERK (R4 R6), BOARD_SPECIFIC_STAFF (R4 R5 R6), GENERAL_STAFF
//      (R4 R6), RECORDING_SECRETARY (R4 R6) — so an R6 gate ahead of a rule-9
//      check changes no answer while adding a second place for the two to
//      drift apart.
//
// R5 is the code that actually separates the templates (only TOWN_CLERK and
// BOARD_SPECIFIC_STAFF hold it); R6 tracks R4 exactly. Recorded here so the
// next sweep that greps for an unenforced code finds the decision instead of
// re-deriving it.

export function assertCanPublishMinutes(actor: Actor, scope: BoardScope): void {
  assertPermission(actor, "R5", {
    boardId: scope.boardId,
    action: "to publish approved minutes to the public portal",
  });
}

// ─── 13b — minutes ADOPTION: the administrator, no code ───────────────
//
// Phase E wave 6, Task 1. `approve` and `returnForAmendments` are the two
// outcomes of one decision — whether the board adopts the minutes — and
// neither is keyed to a `PermissionCode`, because there is no governable
// action for adopting minutes among the thirty.
//
// That is not an oversight this task fixes. `routes/minutes.ts`'s approve
// route already states it and states why it is still open: its guard was once
// `requirePermission("approve_minutes")`, an action that does not exist, so
// the matrix lookup could never return true and only the admin short-circuit
// ever admitted anybody. Task G1 replaced it with `requireAdmin` as
// BEHAVIOUR-IDENTICAL and flagged "whether minutes approval should instead be
// delegable (R5 is the nearest existing action)" as a product decision for the
// owner — re-flagged in D1f's report, still open. Minting a code here, or
// reaching for R5 because it is nearby, would make that decision inside a
// migration. So these two reproduce today's answer exactly: the town
// administrator, and nobody else.
//
// Not `assertAdmin`, whose message says "one of the governance actions
// (T1–T4) that cannot be delegated" — that sentence is true of the town
// profile and false here, where the open question is precisely whether this
// should become delegable. The message is part of the rule (this file's
// header, point 4).

function assertMinutesAdoptionAdmin(actor: Actor, action: string): void {
  if (isAdmin(actor)) return;
  throw new AuthorizationError(
    `Only a town administrator can ${action}. Adopting minutes has no delegable action ` +
      "code — see routes/minutes.ts for the open product decision about whether it should.",
  );
}

export function assertCanApproveMinutes(actor: Actor): void {
  assertMinutesAdoptionAdmin(actor, "adopt minutes on behalf of the board");
}

export function assertCanReturnMinutesForAmendments(actor: Actor): void {
  assertMinutesAdoptionAdmin(actor, "return minutes to the clerk for amendments");
}

// ─── 9a — the four board-scoped codes the legacy routes guard ─────────
//
// Stage 1, Task D1f. A6, R1, R2 and R3 were resolved by `plugins/auth.ts` with
// NO board id — `requirePermission(action)` is a Fastify preHandler and a
// preHandler has no meeting to resolve one from. `permission.ts` states what
// that costs, and it is not fail-closed in either direction:
//
//   an override that GRANTS  is ignored → a board-designated clerk is refused
//                              everywhere, and both `designated_boards`
//                              templates grant these codes ONLY per board with
//                              global all-false, so such an account held
//                              nothing at all;
//   an override that REVOKES is ignored → a clerk explicitly barred from a
//                              board could still generate its agenda packets
//                              and edit its draft minutes.
//
// The second is the live defect. It could not be fixed in the guard, because
// the guard has nowhere to obtain a board; the fix is that the SIX routes
// (`documents.ts` ×2, `minutes.ts` ×4) now resolve the meeting first and call
// these, against `meeting.board_id`.
//
// R1 already had a home above (rules 10–13 — the same code, the same board,
// arrived at from the tRPC side), so `assertCanUpdateMinutesDocument` is what
// the render route calls and nothing is duplicated for it.

export function assertCanGenerateMeetingDocument(actor: Actor, scope: BoardScope): void {
  assertPermission(actor, "A6", {
    boardId: scope.boardId,
    action: "to generate this meeting's documents",
  });
}

export function assertCanGenerateMinutes(actor: Actor, scope: BoardScope): void {
  assertPermission(actor, "R2", { boardId: scope.boardId, action: "to generate minutes" });
}

export function assertCanSubmitMinutesForReview(actor: Actor, scope: BoardScope): void {
  assertPermission(actor, "R3", {
    boardId: scope.boardId,
    action: "to submit minutes for review",
  });
}

// ─── 9b — the generated meeting documents: A6, or published ───────────
//
// Stage 1, Task D1f. NOT one of the 21 restored policies: the agenda packet
// and the meeting notice had no row-level policy to restore, because they were
// not rows. They were PDFs in the Supabase `documents` bucket, which is
// declared `public = true`, reachable at
// `${townId}/meetings/${meetingId}/agenda-packet-${Date.now()}.pdf` — and the
// portal publishes both ids, so the only secret was a millisecond timestamp.
// The URL was then written into `meeting.agenda_packet_url` and handed to
// anyone who could read the meeting.
//
// Moving those bytes into the authorized document root means deciding, for the
// first time, who may read one. This is that decision, and it is shaped after
// rule 9 rather than invented: the caller who may GENERATE the document (A6
// for that board, the same code `routes/documents.ts` guards the POST with),
// or ANY signed-in member of the town once the agenda is published — at which
// point `routes/portal.ts` serves the same file to the anonymous public, so a
// narrower rule for members would be theatre.
//
// It is strictly narrower than what it replaces in every case, because what it
// replaces was "anyone at all".

export interface MeetingDocumentRow extends BoardScopedRow {
  agendaStatus: string | null;
  meetingStatus: string;
}

export function canSelectMeetingDocument(actor: Actor, row: MeetingDocumentRow): boolean {
  // The portal reaches its own copies of these through `portalCanSelectAgenda`
  // directly; an anonymous actor must not arrive here and be answered "yes"
  // by the published branch, because that branch is about members of the town.
  if (actor.kind !== "user") return false;
  if (portalCanSelectAgenda({ agendaStatus: row.agendaStatus, meetingStatus: row.meetingStatus })) {
    return true;
  }
  // A6 board-scoped: `TEMPLATE_BOARD_SPECIFIC_STAFF` grants A6 per board and
  // nothing globally, so a global check answers "no" to every board-designated
  // clerk — and ignores an override that REVOKES it for one board.
  return resolvePermission(actor, "A6", row.boardId);
}

export function assertCanSelectMeetingDocument(actor: Actor, row: MeetingDocumentRow): void {
  if (canSelectMeetingDocument(actor, row)) return;
  throw new AuthorizationError(
    "This meeting's agenda has not been published, so its generated documents are " +
      "not yet public record. Reading one before publication requires A6 " +
      "(generate_agenda_packet) for this board.",
    { code: "A6", boardId: row.boardId },
  );
}

// ─── 14 — exhibit SELECT: three tiers, three rules ────────────────────

export type ExhibitVisibility = "public" | "board_only" | "admin_only";

/**
 * `public`     → every member of the town.
 * `board_only` → an administrator, OR A3, OR the `board_member` role.
 * `admin_only` → an administrator, OR A3.
 *
 * The difference between the last two is the entire point of having two
 * tiers: `admin_only` is where a staff memo about a personnel matter lands,
 * and a board member holding no staff permission must not see it.
 */
export interface ExhibitRow extends BoardScopedRow {
  visibility: ExhibitVisibility;
}

export function canSelectExhibit(actor: Actor, row: ExhibitRow): boolean {
  switch (row.visibility) {
    case "public":
      // Every member of the town, which for a signed-in actor is everyone.
      // The portal reaches published exhibits through its own rule below, not
      // through this one.
      return actor.kind === "user";
    case "board_only":
      return isAdmin(actor) || resolvePermission(actor, "A3", row.boardId) || isBoardMember(actor);
    case "admin_only":
      return isAdmin(actor) || resolvePermission(actor, "A3", row.boardId);
    default:
      // An unrecognised visibility is the most restrictive one, not the least.
      return false;
  }
}

export function assertCanSelectExhibit(actor: Actor, row: ExhibitRow): void {
  if (canSelectExhibit(actor, row)) return;
  throw new AuthorizationError(
    `This attachment is marked ${row.visibility}. Reading it requires ` +
      (row.visibility === "board_only"
        ? "a board seat, A3 (upload_attachments_staff) for this board, or the administrator role."
        : "A3 (upload_attachments_staff) for this board, or the administrator role."),
    { code: "A3", boardId: row.boardId },
  );
}

export function visibleExhibits<T extends ExhibitRow>(actor: Actor, rows: readonly T[]): T[] {
  // Per ROW — see `visibleMinutesDocuments`. An agenda packet's attachments
  // can span boards as soon as anything lists across meetings.
  return rows.filter((row) => canSelectExhibit(actor, row));
}

// ─── 15, 16 — exhibit writes: A3, BOARD-SCOPED ────────────────────────

/** A3 for this board, or the board_member role — A4, "upload for review". */
export function assertCanInsertExhibit(actor: Actor, scope: BoardScope): void {
  if (resolvePermission(actor, "A3", scope.boardId) || isBoardMember(actor)) return;
  throw new AuthorizationError(
    "Uploading an attachment requires A3 (upload_attachments_staff) for this board. Board " +
      "members may upload their own material without it.",
    { code: "A3", boardId: scope.boardId },
  );
}

/**
 * A3 only — and deliberately not the board-member branch above, because UPDATE
 * is how an exhibit's VISIBILITY changes. If board members could update, one
 * could promote an `admin_only` staff memo to `public`.
 */
export function assertCanUpdateExhibit(actor: Actor, scope: BoardScope): void {
  assertPermission(actor, "A3", {
    boardId: scope.boardId,
    action: "to change an attachment or its visibility",
  });
}

// ═══════════════════════════════════════════════════════════════════════
// 17, 18, 19 — the C2 rules. TOWN-LEVEL, deliberately.
//
// These three keep a global check while the board-scoped ones above became
// board-scoped, and that is a decision rather than an oversight:
//
//   - Neither `designated_boards` template grants C2, so no account exists
//     whose C2 lives in `board_overrides` and would be missed.
//   - `notification_event`, `notification_delivery` and
//     `subscriber_notification_preference` have no board column. There is no
//     board to scope by; inventing one would mean choosing a board for a row
//     that does not have one, and every such choice is a guess.
//
// If a future template ever grants C2 per board, these are the three to
// revisit, and they are grouped here so that revisit is one place.
// ═══════════════════════════════════════════════════════════════════════

// ─── 17 — notification_event SELECT: C2 ───────────────────────────────

export function assertCanSelectNotificationEvent(actor: Actor): void {
  assertPermission(actor, "C2", { action: "to read the notification log" });
}

// ─── 18 — notification_delivery SELECT: C2, or your own ───────────────

/**
 * `subscriber_id` is a PERSON id, not a `user_account` id.
 *
 * That is the owner's Task 3 decision — subscriptions belong to a person,
 * because a board member with no login still gets notified — and comparing it
 * to the wrong id is not a type error, since both are uuids. It would show one
 * person another person's notification history, and would keep a
 * `subscriber_id === userAccountId` test green only because onboarding once
 * reused a single uuid for both.
 */
export function canSelectNotificationDelivery(
  actor: Actor,
  row: { subscriberId: string | null },
): boolean {
  if (resolvePermission(actor, "C2")) return true;
  return actor.personId !== null && row.subscriberId === actor.personId;
}

export function assertCanSelectNotificationDelivery(
  actor: Actor,
  row: { subscriberId: string | null },
): void {
  if (canSelectNotificationDelivery(actor, row)) return;
  throw new AuthorizationError(
    "Reading another person's notification deliveries requires C2 " +
      "(manage_notification_settings).",
    { code: "C2" },
  );
}

export function visibleNotificationDeliveries<T extends { subscriberId: string | null }>(
  actor: Actor,
  rows: readonly T[],
): T[] {
  return rows.filter((row) => canSelectNotificationDelivery(actor, row));
}

// ─── 19 — subscriber_notification_preference SELECT: own, or C2 ───────

export function canSelectSubscriberPreference(
  actor: Actor,
  row: { personId: string | null },
): boolean {
  if (actor.personId !== null && row.personId === actor.personId) return true;
  return resolvePermission(actor, "C2");
}

export function assertCanSelectSubscriberPreference(
  actor: Actor,
  row: { personId: string | null },
): void {
  if (canSelectSubscriberPreference(actor, row)) return;
  throw new AuthorizationError(
    "Reading another person's notification preferences requires C2 " +
      "(manage_notification_settings).",
    { code: "C2" },
  );
}

export function visibleSubscriberPreferences<T extends { personId: string | null }>(
  actor: Actor,
  rows: readonly T[],
): T[] {
  return rows.filter((row) => canSelectSubscriberPreference(actor, row));
}

// ─── 20 — meeting INSERT: A1, BOARD-SCOPED ────────────────────────────

export function assertCanInsertMeeting(actor: Actor, scope: BoardScope): void {
  assertPermission(actor, "A1", {
    boardId: scope.boardId,
    action: "to schedule a meeting for this board",
  });
}

// ─── 21 — meeting UPDATE: admin, or A1@board, or M1@board ─────────────

export function assertCanUpdateMeeting(actor: Actor, scope: BoardScope): void {
  if (isAdmin(actor)) return;
  if (resolvePermission(actor, "A1", scope.boardId)) return;
  if (resolvePermission(actor, "M1", scope.boardId)) return;
  throw new AuthorizationError(
    "Changing this meeting requires A1 (create_meeting) or M1 (start_run_meeting) for " +
      "this board, or the administrator role.",
    { code: "M1", boardId: scope.boardId },
  );
}

// ─── 21a — meeting agenda_status PUBLISH: A5, BOARD-SCOPED ────────────
//
// Phase E wave 4, Task 2. NOT one of the 21 restored policies — like 9a and
// 9b, this is a code that had no row-level policy to restore, and unlike them
// it had no guard ANYWHERE: before this commit, the only occurrences of the
// string "A5" in `packages/api` were two TEST FIXTURES
// (`admin-gates.test.ts`'s maximal matrix and `require-permission.test.ts`'s
// `BOARD_SCOPED_CODES` roster). `PERMISSIONS.A5` is `publish_agenda`, one of
// the thirty governable actions and one of the 18 `BOARD_SCOPED_CODES`
// (`TEMPLATE_BOARD_SPECIFIC_STAFF` grants it per board, global all-false), so
// an account existed that held it and nothing ever asked.
//
// Publishing is a SEPARATE act from editing, which is why this is not folded
// into rule 21 or into A2: A2 (`edit_agenda`) is who may change the agenda's
// contents; A5 is who may declare a version of it the public record. The two
// are granted independently by the permission matrix, and a clerk who drafts
// agendas is not automatically the person who publishes them.
//
// `meeting.publishAgenda` reaches this code through
// `requireBoardPermission("A5", boardIdFrom())` rather than importing this
// function — that middleware resolves exactly one `PermissionCode` via
// `assertPermission`, which IS the call below, so the code form is the same
// check and not a shortcut around it (`meeting.ts`'s header makes the
// identical argument for `assertCanInsertMeeting`, and conventions item 2
// says to reach for `requireBoardPermission` FIRST for a single-code rule).
//
// This function therefore exists for the reason the agenda_item DELETE
// comment above says a THIRD copy of A2 would not: A5 had no entry in this
// file at all, so a reader auditing the rules for "what governs publishing an
// agenda" found nothing and could reasonably conclude nothing governed it.
// Adding `assertCanDeleteAgendaItem` would have duplicated a code this file
// already documents twice; adding this documents a code this file did not
// mention once. It is also the callable form every other board-scoped code
// has, which `board-scope.test.ts`'s and `portal-rules.test.ts`'s
// rule-by-rule tables need in order to cover A5 the way they cover A1–A3.

export function assertCanPublishAgenda(actor: Actor, scope: BoardScope): void {
  assertPermission(actor, "A5", {
    boardId: scope.boardId,
    action: "to publish this meeting's agenda",
  });
}

// ═══════════════════════════════════════════════════════════════════════
// 21b–21e — the four live-meeting tables that had NO rule at all
//
// Phase E wave 5, Task 2. Same shape of hole as rule 21a's A5 and closed for
// the same reason, one wave on: the product defines a code, a screen acts on
// it, and nothing in `packages/api` stands in between. Before this commit the
// strings "M6" and "M7" occurred in `packages/api/src` in exactly ONE place —
// `require-permission.test.ts`'s `BOARD_SCOPED_CODES` roster, a test fixture —
// which is the SAME footprint A5 had before rule 21a (two fixtures) and the
// same reason a completeness sweep reads past it: a code named only by a
// roster is named by nothing that runs. (An earlier draft of this comment said
// "did not occur at ALL," which does not reproduce — `git grep -n -E "M6|M7"
// d796f29 -- packages/api` also finds the seed JSONB in `0000_baseline.sql`
// and this file's own `M1–M7` range on line 29.) And `executive_session`,
// `guest_speaker`, `agenda_item_transition` and `future_item_queue` were
// written by `routes/meetings.$meetingId.live.tsx`,
// `components/meeting/GuestSpeakerEntry.tsx`,
// `components/meeting/ExitExecutiveSessionDialog.tsx` and
// `components/meeting/MeetingStartFlow.tsx` straight through the Supabase
// client with no authorization check of any kind.
//
// **RLS does not cover for that on any of the four.** Each carries a plain
// `FOR ALL USING (town_id = get_current_town_id()) WITH CHECK (…)` —
// `executive_session_tenant_isolation`, `guest_speaker_tenant_isolation`,
// `agenda_item_transition_tenant_isolation`,
// `future_item_queue_tenant_isolation` in `0000_baseline.sql` — no board
// predicate and no role predicate, verified directly. Any signed-in member of
// the town gets past all four today.
//
// ─── One function per write the product performs, and why that differs ────
// ─── from rules 1/2's decision NOT to add `assertCanDeleteAgendaItem` ─────
//
// That decision turned on A2 being stated TWICE in this file already, so a
// reader auditing "what governs deleting an agenda item" found the code and a
// paragraph saying DELETE is A2 as well. Here the file states M6, M7 and M1
// zero times, so the first statement of "M6 governs executive_session" has to
// exist, and the operations differ in what a refusal must be able to tell the
// caller (this file's header, point 4: "the message is part of the rule").
// Every function below corresponds to a write `packages/web` actually
// performs; none is speculative, and the operations the product does NOT
// perform (a `guest_speaker` UPDATE, a `future_item_queue` UPDATE or DELETE)
// get no function, because a rule with neither a caller nor a write to
// describe is a name rather than a check.
//
// All four are single-code, so conventions item 2's "reach for
// `requireBoardPermission` FIRST" applies at the call sites wave 5, Task 3
// writes: `requireBoardPermission("M6", boardIdFrom(), {action})` IS the
// `assertPermission` call below, not a shortcut around it. The functions exist
// to state the rule in the file that holds the rules, and so that
// `board-scope.test.ts`'s family table can prove each new code is actually
// board-scoped.
//
// M6 and M7 are both in `TEMPLATE_BOARD_SPECIFIC_STAFF` (and in
// `TEMPLATE_TOWN_CLERK`), M1 in three of the five templates — so all three are
// in `BOARD_SCOPED_CODES` and every one of them is granted per board with
// global all-false by the `designated_boards` templates. A global check would
// answer "no" to every account either template ever created; hence
// `BoardScope`, required, like every other board-scoped rule here.
// ═══════════════════════════════════════════════════════════════════════

// ─── 21b — executive_session INSERT / UPDATE / DELETE: M6 ─────────────
//
// M6 is `trigger_executive_session`. The three writes are one authority:
// filing the pending session record when the entry motion is made (INSERT),
// stamping `entered_at` when that motion passes and `exited_at` when the board
// returns to open session, plus appending the post-session action motions
// (UPDATE), and discarding the pending record when the entry motion FAILS
// (DELETE — `live.tsx`'s reactive `motionStatus === "failed"` branch).
//
// The DELETE is the undoing of a session that never began, not the destruction
// of a record of one; there is no narrower code for it and inventing a second
// authority to cancel what M6 created would mean a board could enter executive
// session and then be unable to unwind a failed motion.

export function assertCanInsertExecutiveSession(actor: Actor, scope: BoardScope): void {
  assertPermission(actor, "M6", {
    boardId: scope.boardId,
    action: "to move this meeting into executive session",
  });
}

export function assertCanUpdateExecutiveSession(actor: Actor, scope: BoardScope): void {
  assertPermission(actor, "M6", {
    boardId: scope.boardId,
    action: "to change an executive session record",
  });
}

export function assertCanDeleteExecutiveSession(actor: Actor, scope: BoardScope): void {
  assertPermission(actor, "M6", {
    boardId: scope.boardId,
    action: "to discard a pending executive session",
  });
}

// ─── 21c — guest_speaker INSERT / DELETE: M7 ──────────────────────────
//
// M7 is `manage_speaker_queue`, and the queue is exactly what these two rows
// are: `GuestSpeakerEntry.tsx` adds a name to the public-comment list and
// removes one from it. The product performs no UPDATE — an edit is a remove
// and a re-add — so there is no update rule.
//
// `guest_speaker` is deliberately NOT linked to a `person` row (the table's
// own comment in `0000_baseline.sql` says so, citing advisory 1.2), so there
// is no self-scoping branch to consider the way rule 5 has one: a guest is not
// an account and cannot act here at all.

export function assertCanInsertGuestSpeaker(actor: Actor, scope: BoardScope): void {
  assertPermission(actor, "M7", {
    boardId: scope.boardId,
    action: "to add a speaker to the queue",
  });
}

export function assertCanDeleteGuestSpeaker(actor: Actor, scope: BoardScope): void {
  assertPermission(actor, "M7", {
    boardId: scope.boardId,
    action: "to remove a speaker from the queue",
  });
}

// ─── 21d — agenda_item_transition INSERT / UPDATE: M1 ─────────────────
//
// No code names this table, because no user ever acts on one. A transition row
// is a CLOCK: the table's own comment is "Tracks time spent on each agenda
// item during live meetings." It is opened when the meeting moves to an item
// and closed (`ended_at`) when it moves off, and it is written from exactly
// three places, all of them the act of running a meeting — `MeetingStartFlow`
// (call to order opens the first one), `live.tsx`'s `navigateToItem` (close
// the current, open the next) and `handleMeetingEnd` (close the last).
//
// **It takes the code of the action that causes it: M1, `start_run_meeting`.**
// Two reasons rather than one, because "the causing action" alone would be a
// guess:
//
//   1. Every transition write is accompanied, in the same user action, by a
//      write to `meeting.current_agenda_item_id` — and that write is already
//      governed by `assertCanUpdateMeeting`, whose branches are admin, A1 or
//      **M1** for the board. Any other code here would mean an operator who
//      may move the meeting to an item may not record that they did, which is
//      an authorization boundary running through the middle of one action.
//   2. A2 (`edit_agenda`) is the alternative and it is wrong for the same
//      reason it was wrong for `status`/`operator_notes` (rule 2a): this row
//      is not agenda content, it is what happened to the agenda in the room.
//
// A rule of its own — a new `PermissionCode` for "write the meeting clock" —
// was considered and rejected: it would be a code no template grants, no
// screen exposes and no town would ever configure, which in a system where
// unset means false is a rule that refuses everyone.
//
// There is no DELETE rule because nothing deletes a transition; the history is
// what the minutes assembler reads.

export function assertCanInsertAgendaItemTransition(actor: Actor, scope: BoardScope): void {
  assertPermission(actor, "M1", {
    boardId: scope.boardId,
    action: "to move this meeting to an agenda item",
  });
}

export function assertCanUpdateAgendaItemTransition(actor: Actor, scope: BoardScope): void {
  assertPermission(actor, "M1", {
    boardId: scope.boardId,
    action: "to close out the current agenda item",
  });
}

// ─── 21e — future_item_queue INSERT: M1, on its OWN board column ──────
//
// The other bookkeeping table, and the same answer for a different balance of
// reasons. Every row in it is written by ADJOURNING: `handleMeetingEnd` defers
// each item the meeting never reached and queues each item a passed `table`
// motion tabled. Nothing else in the product writes one — no screen offers
// "add to the future queue," and `routes/meetings.$meetingId.review.tsx` only
// READS the queue for a meeting.
//
// **M1, not A2**, and here the choice is load-bearing rather than tidy.
// Adjournment is a single act that writes four tables at once (rule 2a's
// comment lists them); the other three are M1. Had this one taken A2 on the
// grounds that a queued item is future agenda content, an operator holding M1
// and not A2 would get a meeting adjourned with its deferred items silently
// unqueued — the failure mode is not a refusal the user can see, it is a lost
// item. A2 governs the moment a queued item is PLACED on an agenda
// (`placed_agenda_item_id`), which is a write no screen performs today; when
// one does, that is an `agenda_item` INSERT and rule 1 already governs it.
//
// **The board is a COLUMN here, not a join** — `future_item_queue.board_id` is
// `uuid NOT NULL` (`0000_baseline.sql:1248`) while `source_meeting_id` is
// nullable (`:1250`), so this is the one table of the nine wave 5 writes whose
// board must NOT be derived through `meeting`: a deferred item that outlives
// its source meeting would derive NULL. The rule itself is the same shape as
// every other `BoardScope` rule — what differs is where the caller gets the
// board, which is the resolver's business and is stated in wave 5's plan and
// in conventions item 2.

export function assertCanInsertFutureItem(actor: Actor, scope: BoardScope): void {
  assertPermission(actor, "M1", {
    boardId: scope.boardId,
    action: "to queue an item for a future meeting",
  });
}

// ═══════════════════════════════════════════════════════════════════════
// Phase B report §4b — the admin gates
//
// Not action codes, which is precisely why they were the ones most likely to
// be dropped without anyone noticing. Every one of these was
// `AND is_admin()` in a policy.
// ═══════════════════════════════════════════════════════════════════════

export function assertCanUpdateTown(actor: Actor): void {
  assertAdmin(actor, "change the town's profile and settings");
}

export function assertCanInsertPerson(actor: Actor): void {
  assertAdmin(actor, "add a person to the town directory");
}

export function assertCanUpdatePerson(actor: Actor): void {
  assertAdmin(actor, "change a person's record");
}

export function assertCanInsertUserAccount(actor: Actor): void {
  assertAdmin(actor, "create a login account");
}

/**
 * Columns on `user_account` that only an administrator may write.
 *
 * `role` and `permissions` are the escalation pair: a self-update that can
 * write either is self-promotion to administrator. `town_id` and `person_id`
 * re-point the account at a different tenant or a different human.
 * `archived_at` is how an account is deactivated. `gov_title` is a governance
 * field the People screens own; there is no self-service profile editor today,
 * so denying it costs nothing and is the safe reading.
 */
export const ADMIN_ONLY_USER_ACCOUNT_COLUMNS: readonly string[] = [
  "role",
  "permissions",
  "town_id",
  "person_id",
  "archived_at",
  "gov_title",
];

/**
 * Admin, OR the account's own holder — but the self branch authorizes the ROW,
 * not the COLUMNS, so it must be told which columns are being written.
 *
 * ─── Why `columns` is required and not optional ───────────────────────────
 *
 * The policy this restores, `user_account_update_own`, was
 * `FOR UPDATE USING (person_id = auth.uid())` — row-level, with no column
 * list, and that was safe in Postgres only because nothing exposed a
 * column-level write API on top of it: an UPDATE still had to get past
 * whatever the application chose to send. Lift the same predicate into
 * TypeScript, put a mutation behind it in Phase E, and "you may update your
 * own row" becomes "you may write `role: 'admin'` onto your own row".
 * TypeScript has no column privileges, so the guard has to carry them.
 *
 * Required rather than optional for the same reason `BoardScope` is: an
 * optional column list defaults to *something*, and whichever default is
 * chosen is wrong half the time. Omitting it is a type error instead.
 *
 * Its predicate was also latently wrong — `person_id = auth.uid()` compared a
 * PERSON id to an IDENTITY id, and only ever matched because onboarding reused
 * one uuid for the person, the account and the auth user. Restored against the
 * account id, which is what "your own row" actually means.
 */
export function assertCanUpdateUserAccount(
  actor: Actor,
  subject: { userAccountId: string; columns: readonly string[] },
): void {
  if (isAdmin(actor)) return;

  const isOwnRow = actor.userAccountId !== null && subject.userAccountId === actor.userAccountId;
  if (!isOwnRow) {
    throw new AuthorizationError(
      "Only a town administrator can change another account. You may change your own.",
    );
  }

  const restricted = subject.columns.filter((c) => ADMIN_ONLY_USER_ACCOUNT_COLUMNS.includes(c));
  if (restricted.length > 0) {
    throw new AuthorizationError(
      `You may change your own account, but not ${restricted.join(", ")}. ` +
        "Only a town administrator can change an account's role, permissions or " +
        "town — otherwise any account could promote itself.",
    );
  }
}

export function assertCanInsertBoard(actor: Actor): void {
  assertAdmin(actor, "create a board");
}

export function assertCanUpdateBoard(actor: Actor): void {
  assertAdmin(actor, "change a board's configuration");
}

export function assertCanInsertBoardMember(actor: Actor): void {
  assertAdmin(actor, "seat a member on a board");
}

export function assertCanUpdateBoardMember(actor: Actor): void {
  assertAdmin(actor, "change a board seat");
}

/**
 * Archiving a board writes TWO tables — `board.archived_at` and every active
 * `board_member` row on it — so it needs both rules to hold, not one.
 *
 * Both are `assertAdmin` today, so this composite answers identically to
 * either half. That is exactly why it is written out rather than left as a
 * single `requireActor(assertCanUpdateBoard)`: a guard naming only one of the
 * two tables it writes is correct by coincidence, and the day either rule
 * stops being a bare admin gate (the `BOARD_SCOPED_CODES` direction this file
 * already anticipates elsewhere) the coincidence ends silently. Phase E wave
 * 6, Task 5 — `board.archive`, which replaced `ArchiveBoardDialog.tsx`'s two
 * untransacted, unguarded raw writes.
 */
export function assertCanArchiveBoard(actor: Actor): void {
  assertCanUpdateBoard(actor);
  assertCanUpdateBoardMember(actor);
}

export function assertCanInsertAgendaTemplate(actor: Actor): void {
  assertAdmin(actor, "create an agenda template");
}

export function assertCanUpdateAgendaTemplate(actor: Actor): void {
  assertAdmin(actor, "change an agenda template");
}

export function assertCanDeleteAgendaTemplate(actor: Actor): void {
  assertAdmin(actor, "delete an agenda template");
}

/**
 * The removed policies also carried `AND is_system_default = false`.
 *
 * That half is NOT restored here, and is not lost either: Phase B's report
 * §4b records that system defaults have `town_id IS NULL`, which no tenant's
 * `town_id = get_current_town_id()` predicate can match. The database makes
 * them unwritable by construction, so a TypeScript copy of the rule would be a
 * second statement of the same fact with its own chance to be wrong.
 */
export function assertCanInsertPermissionTemplate(actor: Actor): void {
  assertAdmin(actor, "create a permission template");
}

export function assertCanUpdatePermissionTemplate(actor: Actor): void {
  assertAdmin(actor, "change a permission template");
}

export function assertCanDeletePermissionTemplate(actor: Actor): void {
  assertAdmin(actor, "delete a permission template");
}

/**
 * THE most sensitive read on this list.
 *
 * `town_notification_config` holds the town's SMTP credentials and API keys.
 * Under Phase B's tenancy-only RLS every session with a tenant context can
 * read them, including a general-staff account with no permissions at all.
 * C2 does not open this: managing which notifications go out is not the same
 * authority as reading the mail server password.
 */
export function assertCanSelectTownNotificationConfig(actor: Actor): void {
  assertAdmin(actor, "read the town's notification configuration (it contains credentials)");
}

export function assertCanInsertTownNotificationConfig(actor: Actor): void {
  assertAdmin(actor, "set up the town's notification configuration");
}

export function assertCanUpdateTownNotificationConfig(actor: Actor): void {
  assertAdmin(actor, "change the town's notification configuration");
}

export function assertCanInsertNotificationEvent(actor: Actor): void {
  assertAdmin(actor, "create a notification event by hand");
}

export function assertCanInsertNotificationDelivery(actor: Actor): void {
  assertAdmin(actor, "create a notification delivery record by hand");
}

export function assertCanSelectAuditLog(actor: Actor): void {
  assertAdmin(actor, "read the audit log");
}

/**
 * The audit log's INSERT was town-wide, not admin — restored as it was.
 *
 * The app appends "viewed agenda" and "downloaded PDF" entries for ordinary
 * users. Gating the write behind admin would empty the log rather than protect
 * it, and an empty audit log is worse than an open one. There is no UPDATE or
 * DELETE rule because the corpus had no such policy: the log is append-only.
 */
export function assertCanInsertAuditLog(actor: Actor): void {
  if (actor.kind === "user") return;
  throw new AuthorizationError("Signing in is required to append to the audit log.");
}

// ═══════════════════════════════════════════════════════════════════════
// Phase B report §4b — the self-scoping rules
// ═══════════════════════════════════════════════════════════════════════

/** Your own preferences, or an administrator setting them up for you. */
export function assertCanInsertSubscriberPreference(
  actor: Actor,
  subject: { personId: string },
): void {
  if (isAdmin(actor)) return;
  if (actor.personId !== null && subject.personId === actor.personId) return;
  throw new AuthorizationError(
    "Only a town administrator can set another person's notification preferences.",
  );
}

export function assertCanUpdateSubscriberPreference(
  actor: Actor,
  subject: { personId: string },
): void {
  if (isAdmin(actor)) return;
  if (actor.personId !== null && subject.personId === actor.personId) return;
  throw new AuthorizationError(
    "Only a town administrator can change another person's notification preferences.",
  );
}

// ═══════════════════════════════════════════════════════════════════════
// The public portal
//
// The portal has no account, so every rule above refuses it. What it may read
// is stated here, positively and in one place, rather than as an `.eq()` in
// fifteen separate handlers where the next handler is one forgotten filter
// away from publishing a draft.
// ═══════════════════════════════════════════════════════════════════════

/**
 * The portal may read minutes that are PUBLISHED. Not `approved`.
 *
 * Narrower than rule 9's second branch on purpose. `approved` means the board
 * has adopted them; `published` means the town has decided to put them on the
 * website. Those are different decisions and the portal must honour the
 * second, not infer it from the first.
 */
export function portalCanSelectMinutesDocument(row: { status: MinutesStatus }): boolean {
  return row.status === "published";
}

export function assertPortalCanSelectMinutesDocument(row: { status: MinutesStatus }): void {
  if (portalCanSelectMinutesDocument(row)) return;
  throw new AuthorizationError(
    `These minutes are ${row.status} and have not been published. The public portal ` +
      "serves published records only.",
  );
}

export function portalVisibleMinutesDocuments<T extends { status: MinutesStatus }>(
  rows: readonly T[],
): T[] {
  return rows.filter(portalCanSelectMinutesDocument);
}

/** The portal may read `public` exhibits, and only those. */
export function portalCanSelectExhibit(row: { visibility: ExhibitVisibility }): boolean {
  return row.visibility === "public";
}

export function portalVisibleExhibits<T extends { visibility: ExhibitVisibility }>(
  rows: readonly T[],
): T[] {
  return rows.filter(portalCanSelectExhibit);
}

/** Meetings the portal may list: anything a town has not left in draft or cancelled. */
export const PORTAL_HIDDEN_MEETING_STATUSES: readonly string[] = ["draft", "cancelled"];

export function portalCanSelectMeeting(row: { status: string }): boolean {
  return !PORTAL_HIDDEN_MEETING_STATUSES.includes(row.status);
}

/**
 * Agendas the portal may read: published, ON a meeting the portal may list.
 *
 * BOTH conditions, and the second one is a fix rather than a transcription.
 * `routes/portal.ts:282` gates the agenda route on `agenda_status` alone and
 * does not apply the draft/cancelled meeting exclusion its sibling routes
 * apply, so a cancelled meeting whose agenda was published before cancellation
 * is still served. That is precisely the "whichever copy its author happened
 * to read" divergence this lift exists to eliminate; encoding both here means
 * D1b cannot reproduce it by migrating the route faithfully.
 */
export function portalCanSelectAgenda(row: {
  agendaStatus: string | null;
  meetingStatus: string;
}): boolean {
  if (!portalCanSelectMeeting({ status: row.meetingStatus })) return false;
  return row.agendaStatus === "published";
}

/**
 * Boards the portal may list: not archived (`routes/portal.ts:497`, `:521`).
 *
 * Lifted for the same reason as the rest: it is a publication decision
 * expressed as an `.is("archived_at", null)` in two handlers, and a third
 * handler is one omission away from listing a town's disbanded committees.
 */
export function portalCanSelectBoard(row: { archivedAt: string | Date | null }): boolean {
  return row.archivedAt === null || row.archivedAt === undefined;
}

/**
 * Board members the portal may name: active seats only
 * (`routes/portal.ts:534`).
 *
 * This is the one piece of personal data on the portal surface — name, seat
 * title and term dates — and Phase C's G1 review flagged it for the owner. An
 * expired seat is not public record of who currently serves, so a former
 * member must drop off the page when their term ends rather than when someone
 * remembers to filter.
 */
export function portalCanSelectBoardMember(row: { status: string }): boolean {
  return row.status === "active";
}

/**
 * The town's own identity row — the one exception to the constraint in
 * `auth/portal-tenant.ts`, made explicit here rather than left unstated.
 *
 * `GET /api/portal/resolve` returns a `town` row and there is no
 * `portalCanSelectTown` gating it, because there is no publication decision to
 * gate on. A town reachable through the portal tenant path is a town that
 * published a portal at a subdomain; the row IS the portal. A predicate here
 * would be `true` written at length, and a rule that cannot say no is worse
 * than no rule — it makes the invariant read as upheld while adding nothing.
 *
 * What CAN go wrong on that route is a column, not a row: `town` also holds
 * `contact_email`, onboarding state, and whatever a future migration adds, and
 * a `SELECT t.*` written in a hurry would publish all of it to anonymous
 * residents. So the gate here is a projection, not a filter. This list is what
 * the portal may know about a town; `routes/__tests__/portal-tenancy.test.ts`
 * asserts `/resolve`'s response keys are exactly these, so widening the route
 * without widening this list fails, and widening this list is a decision made
 * next to the other portal rules where it can be seen.
 */
export const PORTAL_TOWN_IDENTITY_COLUMNS = [
  "id",
  "name",
  "state",
  "municipality_type",
  "seal_url",
  "contact_name",
  "contact_role",
  "subdomain",
] as const;
