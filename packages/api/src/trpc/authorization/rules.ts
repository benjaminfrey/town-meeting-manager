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
 *    SIXTEEN of the guards are board-scoped, not the two that were obviously
 *    so. Every code the two `designated_boards` permission templates grant —
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

export function assertCanInsertAgendaItem(actor: Actor, scope: BoardScope): void {
  assertPermission(actor, "A2", { boardId: scope.boardId, action: "to add an agenda item" });
}

export function assertCanUpdateAgendaItem(actor: Actor, scope: BoardScope): void {
  assertPermission(actor, "A2", { boardId: scope.boardId, action: "to edit an agenda item" });
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
// These three keep a global check while the sixteen above became
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
