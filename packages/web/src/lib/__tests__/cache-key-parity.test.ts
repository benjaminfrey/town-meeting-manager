/**
 * Conventions item 7: "The commit that moves a read to tRPC also updates
 * every writer that was invalidating the key it abandoned, in that same
 * commit." Violated three times in Phase E wave 1 — Tasks 2, 3 and 5 — each
 * time blocking review, each time by an implementer who already knew the
 * rule. That is not a discipline problem; it is a problem a human reviewer
 * has to hold a full grep in their head to catch, every single time. This
 * test holds it instead.
 *
 * ─── What it checks ────────────────────────────────────────────────────
 *
 * For every `invalidateQueries(` call in a non-test file under `src/`: if
 * the call's own argument names a `queryKeys.<namespace>` where `<namespace>`
 * is a MIGRATED entity (one with a real tRPC router and a `pathFilter()`),
 * the same FILE must also call `trpc.<router>.pathFilter()` somewhere —
 * otherwise a reader that moved onto the tRPC key is not being invalidated
 * by this writer at all, silently, for up to the query's `staleTime`.
 *
 * `MIGRATED` is hand-maintained on purpose — quote the object below rather
 * than any count in this comment, which is exactly the figure that drifts.
 * `members: "boardMember"`, `userAccounts: "person"` and
 * `invitations: "boardMember"` joined `agendaTemplates: "agendaTemplate"` in
 * wave 2's final whole-branch-review fix round, all four verified to raise
 * zero violations at HEAD before being added; `meetings: "meeting"` joined in
 * wave 3 Task 2's own fix round; `agendaItems: "agendaItem"`,
 * `minutesDocuments: "minutesDocument"` and `attendance: "meetingAttendance"`
 * joined in wave 3 Tasks 3+4's fix round (see the paragraph after `meetings`
 * below); `minutes: "minutesDocument"` joined in the whole-branch fix round
 * after that; `motions`, `voteRecords`, `guestSpeakers`, `executiveSessions`
 * and `agendaItemTransitions` joined in wave 5, Task 4, when
 * `routes/meetings.$meetingId.live.tsx` moved all nine of its reads onto tRPC
 * and the five routers behind them acquired their first web readers. Growing
 * it is exactly the moment this rule should fire for a newly-migrated entity,
 * so it stays a deliberate edit, not a derived one.
 *
 * **`minutes` and `minutesDocuments` are TWO namespaces over ONE table**
 * (`queryKeys.minutes.byMeeting` and `queryKeys.minutesDocuments.byMeeting`
 * both key a meeting's `minutes_document` row, and neither invalidates the
 * other — a pre-existing split this map does not try to fix). Mapping both
 * to `minutesDocument` is why the entry above is not redundant: it is the
 * reason this check MISSED `routes/meetings.$meetingId.minutes.tsx`, which
 * writes `minutes_document.status` at six sites through one
 * `invalidateMinutes()` helper and used the `minutes` namespace to do it. The
 * shell (`routes/meetings.$meetingId.tsx`) renders its status pill from
 * `trpc.minutesDocument.byMeeting`, so publishing minutes and navigating back
 * held a stale pill for the full 60s `staleTime` — the identical regression
 * the previous fix round closed for eight other files, surviving one commit
 * longer purely on a namespace spelling. Adding the entry raised exactly ONE
 * violation (that file's own `invalidateMinutes`), fixed in the same commit;
 * `home.tsx`'s `queryKeys.minutes.byMeeting("__home_pending__")` is a
 * `useQuery` key, not an `invalidateQueries` call, so this check does not
 * reach it.
 * Update it in the same commit a router's read moves off `queryKeys.<x>` and
 * its `pathFilter()` becomes the thing writers owe (conventions item 7).
 *
 * `meetings` is the map's first entry added when only PART of a namespace's
 * reads had migrated — `meeting.byTown`/`meeting.byBoard` moved in wave 3
 * Task 2, but `meeting.detail`'s own screens (wave 4's agenda tab, wave 5's
 * live-meeting flow) had not, and still read the raw `meeting` row. Because
 * this check is namespace-, not procedure-, granular, adding the entry
 * flagged every `invalidateQueries(queryKeys.meetings.*)` writer in the tree,
 * not only the two reads that actually moved — four files outside that
 * task's own file list (`MeetingStartFlow.tsx`, `PublishAgendaDialog.tsx`,
 * `routes/meetings.$meetingId.agenda.tsx`, `routes/meetings.$meetingId.live.tsx`).
 * Fixed on the merits, not merely to satisfy this check: each write changes a
 * `meeting` column the kanban or board Meetings tab renders (`status` for the
 * first two, `agenda_status`/derived document URLs for the other two), so
 * each was missing a real invalidation of its own — the kanban silently held
 * a stale card for up to 60s after a meeting was called to order or
 * adjourned. Each fix is one `trpc.meeting.pathFilter()` line at an existing
 * `invalidateQueries` call site; see wave 3 Task 2's fix-round report for the
 * per-file detail and the two of the four that also carry a new
 * `TODO(phase-e-wave-4/5)` authorization-hole marker (their `meeting` writes
 * were already unauthorized before this fix round and still are — only the
 * missing invalidation was in scope to close).
 *
 * `agendaItems`/`minutesDocuments`/`attendance` are the same shape, one wave
 * later and one round later than they should have been. Wave 3 Task 3 built
 * the three one-procedure routers behind `routes/meetings.$meetingId.tsx`'s
 * shell (`agendaItem.countByMeeting`, `minutesDocument.byMeeting`,
 * `meetingAttendance.countByMeeting`) and DEFERRED the map entries, on the
 * reasoning that the writers live in wave-4/5/6 files. Wrong for the same
 * reason `agendaTemplates` was wrong below, and a reviewer demonstrated the
 * regression by execution rather than argument: at `1b1d635` the shell read
 * `queryKeys.agendaItems.byMeeting(meetingId)` and every writer invalidated
 * that exact expression, so `Query.isStaleByTime()`'s `state.isInvalidated`
 * short-circuit forced a refetch on return to the shell; after Task 3 the
 * shell's key was `[["agendaItem","countByMeeting"],…]`, nothing invalidated
 * it, and adding two agenda items then navigating back to the meeting still
 * read "3 items" for up to 60s. Same for the minutes status pill and the
 * attendance count. Adding the three entries raised 11 (namespace, file)
 * pairs across 8 files — 6 `agendaItems`, 2 `minutesDocuments`, 3
 * `attendance` — every one of them a real writer of the table its router
 * owns, each fixed on its own merits with a `pathFilter()` call and a pin
 * test, each pin verified by deleting the line and watching it go red. The
 * legacy `queryKeys.*` lines all STAY, though no longer for the reason this
 * paragraph gave: `SourceDataPanel.tsx` left the reader list in wave 6 Task 3,
 * `review.tsx` in Task 4, `live.tsx` in wave 5, and `useQuorumCheck.ts` reads
 * no `queryKeys.*` at all any more (`grep -n "queryKeys" hooks/useQuorumCheck.ts`
 * is empty). `agendaItems.byMeeting`, `attendance.byMeeting` and
 * `minutesDocuments.byMeeting` therefore have **no reader left**. The lines
 * stay anyway, and deliberately: this check keys off them, so removing the
 * last legacy invalidation from a file also removes the tripwire that would
 * catch the NEXT writer added to it. See "Why a dead legacy line is not
 * removed on sight" below.
 *
 * `exhibits: "exhibit"` joined in Phase E wave 4, Task 3, the commit that
 * moved `routes/meetings.$meetingId.agenda.tsx`'s exhibit read onto
 * `trpc.exhibit.byMeeting`. That task's own brief records this call being
 * made and overturned four times before — always on the reasoning that the
 * writers live in files the task does not own — and the entry is added on the
 * same merits as `agendaItems`/`agendaTemplates` above: a task's file list has
 * never exempted a writer from item 7. It raised exactly THREE violations, all
 * three real and all three fixed in the same commit:
 * `ExhibitUploader.tsx` (two call sites: the D1e file upload and the newly
 * wired `exhibit.link`), `ExhibitRow.tsx` (the D1e delete, which stays at that
 * endpoint and still owes the key its removal invalidates) and
 * `InlineItemForm.tsx` (whose `agendaItem.delete` cascades to the item's
 * exhibits). `AgendaSection.tsx` gained the call in the same commit for its
 * own cascading section delete, which had no `queryKeys.exhibits` line at all
 * to be flagged by. ~~The legacy `queryKeys.exhibits.*` lines all STAY:
 * `routes/meetings.$meetingId.review.tsx` still reads that namespace.~~ —
 * that reader is gone as of wave 6, Task 4; the lines stay for the reason
 * below instead.
 *
 * `futureItemQueues: "futureItem"` joined in Phase E wave 6, Task 4, when
 * `routes/meetings.$meetingId.review.tsx`'s deferred-items list moved onto
 * `trpc.futureItem.byMeeting` (the router itself is Task 2's). It raised
 * **zero** violations, because no client code invalidates
 * `queryKeys.futureItemQueues` at all — every `future_item_queue` row is
 * written server-side inside `meeting.performAdjournment`. That is exactly
 * why the entry is worth having and exactly why it caught nothing: the real
 * gap was the mirror image of what this check looks for — two adjournment
 * call sites (`routes/meetings.$meetingId.live.tsx`'s `adjournMutation` and
 * `VotePanel.tsx`'s `data.adjourned` branch) that invalidated three routers
 * each and owed a fourth, with no legacy key present to be flagged by. Both
 * carry `trpc.futureItem.pathFilter()` now, each pinned and each verified by
 * deletion. **A check that fires on an abandoned legacy key cannot see a
 * writer that never had one.**
 *
 * ─── Why a dead legacy line is not removed on sight ──────────────────────
 *
 * Wave 6, Task 4 left `routes/meetings.$meetingId.review.tsx` as the last
 * reader of THIRTEEN legacy keys and migrated all of them at once. Item 7's
 * "the legacy line goes when the last legacy reader does" would then delete
 * roughly eighty lines across twenty-odd writer files — and with them every
 * `queryKeys.<migrated>` reference this check matches on, for twelve
 * namespaces simultaneously. The check would go quiet for `agendaItem`,
 * `motion`, `voteRecord`, `executiveSession`, `agendaItemTransition`,
 * `guestSpeaker`, `exhibit`, `meetingAttendance`, `boardMember`, `town`,
 * `meeting` and `minutesDocument` in the same commit that wave 6's remaining
 * tasks start adding writers to several of those files. The lines are
 * therefore kept, and the asymmetry is the reason: a dead invalidation costs
 * one no-op cache scan, a missing `pathFilter()` costs a silently stale
 * screen. Whoever removes them should remove the matching `MIGRATED` entry in
 * the same commit, because an entry with nothing left to match is a check
 * that reports zero violations for the wrong reason.
 *
 * The `agendaTemplates` entry is the rule's own cautionary tale: the first
 * version of wave 2 Task 2 left it out, reasoning that two of its three
 * writers (`CreateTemplateDialog.tsx`, `DeleteTemplateDialog.tsx`) were
 * outside that task's file list and adding the namespace would fail the
 * check against files the task hadn't touched. That is exactly backwards —
 * conventions item 7 is explicit that file-list scope does not exempt a
 * writer from this rule, and "the writer is outside the migrating file" is
 * the ORDINARY shape of the bug this check exists to catch, not a reason to
 * suppress it. A reviewer found the resulting regression directly: deleting
 * a template through `DeleteTemplateDialog` left it on screen for the full
 * 60s `staleTime`, because the dialog invalidated `queryKeys.agendaTemplates`
 * while `boards.$boardId.templates.tsx` had already moved its read onto
 * `trpc.agendaTemplate.list`. Fixed in the same round by adding the
 * `pathFilter()` call to all three writers of the legacy key
 * (`CreateTemplateDialog.tsx`, `DeleteTemplateDialog.tsx`, and
 * `boards.$boardId.templates.$templateId.edit.tsx` — a third writer the
 * first version of the task named as a read-only legacy consumer and was
 * not), each with its own pin test.
 *
 * ─── Why the match is forward-only from the marker, not whole-file ────────
 *
 * (Corrected here to match `phase-e-conventions.md`'s own correction —
 * `a97617f` retitled item 7's identical section from "scoped to a window" to
 * "forward-only": what actually does the work is that nothing BEHIND the
 * `invalidateQueries(` marker is ever read, not that the window is narrow.
 * See that item's own paragraph for the widened-window measurements.)
 *
 * A whole-file check — "does this file contain `queryKeys.towns.` ANYWHERE,
 * and does it contain `invalidateQueries(` ANYWHERE, and does it lack
 * `trpc.town.pathFilter()`" — sounds equivalent and is not: a file can read
 * `queryKeys.userAccounts.byTown(...)` in a `useQuery` fifty lines above an
 * `invalidateQueries(...)` call that invalidates something unrelated
 * entirely (an invitation key, a member key). Measured at HEAD
 * (`2d78964`): a whole-file version of this check raises **12** false
 * positives — `MemberTransitionDialog.tsx`, `CreateMeetingDialog.tsx`,
 * `boards.$boardId.templates.tsx` and nine more — every one of them a file
 * that reads a migrated namespace's key somewhere and separately
 * invalidates something else. Scoping the match to `WINDOW` characters
 * measured from immediately after the literal `invalidateQueries(` token —
 * i.e., inside that call's own argument, not the file around it — brings
 * that to **zero** at HEAD, verified by running both versions against the
 * same tree (`node` scripts kept out of the repo; the numbers were
 * reproduced by hand against `git archive` snapshots, not assumed).
 *
 * `describe("the check itself")` below pins this distinction directly: a
 * `queryKeys.towns.` reference far outside an `invalidateQueries(` call must
 * NOT trip the check, and one inside it must.
 *
 * ─── Validated against history ─────────────────────────────────────────
 *
 * Run with `git archive <sha> -- packages/web/src` against six real commits
 * from this wave, this check (in this exact shape) reproduces two of the
 * three blocking findings a reviewer found by hand, by file, at the commit
 * each shipped:
 *
 *   - `841f4db`: `TownSealUpload.tsx` and `settings.minutes-workflow.tsx`
 *     invalidate `queryKeys.towns.detail(...)` with no `trpc.town.pathFilter()`
 *     anywhere in either file. Caught.
 *   - `7a17fa6`: `AddBoardDialog.tsx` invalidates `queryKeys.boards.byTown(...)`
 *     alone, no `trpc.board.pathFilter()`. Caught (the only violation this
 *     check raises at that commit).
 *
 * It does NOT reproduce the third named finding — "the four person writers
 * at `3b22df8`" — and that is not a gap in the window scoping: by `3b22df8`,
 * `AddMemberDialog.tsx`/`AddPersonDialog.tsx`/`EditPersonDialog.tsx`/
 * `MemberArchiveDialog.tsx`/`MemberTransitionDialog.tsx` already called
 * `trpc.person.pathFilter()` (confirmed by reading that commit's tree
 * directly). What actually shipped broken at `3b22df8` and was fixed at
 * `4f8b3fc` ("Pin the four person.pathFilter() writers") was the WRITER
 * TEST pinning each of those calls — conventions item 8's "pin the writers,
 * not just the readers" — not a missing invalidation call. That is the
 * "second half" this task was explicitly told not to ship yet ("the
 * reviewer's first pass had three false positives and it needs tuning") —
 * see the Known-gaps entry in `phase-e-conventions.md`. This check's own
 * scope is item 7 (the call exists) — not item 8 (the call is pinned by a
 * test) — and the two are genuinely different failure modes: one ships a
 * silent stale-cache bug, the other ships an unverified fix that the next
 * refactor can delete without any test noticing.
 *
 * Re-run at HEAD: **zero** violations, real (not filtered away) — every
 * current writer of a migrated key also calls the matching `pathFilter()`.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const PROJECT_ROOT = path.resolve(__dirname, "../../../../..");
const SRC_DIR = path.join(PROJECT_ROOT, "packages/web/src");

/**
 * Entity namespaces (per `lib/queryKeys.ts`) that have since gained a real
 * tRPC router with a `pathFilter()`. Hand-maintained, deliberately — see
 * this file's header.
 */
const MIGRATED: Record<string, string> = {
  towns: "town",
  boards: "board",
  persons: "person",
  agendaTemplates: "agendaTemplate",
  members: "boardMember",
  userAccounts: "person",
  invitations: "boardMember",
  meetings: "meeting",
  agendaItems: "agendaItem",
  minutesDocuments: "minutesDocument",
  minutes: "minutesDocument",
  attendance: "meetingAttendance",
  exhibits: "exhibit",
  motions: "motion",
  voteRecords: "voteRecord",
  guestSpeakers: "guestSpeaker",
  executiveSessions: "executiveSession",
  agendaItemTransitions: "agendaItemTransition",
  futureItemQueues: "futureItem",
};

/**
 * How far past the literal `invalidateQueries(` token to look for a
 * `queryKeys.<namespace>` reference before deciding it belongs to THIS
 * call, not some other code nearby. Not exact bracket-matching — a fixed
 * window scoped to "inside the call" is what was measured against real
 * violations and real false positives (see header); it does not need to be
 * more precise than that to hit zero false positives at HEAD.
 */
const WINDOW = 250;

interface Violation {
  file: string;
  namespace: string;
  router: string;
}

/** The check both the real scan and the synthetic pin below run. */
function findViolations(srcDir: string): Violation[] {
  const violations: Violation[] = [];

  function walk(dir: string): string[] {
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "__tests__" || entry.name === "node_modules") continue;
        out.push(...walk(full));
      } else if (
        entry.isFile() &&
        /\.(ts|tsx)$/.test(entry.name) &&
        !entry.name.includes(".test.")
      ) {
        out.push(full);
      }
    }
    return out;
  }

  const seen = new Set<string>();
  for (const file of walk(srcDir)) {
    const content = fs.readFileSync(file, "utf8");
    const rel = path.relative(srcDir, file);
    const marker = "invalidateQueries(";
    let from = 0;
    let idx: number;
    while ((idx = content.indexOf(marker, from)) !== -1) {
      const windowStart = idx + marker.length;
      const callWindow = content.slice(windowStart, windowStart + WINDOW);
      for (const [namespace, router] of Object.entries(MIGRATED)) {
        const key = `${rel}::${namespace}`;
        if (seen.has(key)) continue;
        if (new RegExp(`queryKeys\\.${namespace}\\.`).test(callWindow)) {
          if (!new RegExp(`trpc\\.${router}\\.pathFilter\\(\\)`).test(content)) {
            violations.push({ file: rel, namespace, router });
            seen.add(key);
          }
        }
      }
      from = idx + 1;
    }
  }
  return violations;
}

describe("cache key parity: every abandoned queryKeys write gets a pathFilter() invalidation", () => {
  it("has zero violations across packages/web/src", () => {
    const violations = findViolations(SRC_DIR);
    const message = violations
      .map(
        (v) =>
          `${v.file}: invalidates queryKeys.${v.namespace} but never calls trpc.${v.router}.pathFilter() — ` +
          `the reader for that key has moved to tRPC and this writer no longer reaches it.`,
      )
      .join("\n");
    expect(violations, message).toEqual([]);
  });
});

describe("the check itself", () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "cache-key-parity-"));
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  function writeFixture(relPath: string, content: string): string {
    const full = path.join(tmpRoot, relPath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
    return full;
  }

  it("catches a writer that invalidates a migrated key with no matching pathFilter()", () => {
    writeFixture(
      "Broken.tsx",
      `
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.towns.detail(townId) });
      },
      `,
    );
    const violations = findViolations(tmpRoot);
    expect(violations).toEqual([{ file: "Broken.tsx", namespace: "towns", router: "town" }]);
  });

  it("passes a writer that pairs the legacy key with pathFilter() in the same file", () => {
    writeFixture(
      "Fixed.tsx",
      `
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.towns.detail(townId) });
        void queryClient.invalidateQueries(trpc.town.pathFilter());
      },
      `,
    );
    expect(findViolations(tmpRoot)).toEqual([]);
  });

  it("does NOT flag a queryKeys reference outside the invalidateQueries() call's own window — the false positive a whole-file grep produces", () => {
    // A read of a migrated namespace's key (a useQuery, say), far away from
    // an invalidateQueries() call that invalidates something unrelated.
    // A whole-file "contains queryKeys.towns. AND contains invalidateQueries("
    // check would wrongly flag this file. This check must not.
    const padding = "// padding line to push the two references apart\n".repeat(20);
    writeFixture(
      "Unrelated.tsx",
      `
      useQuery(queryKeys.towns.detail(townId));
      ${padding}
      onSuccess: () => {
        // Deliberately a namespace NOT in MIGRATED — this fixture needs a
        // key this check has no opinion about, not one it would now flag
        // for real. It has now been rewritten THREE times for that reason,
        // which is the pattern worth naming: \`meetings\` joined the map in
        // wave 3 Task 2's fix round, \`motions\` (its replacement) joined in
        // wave 5 Task 4, and \`futureItemQueues\` (the replacement for THAT)
        // joined in wave 6 Task 4 — each time, the fixture's own "genuinely
        // unmigrated" example became migrated and the fixture started failing
        // as a real violation. The previous comment here said "when it gets
        // one, pick another — and expect to," and that is exactly what
        // happened one wave later. \`pushSubscriptions\` is the current
        // choice: \`push_subscription\` has no router in
        // \`packages/api/src/trpc/router.ts\` at all, and nothing in Phase E
        // proposes one. When it gets one, pick another — and expect to.
        void queryClient.invalidateQueries({
          queryKey: queryKeys.pushSubscriptions.byUser(userId),
        });
      },
      `,
    );
    expect(findViolations(tmpRoot)).toEqual([]);
  });

  it("ignores __tests__ directories and .test. files", () => {
    writeFixture(
      "__tests__/Broken.test.tsx",
      `void queryClient.invalidateQueries({ queryKey: queryKeys.towns.detail(townId) });`,
    );
    writeFixture(
      "Broken.test.tsx",
      `void queryClient.invalidateQueries({ queryKey: queryKeys.towns.detail(townId) });`,
    );
    expect(findViolations(tmpRoot)).toEqual([]);
  });
});
