import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { appRouter } from "../router.js";
import { LIVE_MEETING_TOPICS } from "../../realtime/events.js";

describe("router wiring", () => {
  it("exposes exactly the procedures the web package calls, by name", () => {
    // Adding a procedure is fine; RENAMING or REMOVING one that a screen calls
    // is what this catches, at the moment it happens rather than at runtime in
    // a browser with an empty page and no error.
    const procedures = Object.keys(appRouter._def.procedures).sort();
    expect(procedures).toEqual(
      expect.arrayContaining([
        "board.detail",
        "board.recentMeetings",
        "board.stats",
        "board.list",
        "board.listActive",
        "board.insert",
        "board.update",
        "board.copyNoticeTemplate",
        "boardMember.memberCount",
        "boardMember.listByTown",
        "boardMember.activeCountForBoard",
        "boardMember.roster",
        "boardMember.searchCandidates",
        "boardMember.personEmailExists",
        "boardMember.addBoardMember",
        "boardMember.addStaffMember",
        "boardMember.otherActiveCount",
        "boardMember.archiveMembership",
        "boardMember.addToBoard",
        "boardMember.convertToStaff",
        "agendaTemplate.list",
        "agendaTemplate.listByTown",
        "agendaTemplate.detail",
        "agendaTemplate.countForBoard",
        "agendaTemplate.insert",
        "agendaTemplate.update",
        "agendaTemplate.setDefault",
        "agendaTemplate.delete",
        "permissions",
        "person.list",
        "person.detail",
        "person.insert",
        "person.update",
        "person.insertStaffAccount",
        "person.updateGovTitle",
        "invitation.insert",
        "town.acknowledgeRetentionPolicy",
        "town.detail",
        "town.portalAddress",
        "town.setPortalAddress",
        "town.updateMeetingDefaults",
        "town.updateMeetingRoles",
        "town.updateMinutesWorkflow",
        "town.updateProfile",
        "notificationPreference.mine",
        "notificationPreference.setMine",
        "meeting.byTown",
        "meeting.byBoard",
        "meeting.detail",
        "meeting.insert",
        "meeting.cancel",
        "meeting.updateStatus",
        "meeting.publishAgenda",
        "exhibit.byMeeting",
        "exhibit.link",
        "agendaItem.countByMeeting",
        "agendaItem.byMeeting",
        "agendaItem.insert",
        "agendaItem.update",
        "agendaItem.reorder",
        "agendaItem.delete",
        "agendaItem.instantiateFromTemplate",
        // Unwired as of wave 4 — wave 5's `live.tsx` is the caller. Pinned
        // here anyway: the point of shipping them now is that wave 5 extends
        // this router instead of creating one, and a rename in the meantime
        // should be caught here rather than in wave 5's first client change.
        "agendaItem.setOperatorNotes",
        "agendaItem.markComplete",
        "minutesDocument.byMeeting",
        "meetingAttendance.countByMeeting",
        // Phase E wave 5, Task 3 — the live-meeting routers. Every one of
        // these is UNWIRED client-side until Tasks 4 and 5; pinned here for
        // the reason the two `agendaItem` procedures above are, and with more
        // at stake: these are the names `live.tsx`'s fifteen raw Supabase
        // writes become, so a rename before that wiring lands should be caught
        // here rather than in the first task that calls one.
        "meetingAttendance.byMeeting",
        "meetingAttendance.setRollCall",
        "meetingAttendance.setStatus",
        "agendaItemTransition.byMeeting",
        "motion.byMeeting",
        "motion.insert",
        "motion.callVote",
        "motion.withdraw",
        "voteRecord.byMeeting",
        "voteRecord.insert",
        "voteRecord.recordForMotion",
        "executiveSession.byMeeting",
        "executiveSession.insert",
        "executiveSession.markEntered",
        "executiveSession.markExited",
        "executiveSession.discard",
        "executiveSession.appendPostSessionActionMotions",
        "guestSpeaker.byMeeting",
        "guestSpeaker.insert",
        "guestSpeaker.delete",
        "meeting.callToOrder",
        "meeting.navigateToAgendaItem",
        "meeting.adjourn",
        // Phase E wave 5, Task 1 — the SSE transport. Unwired client-side
        // until Task 4, pinned here for the same reason the two agendaItem
        // procedures above are: this name is what `useRealtimeSubscription`'s
        // replacement will call, and a rename in the meantime should be caught
        // here rather than in that task's first client change.
        "realtime.onMeetingChange",
        "whoami",
      ]),
    );
  });

  it("every pinned procedure validates its input", () => {
    // NOT via createCaller with an empty context: protectedProcedure's
    // requireTenant middleware runs BEFORE input parsing, so such a call
    // rejects with UNAUTHORIZED and the assertion passes for the wrong
    // reason — it would still pass with the input schema deleted. Parse the
    // schema directly instead. Real input handling end-to-end is covered by
    // board.test.ts, which has a real context.
    // `_def.procedures`'s TS type is a mapped object keyed by each
    // procedure's literal name, with no index signature — accurate for a
    // fixed, known set of names, but `name` here is a plain string as it
    // walks the list below, which TS rejects (TS7053) even though the
    // runtime object indexes by string exactly this way. Widen only the
    // lookup type, not what is actually reached through it; `as unknown as`
    // because the real type shares no structure with this one for `as`
    // alone to accept.
    const procedures = appRouter._def.procedures as unknown as Record<
      string,
      { _def: { inputs?: Array<{ parse: (input: unknown) => unknown }> } } | undefined
    >;
    for (const name of [
      "board.detail",
      "board.stats",
      "board.recentMeetings",
      "boardMember.roster",
      "boardMember.activeCountForBoard",
      "meeting.byBoard",
      "meeting.detail",
      "person.detail",
      "agendaItem.countByMeeting",
      "exhibit.byMeeting",
      "minutesDocument.byMeeting",
      "meetingAttendance.countByMeeting",
      // A subscription's input is parsed the same way a query's is — the
      // procedure TYPE differs, the input schema does not. `meetingId` is a
      // uuid here too, so the shared bad value below exercises it.
      "realtime.onMeetingChange",
      "meetingAttendance.byMeeting",
      "agendaItemTransition.byMeeting",
      "motion.byMeeting",
      "voteRecord.byMeeting",
      "executiveSession.byMeeting",
      "guestSpeaker.byMeeting",
    ]) {
      const def = procedures[name]?._def;
      const schema = def?.inputs?.[0];
      expect(schema, `${name} has no input schema`).toBeDefined();
      expect(() => schema?.parse({ boardId: "not-a-uuid" })).toThrow();
    }
    // The town writes: an empty object is missing every required field for
    // `updateProfile`/`updateMeetingDefaults`, and an out-of-enum value for
    // `updateMeetingRoles`' free-text field would not catch a deleted schema
    // the way a missing-required-field object does, so `{}` is used
    // uniformly here rather than a schema-specific bad value.
    for (const name of [
      "town.updateProfile",
      "town.updateMeetingDefaults",
      "town.updateMeetingRoles",
      "town.updateMinutesWorkflow",
      "person.insert",
      "person.update",
      "person.insertStaffAccount",
      "person.updateGovTitle",
      "board.copyNoticeTemplate",
      "board.insert",
      "board.update",
      "boardMember.searchCandidates",
      "boardMember.personEmailExists",
      "boardMember.addBoardMember",
      "boardMember.addStaffMember",
      "boardMember.otherActiveCount",
      "boardMember.activeCountForBoard",
      "boardMember.archiveMembership",
      "boardMember.addToBoard",
      "boardMember.convertToStaff",
      "person.archiveUserAccount",
      "invitation.insert",
      "meeting.insert",
      "meeting.cancel",
      "meeting.updateStatus",
      "meeting.publishAgenda",
      "exhibit.link",
      "agendaTemplate.list",
      "agendaTemplate.detail",
      "agendaTemplate.countForBoard",
      "agendaTemplate.insert",
      "agendaTemplate.update",
      "agendaTemplate.setDefault",
      "agendaTemplate.delete",
      "notificationPreference.setMine",
      "meetingAttendance.setRollCall",
      "meetingAttendance.setStatus",
      "motion.insert",
      "motion.callVote",
      "motion.withdraw",
      "voteRecord.insert",
      "voteRecord.recordForMotion",
      "executiveSession.insert",
      "executiveSession.markEntered",
      "executiveSession.markExited",
      "executiveSession.discard",
      "executiveSession.appendPostSessionActionMotions",
      "guestSpeaker.insert",
      "guestSpeaker.delete",
      "meeting.callToOrder",
      "meeting.navigateToAgendaItem",
      "meeting.adjourn",
    ]) {
      const def = procedures[name]?._def;
      const schema = def?.inputs?.[0];
      expect(schema, `${name} has no input schema`).toBeDefined();
      expect(() => schema?.parse({})).toThrow();
    }
  });
});

/**
 * Phase E, wave 5 — the live-meeting publish inventory.
 *
 * `realtime/events.ts` declines a database trigger in favour of an
 * application-level `publishRealtimeEvent`, and names the cost of that choice
 * exactly: **a write that forgets to publish leaves every other device stale,
 * with no error anywhere.** No exception, no failing request, no log line —
 * the clerk's screen simply stops updating and nobody finds out until someone
 * refreshes.
 *
 * That file used to say the mitigation was "a marker, not a hope" and that
 * this test file "is where 'every live-meeting mutation publishes' becomes
 * checkable". It was neither: `grep -rn "phase-e-wave-5-publish"` matched only
 * the sentence describing it. This block is the check that sentence described.
 *
 * ─── What it does ─────────────────────────────────────────────────────────
 *
 * It reads `trpc/routers/*.ts` as text and finds every `.mutation(` that
 * writes one of `LIVE_MEETING_TOPICS`' eight tables — directly, or through a
 * module-level helper it calls by name. Each such mutation must either call
 * `publishRealtimeEvent`, or appear in `AWAITING_PUBLISH` below. Both
 * directions are asserted, so the ledger cannot rot: a mutation that starts
 * publishing must LEAVE the ledger, and a new one that does not publish must
 * enter it deliberately.
 *
 * Task 3 adds the motion, vote, attendance, executive-session, guest-speaker
 * and composite-meeting mutations. Each new write either publishes or fails
 * this test with its own name in the message — which is the whole point, and
 * is why the ledger is a literal list rather than "every mutation currently
 * found".
 *
 * **The limit that matters most for Task 3's own procedures, restated because
 * it is easy to read this check as stronger than it is:** `publishes` is a
 * BOOLEAN per mutation, not a set compared against `topics`. Three of Task 3's
 * mutations write FOUR live-meeting tables in one transaction
 * (`meeting.callToOrder`, `meeting.adjourn`,
 * `meeting.navigateToAgendaItem`), and this check is satisfied by any ONE
 * `publishRealtimeEvent` call in them. A mutation that announces `meeting` and
 * forgets `agenda_item` passes here and leaves the agenda panel stale on every
 * other device. Only the per-procedure tests in
 * `routers/__tests__/meeting.test.ts` cover that, by asserting the exact set of
 * topics each composite publishes.
 *
 * ─── What it does not do ──────────────────────────────────────────────────
 *
 * It is a text scan, so it is blind to a write issued through an import from
 * another module, and to one built by string concatenation rather than
 * written in a `sql` template. It cannot check that the topic published
 * MATCHES the table written, or that the publish is inside the write's own
 * transaction — `realtime/__tests__/events.test.ts` pins the transactional
 * property of `publishRealtimeEvent` itself, and the topic mapping is Task 3's
 * to get right per call site. It is a floor under a failure mode that is
 * otherwise completely silent, not a proof.
 *
 * The scan is guarded against becoming vacuous in two ways: it asserts it
 * found a non-empty set, and it names two procedures it must always find.
 * Both exist because a scan that silently matches nothing is the exact shape
 * `docs/superpowers/plans/phase-e-conventions.md` item 13 catalogues.
 *
 * ─── The guard above is per FILE, not per repository — fix round 2 ────────
 *
 * `scanned.length > 0` and the two named procedures protect exactly the two
 * files those procedures happen to live in (`agenda-item.ts`, `meeting.ts`).
 * They say NOTHING about a third file. If `PROCEDURE_KEY` or
 * `TOP_LEVEL_FUNCTION` stops matching in only THAT file — a reformat, a
 * differently-indented mutation, a helper renamed in a way the regex no
 * longer sees — `scanRouterFile` silently returns `[]` for it. `scanned`
 * stays non-empty (the other files still contribute) and the two named
 * procedures are untouched, so the guard above stays green while that file's
 * mutations quietly vanish from both `scanned` and the ledger check below —
 * which then compares two lists BOTH missing the same entries, and passes
 * for the wrong reason.
 *
 * This matters concretely for Task 3: it creates new router files (motion,
 * vote record, attendance, executive session, guest speaker) that this file
 * has never seen and names no canary for. The fix is not "add more named
 * procedures" — that only ever protects files someone remembered to name.
 * `"every router file that writes a live-meeting table is represented in the
 * scan"` below is the mechanical version: for EVERY file in `ROUTERS_DIR`,
 * it re-derives — from the file's raw text, independent of `PROCEDURE_KEY`/
 * `TOP_LEVEL_FUNCTION` — whether that file writes a live-meeting table at
 * all, and if so, requires `scanned` to contain at least one mutation
 * attributed to that file's router prefix. A new router file Task 3 adds is
 * covered automatically the moment it writes a live-meeting table; nothing
 * needs to be added to this test for it. `realtime/events.ts`'s header
 * states this same requirement for whoever opens that file looking for
 * `publishRealtimeEvent` instead of this one.
 */
const ROUTERS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "routers");

/**
 * Mutations that write a live-meeting table and do NOT publish, on purpose,
 * for now.
 *
 * **Empty, as of Phase E wave 5, Task 3 — the ledger is discharged.** It held
 * eleven entries when Task 1 created it: the seven `agendaItem` writes and the
 * four `meeting` writes, all shipped in waves 3 and 4 against the Supabase
 * Realtime client wave 5 removes. Each now calls `publishRealtimeEvent` inside
 * its own transaction, and the "every live-meeting write mutation either
 * publishes or is on the ledger" test's SECOND direction is what forced the
 * entries out as they did: a mutation that publishes while still listed here
 * fails, by name.
 *
 * **An empty ledger is not a weaker check, and that is worth stating because
 * it looks like one.** Direction 1 below is the assertion that matters, and it
 * has more teeth now than at any point before: with nothing declared, EVERY
 * live-meeting mutation must publish, so the next silent write fails
 * immediately rather than being compared against a list that already excuses
 * eleven others. Direction 2 is dormant, by construction, until someone adds
 * an entry.
 *
 * **Adding an entry is still the right move for a deliberate exception** — a
 * write to one of the eight tables that genuinely should wake nobody. Say why,
 * in a comment on the entry, and mark it `TODO(phase-e-wave-5-publish)` if it
 * is a deferral rather than a decision. An entry removed from here without the
 * mutation publishing fails the test; a mutation that publishes while still
 * listed here fails it too.
 */
const AWAITING_PUBLISH: readonly string[] = [];

/** A `.mutation(` found by the scan, with what it writes and whether it announces it. */
interface ScannedMutation {
  readonly path: string;
  readonly topics: readonly string[];
  readonly publishes: boolean;
}

const LIVE_TABLE_WRITE = new RegExp(
  String.raw`\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(${LIVE_MEETING_TOPICS.join("|")})\b`,
  "gi",
);

/** Every top-level declaration start, used to bound a helper's body. */
const TOP_LEVEL_DECL =
  /^(?:export\s+)?(?:async\s+)?(?:function|const|class|type|interface|enum)\b/gm;
/** A module-level `function name(` — `sql` writes live in these as well as in resolvers. */
const TOP_LEVEL_FUNCTION = /^(?:export\s+)?(?:async\s+)?function\*?\s+([A-Za-z0-9_]+)/gm;
/** A procedure key inside a `router({ … })` literal, at prettier's two-space indent. */
const PROCEDURE_KEY =
  /^ {2}([A-Za-z][A-Za-z0-9_]*): (?:protectedProcedure|publicProcedure|subscriptionProcedure)\b/gm;
/**
 * A router file's own `export const xRouter = router({` declaration. Shared
 * between `scanRouterFile` (which needs the body it opens) and the per-file
 * vacuity guard below (which only needs the prefix) — one regex, so the two
 * can never disagree about what counts as a router file.
 */
const ROUTER_EXPORT = /^export const ([A-Za-z0-9_]+)Router = router\(\{$/m;

function liveTablesWrittenIn(text: string): string[] {
  return [...text.matchAll(LIVE_TABLE_WRITE)].map((match) => match[1]!.toLowerCase());
}

/** The router prefix a file's mutations would be attributed under, or `null`. */
function routerPrefixOf(source: string): string | null {
  return ROUTER_EXPORT.exec(source)?.[1] ?? null;
}

function scanRouterFile(source: string): ScannedMutation[] {
  const routerMatch = ROUTER_EXPORT.exec(source);
  if (!routerMatch) return [];
  const prefix = routerMatch[1]!;
  const bodyStart = routerMatch.index + routerMatch[0].length;
  const bodyEnd = source.indexOf("\n});", bodyStart);
  const body = source.slice(bodyStart, bodyEnd === -1 ? source.length : bodyEnd);

  // Module-level helpers, bounded by the next top-level declaration. A helper
  // that writes is attributed to every mutation that names it —
  // `agendaItem.instantiateFromTemplate` writes `agenda_item` through
  // `insertMinutesApprovalItems`, and a file-level check would have let a
  // future helper hide a write from a mutation that looks clean.
  const declStarts = [...source.matchAll(TOP_LEVEL_DECL)].map((m) => m.index);
  const helpers = new Map<string, { topics: string[]; publishes: boolean }>();
  for (const match of source.matchAll(TOP_LEVEL_FUNCTION)) {
    const start = match.index;
    const end = declStarts.find((index) => index > start) ?? source.length;
    const text = source.slice(start, end);
    helpers.set(match[1]!, {
      topics: liveTablesWrittenIn(text),
      publishes: text.includes("publishRealtimeEvent("),
    });
  }

  const keys = [...body.matchAll(PROCEDURE_KEY)];
  return keys.flatMap((match, index) => {
    const chunk = body.slice(match.index, keys[index + 1]?.index ?? body.length);
    if (!chunk.includes(".mutation(")) return [];

    const topics = new Set(liveTablesWrittenIn(chunk));
    let publishes = chunk.includes("publishRealtimeEvent(");
    for (const [name, helper] of helpers) {
      if (!chunk.includes(`${name}(`)) continue;
      for (const topic of helper.topics) topics.add(topic);
      publishes ||= helper.publishes;
    }
    if (topics.size === 0) return [];
    return [{ path: `${prefix}.${match[1]!}`, topics: [...topics].sort(), publishes }];
  });
}

function scanLiveMeetingMutations(): ScannedMutation[] {
  return readdirSync(ROUTERS_DIR)
    .filter((file) => file.endsWith(".ts"))
    .flatMap((file) => scanRouterFile(readFileSync(join(ROUTERS_DIR, file), "utf8")))
    .sort((a, b) => a.path.localeCompare(b.path));
}

describe("the live-meeting publish inventory", () => {
  const scanned = scanLiveMeetingMutations();

  it("finds the live-meeting write mutations at all", () => {
    // The guard against a green run that proves nothing. If a refactor moves
    // the routers, renames `LIVE_MEETING_TOPICS`, or changes the shape
    // prettier formats a router literal into, this is what says so — instead
    // of the ledger assertion below quietly comparing two empty lists.
    expect(scanned.length).toBeGreaterThan(0);
    const paths = scanned.map((mutation) => mutation.path);
    expect(paths).toContain("agendaItem.insert");
    expect(paths).toContain("meeting.updateStatus");

    // And the `publishes` half of a scanned mutation is really being read off
    // the source. Added in wave 5, Task 3, when the ledger emptied: with
    // `AWAITING_PUBLISH` at zero entries, direction 1 below passes for every
    // mutation the scan believes publishes — so a `publishes` that had
    // silently become "always true" (a loosened substring, a helper match
    // that fires on any name) would make the whole inventory green while
    // proving nothing. These two are the same canaries named above, asserted
    // on the other field.
    for (const path of ["agendaItem.insert", "meeting.updateStatus"]) {
      const mutation = scanned.find((m) => m.path === path);
      expect(mutation?.publishes, `${path} should be seen to publish`).toBe(true);
    }

    // And every path the scan produced is a real procedure. A scan that
    // drifted from the router — a helper misread as a resolver, a stale
    // prefix — would invent names, and a ledger of names nothing dispatches
    // is worse than no ledger.
    const procedures = new Set(Object.keys(appRouter._def.procedures));
    for (const mutation of scanned) {
      expect(procedures.has(mutation.path), `${mutation.path} is not a procedure`).toBe(true);
      expect(mutation.topics.length).toBeGreaterThan(0);
    }
  });

  it("every router file that writes a live-meeting table is represented in the scan", () => {
    // The mechanical version of the guard above — see this describe block's
    // header, "The guard above is per FILE, not per repository". Named
    // canaries only ever protect the specific files someone remembered to
    // name; this protects every file, including ones that do not exist yet.
    //
    // For each router file, independently of PROCEDURE_KEY/TOP_LEVEL_FUNCTION
    // (the machinery this very check exists to distrust), re-derive from the
    // raw text whether the file writes a live-meeting table at all. If it
    // does, `scanned` must contain at least one mutation attributed to that
    // file's router prefix — proving `scanRouterFile` actually saw into this
    // file, not just into the repository as a whole.
    const files = readdirSync(ROUTERS_DIR).filter((file) => file.endsWith(".ts"));
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const source = readFileSync(join(ROUTERS_DIR, file), "utf8");
      if (liveTablesWrittenIn(source).length === 0) continue; // this file touches no live table

      const prefix = routerPrefixOf(source);
      expect(
        prefix,
        `${file} writes a live-meeting table but has no "export const …Router = router({" ` +
          `declaration the scan can find`,
      ).not.toBeNull();

      const attributed = scanned.some((mutation) => mutation.path.startsWith(`${prefix}.`));
      expect(
        attributed,
        `${file} writes a live-meeting table (matched directly against the raw file text) but ` +
          `the scan attributed NO mutation to "${prefix}." — a formatting or structural change ` +
          `likely broke PROCEDURE_KEY or TOP_LEVEL_FUNCTION for this file specifically, and it is ` +
          `now silently unprotected. See this file's header before adjusting either regex.`,
      ).toBe(true);
    }
  });

  it("every live-meeting write mutation either publishes or is on the ledger", () => {
    // Two directional checks rather than one list-equality assertion, so
    // each is independently reachable and produces its own message — fix
    // round 2: the equality form below (now deleted) always failed on the
    // SAME condition as the "stale ledger entry" check that followed it, so
    // the second assertion's own message could never fire; it was dead code
    // that happened to look like a check.
    //   const silent = scanned.filter(...).map(...);
    //   expect(silent, message).toEqual([...AWAITING_PUBLISH].sort());
    //   const stale = publishing.filter((path) => AWAITING_PUBLISH.includes(path));
    //   expect(stale, "...").toEqual([]); // unreachable: `silent` and
    //     // `publishing` partition `scanned`, so whenever the equality above
    //     // holds, `stale` is always `[]` by construction — and whenever it
    //     // doesn't hold, the throw above it means this line never runs.
    const silentPaths = new Set(
      scanned.filter((mutation) => !mutation.publishes).map((m) => m.path),
    );
    const publishingPaths = new Set(
      scanned.filter((mutation) => mutation.publishes).map((m) => m.path),
    );

    // Direction 1 — the actual silent-failure mode this test exists to
    // catch: a live-meeting mutation that writes without publishing and is
    // not on the ledger. Adding it to `AWAITING_PUBLISH` to get green is a
    // deliberate, reviewable act; forgetting is not an option.
    const undeclaredSilence = [...silentPaths]
      .filter((path) => !AWAITING_PUBLISH.includes(path))
      .sort();
    expect(
      undeclaredSilence,
      "a live-meeting mutation writes without publishing and is not on AWAITING_PUBLISH — see this file's header",
    ).toEqual([]);

    // Direction 2 — a ledger entry that no longer describes reality: either
    // the mutation now publishes (Task 3 discharged it and forgot to remove
    // the entry) or it no longer appears in the scan at all (renamed,
    // removed). Checked against `silentPaths` directly rather than derived
    // from direction 1's result, so this can fail — and report by name — on
    // its own, independently of whether direction 1 passed.
    const staleLedgerEntries = AWAITING_PUBLISH.filter((path) => !silentPaths.has(path)).sort();
    expect(
      staleLedgerEntries,
      "these AWAITING_PUBLISH entries no longer match a silent mutation — remove the ones that " +
        `now call publishRealtimeEvent (currently publishing: ${[...publishingPaths].sort().join(", ")}); ` +
        "investigate the rest (renamed or removed?)",
    ).toEqual([]);
  });
});
