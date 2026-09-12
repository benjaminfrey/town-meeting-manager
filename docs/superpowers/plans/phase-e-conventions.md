# Phase E conventions — the template the six waves copy

Phase E moves roughly 80 web screens off `@/lib/supabase` and onto tRPC. Unit 0 migrated exactly
one screen (`routes/boards.$boardId.tsx`, Overview data only) and reviewed it hard, precisely so
that the mistakes would happen once instead of eighty times.

Every rule below has evidence attached, and the evidence is a thing that actually went wrong in
that one screen. Where a rule says "verified by mutation", someone deleted the guard, watched the
test go red, and restored it byte-identical. Nothing here is a preference.

Read items 8, 9 and 13 before writing your first test. They are the ones that decide whether the
suite you leave behind can fail.

---

## 1. Where a query goes

One router per domain noun, in `packages/api/src/trpc/routers/`, mounted by name in
`packages/api/src/trpc/router.ts`.

```ts
// packages/api/src/trpc/router.ts
import { townRouter } from "./routers/town.js";
import { boardRouter } from "./routers/board.js";

export const appRouter = router({
  town: townRouter,
  board: boardRouter,
  whoami: protectedProcedure.query(async ({ ctx }) => {
    /* ... */
  }),
});

export type AppRouter = typeof appRouter;
```

**Never `SELECT *`.** List the columns the screen reads, and say in the doc comment where you
checked — **by symbol or tab, never by line number.** `board.detail` names its 21 columns and, as
written today, cites the tab and the mapping it was checked against:

```ts
// packages/api/src/trpc/routers/board.ts
detail: protectedProcedure
  .input(z.object({ boardId: z.string().uuid() }))
  .query(async ({ ctx, input }) => {
    const rows = await ctx.withTenant(async (tx) =>
      toRows<{ id: string; name: string; /* ...18 more, each named... */ }>(
        await tx.execute(sql`
          SELECT id, name, elected_or_appointed, member_count, election_method,
            /* ... */ auto_publish_on_approval_override
          FROM board WHERE id = ${input.boardId}
        `),
        (message) => new Error(`board.detail: ${message}`),
      ),
    );
    const row = rows[0];
    if (!row) throw new TRPCError({ code: "NOT_FOUND" });
    return row;
  }),
```

An explicit list means a schema change that drops a column this screen depends on fails at the
query, not as `undefined` deep inside a settings form. It also makes omissions deliberate and
documented — ~~`board.detail` leaves out `board_type` because nothing on that screen reads it, and
says so. Add it back the day something does.~~ **True when this item was written; false since wave
2, Task 2 (`1939f57`), which added `board_type` back.** `boards.$boardId.templates.tsx`'s
auto-create effect needs it to pick which of `getDefaultTemplateSections`'s four fixed outputs to
seed a new board with, and that screen now reads its board row through this procedure rather than
its own separate `select("id, name, board_type")` — `board.detail`'s own doc comment
(`board.ts:109-115`) already states the addition in full, exactly the promise this paragraph used
to make ("add it back the day something does"). This paragraph itself kept describing the
pre-`1939f57` exclusion as current fact for three further waves; found in wave 5, Task 0's fix
round, by the same widened read of item 1's prose (not a Known-gaps bullet) that also caught item
2's `CancelMeetingDialog.tsx` claim below — see item 14's close-out for both.

**Do not cite a line range.** `board.detail` and `board.recentMeetings` both did, at
`boards.$boardId.tsx:215-228`/`:603-616` and `:163-167`. By the time this was reviewed, Task 4 had
already rewritten that screen once and both citations pointed at the wrong code — one at an
unrelated Supabase query, the other split across a loading branch and an unrelated mapping. A line
range is correct only until the cited file's next edit, and this document exists because every one
of ~80 wave migrations edits the file it cites. Point at a symbol (`const b = { ... }`, a component
name) or a tab (`activeTab === "meetings"`) instead — either survives a rewrite that a line number
cannot.

Casts in SQL are load-bearing and belong in a comment. `postgres.js` returns `count(*)` as the
**string** `"0"`, so `board.stats` casts `::int` — and its test asserts `typeof`, not just the
value, because a missing cast renders correctly and passes a loose comparison.

---

## 2. Reads versus writes

**A read whose old policy was tenancy-only gets `protectedProcedure` and no guard.**
`protectedProcedure` + `ctx.withTenant` _is_ that policy: RLS makes another town's rows invisible.
Adding a second town-id comparison in TypeScript creates a weaker duplicate that people
eventually trust instead. `board.ts` states this at the top of the file rather than leaving the
absent guard to look like an oversight:

> No permission guard, deliberately: `board` carried a pure tenancy policy and nothing else, so
> any authenticated member of a town may read that town's boards.

**A write gets the matching `assertCan*` rule from `packages/api/src/trpc/authorization/rules.ts`.**
Do not invent a check. If the rule does not exist, add it there, next to its siblings.

**Rewritten (Task 2 fix round, wave 1).** The item used to frame the remaining question as
"resolver versus middleware." That framing was wrong, not incomplete — see "What this item
originally got wrong" below — and it produced a real defect in the first four mutations wave 1
wrote. The actual rule:

**Authorization goes in middleware, declared BEFORE `.input()`.** That is the only position input
parsing cannot preempt. Measured, not assumed — two probes against tRPC 11.18.0:

**Probe 1 — declaration order controls whether a guard can be preempted.**

| form                        | error returned | guard ran |
| --------------------------- | -------------- | --------- |
| `.use(guard).input(schema)` | `FORBIDDEN`    | **yes**   |
| `.input(schema).use(guard)` | `BAD_REQUEST`  | **no**    |

**Probe 2 — a middleware before `.input()` cannot see the parsed input.**

| middleware position | `opts.input`       | `await opts.getRawInput()` |
| ------------------- | ------------------ | -------------------------- |
| before `.input()`   | **`undefined`**    | `{boardId: "b-1"}`         |
| after `.input()`    | `{boardId: "b-1"}` | `{boardId: "b-1"}`         |

`.input(...).use(guard)` — declaring the parser first — REINTRODUCES the defect: a refused caller
whose input also fails validation gets BAD_REQUEST before the guard ever runs. This is not a
hypothetical ordering mistake; it is exactly how `town.updateProfile` first shipped (resolver form,
which is textually always after `.input()` — see below), and the first version of its own refusal
test caught it by accident, sending a town name containing `(` and getting BAD_REQUEST back where
FORBIDDEN was expected.

**Actor-only rules** — `.use(requirePermission(code))` before `.input()`, for any rule keyed by one
of the thirty `PermissionCode`s in `PERMISSIONS`:

```ts
protectedProcedure
  .use(requirePermission("C2", { action: "to read the notification log" }))
  .input(z.object({ ... }))
  .mutation(...)
```

**Admin gates that are NOT `PermissionCode`-keyed** — `assertCanUpdateTown` and its siblings in
`rules.ts`'s "Phase B report §4b" section — do NOT go through `requirePermission`. They check the
caller's role directly, deliberately outside the delegable-permission-matrix system;
`packages/api/src/storage/__tests__/documents.test.ts` pins exactly why for this rule: "there is no
action code that grants editing the town record, so an actor with a maximal matrix must still be
refused." Routing one of these through `requirePermission("T1", ...)` would answer identically
today (nothing currently grants `T1` in any matrix) but would make "never delegable" an accident of
configuration instead of a fact TypeScript enforces — the exact "quietly becomes delegable" failure
this document's `BOARD_SCOPED_CODES` section warns about for a different set of codes. Use
`requireActor` instead, added in the fix round specifically for this category:

```ts
// packages/api/src/trpc/routers/town.ts
updateProfile: protectedProcedure
  .use(requireActor(assertCanUpdateTown))
  .input(z.object({ ... }))
  .mutation(async ({ ctx, input }) => { ... }),
```

`requireActor` needs no board id and therefore no `getRawInput()` read — it only calls
`ctx.actor()`. `translateAuthorizationErrors` still does the FORBIDDEN mapping for both forms; that
part of the item was correct and is unchanged.

**Parked, not closed:** `requireActor`'s generic-plus-conditional-tuple type check (see its own doc
comment in `trpc.ts`) closes the realistic accidental path — `requireActor(isAdmin)` and
`requireActor(isBoardMember)` both fail to compile — but a predicate explicitly WIDENED to
`(actor: Actor) => void`, or `as`-cast at the call site, still passes silently, because that is
ordinary TypeScript structural typing rather than a hole this file's mechanism can close. Ruled real
but low-priority in Task 2's review: closing it needs a nominal brand on `assertCanX`'s return type
across roughly 46 assert functions, priced and deliberately declined rather than spent here — noted
so a future wave does not spend a round rediscovering the option instead of finding this sentence.

**Board-scoped rules** — `.use(requireBoardPermission(code, boardIdFrom()))` before `.input()`,
which now WORKS at that position only because of a matching fix: `requirePermission`'s board
extractor used to read `opts.input`, which probe 2 shows is `undefined` before `.input()` runs — a
board-scoped guard placed at the position this item requires would have refused every single call
before the fix, fail-closed but dead. It now reads `await opts.getRawInput()` instead — the
UNVALIDATED body. That is safe: `boardIdFrom` already narrows at runtime and returns `undefined` on
anything that is not a non-empty string at the key, and the guard already refuses when the
extractor yields nothing, so reading unvalidated input widens nothing a junk value could exploit.

```ts
protectedProcedure
  .use(requireBoardPermission("A1", boardIdFrom()))
  .input(z.object({ boardId: z.uuid() }))
  .mutation(...)
```

**One hazard this fix introduces, stated so it does not get rediscovered the hard way:** the guard
now authorizes against the PRE-validation board id (from `getRawInput()`) while the resolver acts
on the POST-validation one (from `input`, after `.input()` parses). Those are the same value today
for every board-scoped procedure in this repo. They would NOT be the same if an input schema ever
applied `.transform()` to the board id field — the guard would authorize one board while the
resolver acted on another. **Do not transform a value a guard authorizes on.**

**Two more write-guard shapes shipped this wave (Task 3), and neither fits the two named above.**
Both belong here rather than staying visible only in one router's own header comment, because the
next wave's author is the one who needs to find them.

**A subject-carrying middleware.** `assertCanUpdateUserAccount` in `rules.ts` does not fit
`requireActor`'s `(actor: Actor) => R` shape — it takes a second argument,
`subject: { userAccountId, columns }`, because its self-branch authorizes the ROW ("is this the
caller's own account?"), not the actor alone. `packages/api/src/trpc/routers/person.ts`'s
`updateGovTitle` handles this with `requireOwnAccountColumns`, a one-off local
middleware — not a new export on `trpc.ts`; nothing else in the app needs this exact shape yet, and
that file's own header warns that being wrong there is "wrong 70 times over." Declared before
`.input()`, it reads `userAccountId` off the UNVALIDATED body via `getRawInput()` — the identical
mechanism `requireBoardPermission`/`boardIdFrom` already use for a board id — and supplies `columns`
as a compile-time constant per call site, never derived from input. **This is the example to send a
wave-3 author who has a rule keyed on something other than the actor alone:** the board-scoped form
below is still unexercised outside its own tests, but this shape is not — it is live, in `person.ts`,
today.

**A write with no `assertCan*` at all, correctly.** `packages/api/src/trpc/routers/notification-preference.ts`'s
`setMine` carries no guard, and that is deliberate too — but for a different reason than `board.ts`'s
"tenancy is enough" reads above. `setMine` writes a person's OWN notification preferences, and
`person_id` is taken from `ctx.tenant.personId` — the caller's own bridged session — never from the
request body. There is no `personId` input field a caller could substitute, so scoping holds by
construction; an application-level `assertCan*` check would add nothing on top of "there is nothing
to authorize against." **Read the rule above ("A write gets the matching `assertCan*` rule … If the
rule does not exist, add it there") as conditional on there being something to authorize, not as
unconditional.** An author with a genuinely self-scoped write who follows it literally has two ways
to go wrong: invent a rule that only duplicates what construction already guarantees, or — the
dangerous branch — add a `personId` input parameter so there is something to authorize against,
which reopens exactly the hole this design closes. Check first whether the write's own scoping value
comes from `ctx.tenant` rather than client input; if it does, no guard is the correct answer, and
`notification-preference.ts`'s own header states the reasoning in full.

**Row-level rules stay in the resolver by necessity, unchanged from before.** "These minutes are
still a draft" cannot be decided before the row is read. `rules.ts` provides three shapes for
SELECT — `canX` answers, `assertCanX` throws, `visibleX` filters — so pick rather than improvise: a
list endpoint that threw on the first invisible row would be unusable, and a detail endpoint that
filtered would return 200 with nothing.

**The refusal-test rule, restated (it was over-strict the first time — see item 13 for the full
correction, which is where this belongs since it is general test discipline, not specific to this
item's defect):** a refusal test must assert **FORBIDDEN**. That is the whole rule. An earlier
version of this item said "on input that parses," which is a heuristic that happened to fit the
first symptom found, not the actual discriminator — and stated as an absolute it forbids the
ordering pin two paragraphs down, which is deliberately built on input that does NOT parse, because
that is the only way to catch a guard declared in the wrong position. What actually distinguishes a
real pin from a vacuous one is the asserted CODE: a test asserting `BAD_REQUEST` can stay green with
the guard fully deleted (the parser alone still produces `BAD_REQUEST` for bad input, guard or no
guard) — which is exactly how the first version of `town.updateProfile`'s regression-pin test
stayed green when a reviewer deleted `assertCanUpdateTown` entirely. A test asserting `FORBIDDEN`
cannot pass that way, regardless of whether its input happens to parse.

**What this item originally got wrong.** Not "resolver versus middleware" — that framing named one
instance of the defect (the resolver form is textually always after `.input()`, since `.mutation()`
is the terminal step of the chain) and missed the general rule: **anything declared after
`.input()` can be preempted by it**, including a middleware placed there by choice. The original
item's own `setPortalAddress` example was resolver-form and never caught the ordering bug only
because its schema (`z.object({ subdomain: z.string() })`) WAS too permissive for almost any string
to fail. **Historical note, not current status — see below:** at the time this paragraph was
written (Task 2's fix round), `setPortalAddress` was still unconverted and its schema was still
that permissive bare `z.string()`. Both are fixed now (Task 5): the procedure is
`.use(requireActor(...)).input(...)` like every other write in `town.ts`, and its schema is real
enough to carry its own reorder pin — see its own doc comment in `town.ts` for the conversion, and
the "Status today" paragraph immediately below for the current count.

Status today: the Actor-only middleware form (`requireActor`) is exercised — six `town.*`
mutations now: `updateProfile`, `updateMeetingDefaults`, `updateMeetingRoles`,
`acknowledgeRetentionPolicy` (Task 2's fix round) and `updateMinutesWorkflow` (Task 4) were already
converted; Task 5 converts `setPortalAddress`, the sixth and last write in `town.ts`, with tests,
each guard re-verified by deletion after the conversion. Five of the six carry a SECOND pin that
catches a REORDER (`.use()` moved back after `.input()`), not only a deletion — see item 13 for why
that distinction matters and could not be skipped: `updateProfile` (Task 2's fix round),
`updateMinutesWorkflow` (Task 4), and `updateMeetingDefaults`/`updateMeetingRoles`/`setPortalAddress`
(all three added in the review round after Task 5 first shipped — the first version of this task had
the pin only on `setPortalAddress` itself, and a reviewer caught that
`updateMeetingDefaults`/`updateMeetingRoles` had shipped without one despite both being
`.input()`-bearing `requireActor` writes exactly like the others). `acknowledgeRetentionPolicy` is
the one procedure with no reorder pin and none needed: it takes no `.input()` at all (the server
decides the timestamp, not the caller — see its own doc comment), so there is no parseable-or-not
input for a reordered guard to be preempted by; "every mutation gets a reorder pin" only applies
where there is an input to preempt with. `setPortalAddress`'s own reorder pin is also the proof
that the item 2 rewrite's diagnosis was right: its schema used to be a bare `z.string()`, "too
permissive for almost any string to fail," and literally could not have supported a reorder pin
until Task 5 tightened it — see that procedure's own doc comment. The
`PermissionCode` form (`requirePermission`) declared before `.input()` is exercised too, in
`require-permission.test.ts`'s synthetic router, including its own reorder pin — but the GLOBAL
shape (a code with no board) still has **zero call sites in a real procedure** as of wave 3; every
real Actor-only write so far is an admin gate (`requireActor`), not a delegable code, and this
wave's own delegable-code write (`meeting.insert`) is board-scoped, not global. ~~The board-SCOPED
form specifically ... still has **zero call sites outside tests** — no procedure in this repo
authorizes anything board-scoped yet.~~ — **closed in wave 3, Task 1.** `meeting.insert` calls
`requireBoardPermission("A1", boardIdFrom())` for real — see "Wave 3, Task 1 — the board-scoped
form's first real call site, and what it found" below for what that first use found the item got
right and what it did not yet say. **The underlying `getRawInput()` TECHNIQUE this form popularized
is a different claim and is no longer test-only** — `person.ts`'s `requireOwnAccountColumns` (the
subject-carrying shape documented above) reads a different field off `getRawInput()` the identical
way, for a different reason, and ships in a real procedure today. Do not read "zero call sites" for
the GLOBAL `requirePermission` form as covering the board-scoped form too; they are tracked
separately here because they answer different questions, and only one of the two closed this wave.

**Wave 3, Task 1 — the board-scoped form's first real call site, and what it found.** `meeting.insert`
(`packages/api/src/trpc/routers/meeting.ts`) is `.use(requireBoardPermission("A1", boardIdFrom())).input(...)`,
exactly the shape this item's example code has shown for three waves with nothing behind it. The case
this whole mechanism exists for — a global grant REVOKED on one board refuses there and still allows
the same actor elsewhere, and the mirror case the two `designated_boards` templates actually produce
(nothing globally, granted on one board only) — is now exercised by a real procedure for the first
time (`meeting.test.ts`'s "honours a REVOKING board override" / "honours a GRANTING board override"
tests). **What the item got right:** the mechanism worked exactly as specified, first try, for a
single-code write. `requireBoardPermission("A1", boardIdFrom())` needed no changes and no fix round —
`assertCanInsertMeeting(actor, scope)` and `assertPermission(actor, "A1", {boardId, ...})` are the
identical call, so using the code form through the middleware IS calling the rule, not a shortcut
around it (see `meeting.ts`'s own header for why it does not additionally import and call
`assertCanInsertMeeting` directly).

**What the item got wrong, or rather did not yet say: a `BoardScope`-taking rule with more than one
code needs a FOURTH guard shape this item did not catalogue.** (Settled here after an earlier draft
of this paragraph said "fifth" in one sentence and "fourth" three sentences later — the count is
FOUR: `requirePermission`/`requireBoardPermission` together are one form with two positions;
`requireActor` is the second; the subject-carrying middleware shape — `requireOwnAccountColumns` — is
the third; this is the fourth.) `assertCanUpdateMeeting` is `isAdmin(actor) OR A1@board OR M1@board` —
not reducible to one `PermissionCode`, so `requireBoardPermission` (which always resolves exactly one
code via `assertPermission`) cannot express it, the identical reason `requireActor` cannot express a
subject-carrying rule like `assertCanUpdateUserAccount`. The FIRST version of this task's fix gave
`cancel` a local, one-off middleware (`requireCanUpdateMeeting`) for exactly this — but the review
round that found this item's own count inconsistency also asked why it should stay local: a full
audit of `rules.ts`'s `BoardScope` rules — **eighteen** at the time, nineteen since wave 4's Task 2
added `assertCanPublishAgenda`, twenty-nine since wave 5's Task 2 added ten more, THIRTY since
wave 6's Task 1 added `assertCanPublishMinutes`; quote the grep
below, not any of the three numbers — found
`assertCanUpdateMeeting` is not alone.
~~All but two~~ **All but THREE, as of wave 5** ARE exactly one `assertPermission` call — use
`requireBoardPermission` for those, and reach
for it FIRST; this shape is for the rest. The second is `assertCanInsertExhibit`
(A3 OR `isBoardMember(actor)`, a ROLE branch rather than a second code — ~~this one DOES fit the shape
below, structurally; it is named here because it is the other multi-branch example the audit found,
not because it cannot be wired~~ — **wired in wave 4, Task 2: `exhibit.link` is
`requireBoardActor`'s second real call site, and the first on a rule whose second branch is a role.
See "Wave 4, Task 2" below for what that first use found, which is not what a reader of this
paragraph would predict**). The third is wave 5 Task 2's `assertCanUpdateAgendaItemProgress` (A2 OR
M1@board), and it is the first of the three whose SECOND branch is a second delegable code rather
than a role or the admin short-circuit — see "Wave 5, Task 2" below. The ten OTHER rules that task
added are all single-code and belong behind `requireBoardPermission`, not here.

**Corrected in the whole-branch fix round: this count shipped as "nineteen" here and again in
`trpc.ts`'s own `requireBoardActor` doc comment, and it does not reproduce.** Quote the grep, not
the number (item 11) — and this one matters more than a stale marker count, because wave 5 wires the
very rule the miscount was reaching for:

```
$ grep -cE ": BoardScope" packages/api/src/trpc/authorization/rules.ts
16   # Stage 1, Task D1d, where rules.ts's own header first stated a number
18   # at 860a469, wave 4 Task 1's close-out
19   # at 5d11393, after wave 4 Task 2 added `assertCanPublishAgenda` — A5,
     # `publish_agenda`, one of the 18 BOARD_SCOPED_CODES and the only one
     # with no rule in this codebase at all until that task
29   # at 09f7e88, after wave 5 Task 2 added ten: the four live-meeting tables
     # that had no rule at all (executive_session M6, guest_speaker M7,
     # agenda_item_transition M1, future_item_queue M1), the missing
     # vote_record DELETE (M3), and assertCanUpdateAgendaItemProgress
30   # at f6a7ecf, after wave 6 Task 1 added assertCanPublishMinutes — R5,
     # publish_approved_minutes, the THIRD consecutive wave to find a defined
     # code enforced nowhere, and the first whose absence WIDENS rather than
     # simply leaving a write unguarded: the nearest existing minutes-write
     # rule is R1, and TEMPLATE_RECORDING_SECRETARY grants R1 without R5 by
     # design, so migrating publish behind it would have compiled, stayed
     # green, and handed a recording secretary the public portal. The same
     # task decided R6 (export_minutes) gets NO rule; the reasoning is beside
     # rule 13a in rules.ts, so that a fourth sweep finds a decision rather
     # than re-deriving one.
```

`rules.ts`'s own header said **SIXTEEN** from Stage 1 until that commit, three counts out of date —
it now carries this history too, as do `trpc.ts`'s `requireBoardActor` doc comment and
`board-scope.test.ts`'s header. Those four places plus this one are the whole set; if a sixth ever
starts quoting it, add it here.

**One trap this grep has that item 11's `TODO(phase-e-wave-` grep does not, found by re-running
rather than by reading: `rules.ts` must not contain the command.** The pattern `: BoardScope` is a
substring of every signature it counts, so pasting the command INTO the file it greps makes the file
match itself and the answer comes back one too high. Wave 5 Task 2's first attempt at fixing
`rules.ts`'s stale SIXTEEN did exactly that and turned 29 into 30. The header there now states the
counts and points at the command rather than reproducing it. This is the self-referential form of
the markers-versus-mentions problem item 11 already records — a grep whose pattern appears in its own
documentation is a grep that counts its own documentation.

The extra rule the old "nineteen" was reaching for — a DIFFERENT nineteenth from the real one the
grep now counts — was `assertCanInsertVoteRecord` (M3 OR the caller's own active seat), which takes no
`BoardScope` **at all**: its signature is `(actor: Actor, tx: TenantTx, subject: VoteRecordSubject)`,
so `TenantTx` is the **SECOND** argument, not "a THIRD argument" as both places said. It stays
resolver-side regardless, and for the reason already given — it is `async` and needs a `TenantTx` no
middleware has; not a loss, since that `TenantTx` is exactly what its self-vote branch needs.

So `trpc.ts` now exports `requireBoardActor` — `requireActor`'s board-scoped sibling, taking the RULE
FUNCTION rather than a code, generalised rather than left as `meeting.ts`'s own local export:

```ts
protectedProcedure
  .use(requireBoardActor(assertCanUpdateMeeting))
  .input(z.object({ meetingId: z.uuid(), boardId: z.uuid() }))
  .mutation(...)
```

**Reach for `requireBoardPermission` first; use `requireBoardActor` only when the rule spans more than
one code (or a role branch).** **That advice did not work for eleven days, and wave 4's Task 1 is what
made it true.** As shipped in wave 3, only `requireBoardActor` set `ctx.authorizedBoardId`, and
`assertMatchesAuthorizedBoard` (the mismatch defence this item calls the DEFAULT for a row-targeted
board-scoped write, four paragraphs down) threw a plain `Error` without it — message: _"This
procedure's guard must be requireBoardActor — it is the only thing that sets it."_ So an author
following BOTH rules got a procedure that compiles, passes its FORBIDDEN refusal test, and answers
INTERNAL_SERVER_ERROR on the first real call. Since every board-scoped write in waves 4–6 needs the
defence, "narrower first" was dead on arrival for all of them. **`requireBoardPermission` now sets
`ctx.authorizedBoardId` too** (`requirePermission`'s board branch — the GLOBAL form still sets
nothing, because it authorizes no board), so both guards support the defence and the preference above
survives. The alternative considered and declined — use `requireBoardActor` everywhere — would have
spread its known residual (no import-time refusal for a board-scoped code used with no board, two
paragraphs down) across three waves to buy nothing. Pinned by two tests on a synthetic
`requireBoardPermission` procedure whose resolver runs the defence
(`require-permission.test.ts`'s `editAgendaWithMismatchDefence`), both verified by mutation: deleting
the `next({ctx: {… authorizedBoardId}})` block turns them red with the wiring-bug `Error`, not with a
refusal. Two type-level checks close the same mistakes `requireActor` closes for
its own shape, plus one it does not need: a boolean predicate (`requireActor`'s own hole, reproduced
here because the parameter shape is identical) AND an actor-only rule like `assertCanUpdateTown` —
NEW to this shape, because a one-parameter function IS structurally assignable to a two-parameter type
(a function that ignores its second argument can be called with one), so without the arity check
`requireBoardActor(assertCanUpdateTown)` would compile, extract a board, refuse if none is supplied,
and then silently drop it. Verified as real compile errors: four `@ts-expect-error` pins in
`packages/api/src/trpc/__tests__/require-board-actor-type.test.ts`.

**One property `requireBoardPermission` has that `requireBoardActor` CANNOT preserve: import-time
refusal for a board-scoped code used with no board.** `requirePermission` throws while the router
module loads if handed one of the 18 `BOARD_SCOPED_CODES` with no `board` option — there is no single
`PermissionCode` to check against that set here, because the whole point of this shape is a rule that
is not keyed to one code. The arity check is the PARTIAL substitute: it catches "this rule takes no
board at all," which is the realistic mistake at this shape's call sites, but not "this rule is
board-scoped but was wired to `requireActor` instead" — a different mistake, and one the safety net
above never covered for the `requirePermission` form either. ~~Nothing stops writing
`requireActor(someBoardScopedRule)` today; TypeScript sees a valid one-argument call and there is no
`BOARD_SCOPED_CODES`-style set of RULE FUNCTIONS to check against. Recorded as a real, currently open
gap rather than implied closed by analogy with the code form.~~ — **overstated; TypeScript already
closes this half, and the whole-branch fix round probed it rather than reasoning about it.** A
function that requires TWO arguments is not assignable to a one-argument parameter type (the arity
rule runs the opposite way from the familiar "fewer parameters is fine" direction), so
`requireActor(assertCanUpdateMeeting)` is a compile error:

```
src/trpc/__probe.ts(3,54): error TS2345: Argument of type '(actor: Actor, scope: BoardScope) => void'
  is not assignable to parameter of type '(actor: Actor) => void'.
  Target signature provides too few arguments. Expected 2 or more, but got 1.
```

Every `BoardScope` rule takes a REQUIRED second parameter (`scope: BoardScope`; none is optional —
same grep as above, re-checked when wave 4 Task 2 added the nineteenth and again when wave 5 Task 2
added ten more — all ten take a required `scope: BoardScope`), so the mistake is not expressible without an explicit cast, which is the
already-documented "parked, not closed" structural-typing hole above rather than a second one. What
genuinely remains open is only the narrower claim: there is no `BOARD_SCOPED_CODES`-style set of RULE
FUNCTIONS, so if a future rule were ever given an OPTIONAL scope parameter, `requireActor` would
start accepting it silently. Check that when adding a rule, not before — a wave-4 author should not
spend a round closing a gap the compiler already holds shut.

**The mismatch defence is mechanical, not prose, and it is the DEFAULT for a row-targeted board-scoped
write — not `cancel`'s special case.** A board-scoped UPDATE whose target is named by a DIFFERENT id
than the board itself reopens the `.transform()` hazard this item already warns about ("do not
`.transform()` a value a guard authorizes on") by a new route: not a schema transform changing one
field, but the write's true subject being a different id than the one the guard checked. `cancel`'s
input is `{meetingId, boardId}`; the guard authorizes the CLIENT-CLAIMED `boardId`, but the row the
resolver actually writes is selected by `meetingId` — a value the guard never inspects. `meeting`'s
own RLS (`meeting_tenant_isolation`) is tenancy-only, no board predicate, so any town member can
already see any meeting's true board via `detail`/`byTown`; nothing stops a caller who holds A1 on
their OWN board from naming a DIFFERENT board's meeting and claiming their own board for it.
`requireBoardActor` cannot close this itself — it authorizes before `.input()` even parses, with no
`TenantTx` to look the row up. Instead it carries the board it authorized forward on the request
context (`ctx.authorizedBoardId`), and the resolver calls `assertMatchesAuthorizedBoard(ctx,
<the row's real board, read fresh from the database>)` before writing — a GREPPABLE, separate
function rather than inline prose, so "did this procedure re-check the row's true board" is
answerable by `grep -rn "assertMatchesAuthorizedBoard("` instead of something a reviewer has to
reconstruct. `insert` does not need this (the board id it authorizes on IS the board id it writes, by
construction) — which is exactly why this did not surface in Task 1's `insert` procedure, or in
`board-scope.test.ts`'s four synthetic procedures, or in `require-permission.test.ts`'s
`editAgenda`/`scheduleMeeting` — none of them target a row by an id OTHER than the board id. **Waves
4–6 must check each table's own RLS rather than assume `meeting`'s tenancy-only finding carries
over:** `agenda_item`, `motion`, `vote_record`, `meeting_attendance`, `minutes_document`,
`minutes_section` and `exhibit` are all board-scoped writes targeted by a row id, not the board id —
the shape this hazard needs, not a shape unique to `cancel`.

**What survives once the board is behind a JOIN, and what does not (wave 4, Task 1).** Everything
above was written from `meeting`, where `board_id` is a column on the row being written, and one
sentence of it was load-bearingly narrow: "read fresh from the database" was fine, "the row's real
board" was not. `agenda_item` has **no `board_id` column at all** — its board is
`SELECT m.board_id FROM agenda_item ai JOIN meeting m ON m.id = ai.meeting_id WHERE ai.id = $1`, and
`exhibit` is one join further out. What survives is the whole mechanism: the guard authorizes a
client-claimed board before `.input()`, the resolver re-derives the real one inside the same
`ctx.withTenant` transaction as the write, and `assertMatchesAuthorizedBoard` compares the two. What
does not survive is the assumption that the second value is a COLUMN READ. The helper's signature
needed no change (a `string` is a `string`) and its doc comment did — it now states the actual
requirement, which is about provenance, not shape: **the value passed must have been read from the
database inside the same tenant transaction as the write, never taken from client input**. Two
consequences a wave-5/6 author should not have to rediscover:

- **A derivation that returns no row is `NOT_FOUND`, and it must run before the mismatch check, not
  after.** With the board on the row, "the row is missing" and "the board does not match" were two
  outcomes of one `SELECT`. With a join they are still one `SELECT`, but a missing `agenda_item` and
  a missing `meeting` are now distinguishable states that must both answer `NOT_FOUND` — an INNER
  JOIN gets this right by construction and a LEFT JOIN does not.
- **A write touching MANY rows has a board SET, not a board — and its existence check is a COUNT,
  not a null check.** `agendaItem.reorder` takes a list of item ids; one re-authorization of "the"
  board is not enough, because the ids can span meetings and therefore boards. **It does NOT derive
  the board set with `SELECT DISTINCT board_id`** — that form discards the per-id rows the existence
  check below needs to count. The shipped query, quoted verbatim from `agenda-item.ts`'s
  `assertItemsOnAuthorizedBoard`, returns one row per id:

  ```sql
  SELECT ai.id, ai.meeting_id, m.board_id
  FROM agenda_item ai
  JOIN meeting m ON m.id = ai.meeting_id
  WHERE ai.id IN (${idList})
  ```

  The existence check compares the ROW COUNT to the id count —
  `if (rows.length !== itemIds.length) throw new TRPCError({ code: "NOT_FOUND" })` — and it runs
  BEFORE the distinct board set is ever computed (`new Set(rows.map((r) => r.board_id))`), which is
  then passed to `assertMatchesAuthorizedBoard` once per distinct board, so a list mixing the
  authorized board with any other is refused even though one of the two would have passed a single
  check. **This is the many-row form of the bullet above, and the failure shape is different: the
  single-row case fails by returning NO row; the many-row case fails by returning FEWER rows than
  ids requested.** A `SELECT DISTINCT board_id` cannot detect that — it never carries the per-id
  rows to count against the request, so a copier who reaches for the distinct-set form gets the
  authorization loop with no existence check at all, silently. Pinned by a test that mixes ids from
  two meetings on two boards (`agenda-item.test.ts`). `motion`, `vote_record`, `minutes_section` and
  `meeting_attendance` all have bulk-write shapes ahead of them: copy the per-id query and the
  row-count check together, not a distinct-board query alone — the count check is what closes the
  FK-bypasses-RLS hazard for the many-row case, exactly as the `NOT_FOUND` check does for the
  single-row case above.

**Four of the seven are now checked; three are not.** Wave 3, Task 3 built the read-only routers over
`agenda_item`, `meeting_attendance` and `minutes_document`, and its fix round confirmed all three
against `0000_baseline.sql` directly (`agenda_item_tenant_isolation`,
`meeting_attendance_tenant_isolation`, `minutes_document_tenant_isolation`): each is a plain
`FOR ALL USING (town_id = get_current_town_id()) WITH CHECK (…)` — **no role predicate and no board
predicate**, identical to `meeting_tenant_isolation`. So the mismatch defence IS load-bearing for all
three the moment a wave adds a row-targeted board-scoped WRITE to any of them: any town member can
already see any of those rows and therefore learn their true board. The finding lives in each
router's own header too, but it belongs here as well, since this paragraph is where a wave-4/5/6
author is sent to look. ~~**`motion`, `vote_record`, `minutes_section` and `exhibit` remain
unchecked**~~ — **`exhibit` was checked in wave 4, Task 2 and is the same shape**:

```
$ grep -n "exhibit_tenant_isolation" -A 3 packages/api/drizzle/0000_baseline.sql
CREATE POLICY exhibit_tenant_isolation ON public.exhibit
  FOR ALL
  USING (town_id = get_current_town_id())
  WITH CHECK (town_id = get_current_town_id());
```

No board predicate, no role predicate — so the mismatch defence is load-bearing for `exhibit.link`,
two joins out. ~~**`motion`, `vote_record` and `minutes_section` remain unchecked**~~ — **all three
checked in wave 5, Task 2 while ruling the tables that wave writes; all seven are now confirmed
tenancy-only**, so the mismatch defence is load-bearing for every one of them:

```
$ grep -nE "CREATE POLICY (motion|vote_record|minutes_section)_tenant_isolation" -A 3 \
    packages/api/drizzle/0000_baseline.sql
4069:CREATE POLICY minutes_section_tenant_isolation ON public.minutes_section
4070-  FOR ALL
4071-  USING (town_id = get_current_town_id())
4072-  WITH CHECK (town_id = get_current_town_id());
--
4074:CREATE POLICY motion_tenant_isolation ON public.motion
4075-  FOR ALL
4076-  USING (town_id = get_current_town_id())
4077-  WITH CHECK (town_id = get_current_town_id());
--
4136:CREATE POLICY vote_record_tenant_isolation ON public.vote_record
4137-  FOR ALL
4138-  USING (town_id = get_current_town_id())
4139-  WITH CHECK (town_id = get_current_town_id());
```

The same task checked the four tables item 2's list never named — `executive_session`,
`guest_speaker`, `agenda_item_transition`, `future_item_queue` — and found the identical shape. That
is eleven for eleven; the caution "the other four turned out tenancy-only is not evidence about
these three" was the right discipline and the answer came out the same every time.

**Wave 4, Task 2 — the fourth guard shape's second call site, and two things it found.**
`exhibit.link` is `.use(requireBoardActor(assertCanInsertExhibit))`, the first use of that shape on a
rule whose second branch is a ROLE rather than a second code.

**What the shape got right:** everything the mechanism promises. The guard runs before `.input()`
(FORBIDDEN before BAD_REQUEST, pinned and verified by moving the `.use()` — exactly one test goes red,
as `expected 'BAD_REQUEST' to be 'FORBIDDEN'`); the arity and return-type checks accept this rule and
would reject an actor-only one; `ctx.authorizedBoardId` is set, so `assertMatchesAuthorizedBoard`
works two joins out with no change to the helper at all.

**What no guard of this shape can fix, and a wave-5/6 author should not mistake for a bug in their own
wiring:** `isBoardMember(actor)` is `actor.role === "board_member"` — a TOWN-level fact with no board
in it. So for that branch the `BoardScope` the guard so carefully extracts, authorizes and re-checks is
**inert**: any board member of the town may attach material to ANY board's agenda item, and the
mismatch defence does not stop them, because the board they claim IS the item's real board. This is a
property of rule 15, not of `requireBoardActor`; the D1e upload endpoint
(`storage/documents.ts`'s `createExhibitFromUpload`) reaches the same rule with the same derived board
and answers identically, and has since Stage 1. Narrowing it to "a member of THIS board" needs a
`board_member` lookup, which makes the rule `async` and therefore resolver-side
(`assertCanInsertVoteRecord`'s shape, not this one) — a design decision, deliberately not made inside a
migration, and pinned as a PASSING test in `exhibit.test.ts` so that whoever makes it finds a failing
test rather than silence. **The general lesson: `requireBoardActor` guarantees that the board a rule is
asked about is the board the write is really about. It cannot guarantee that the rule looks at it.**

**Fix round 1 caught the identical hole sitting one function away, undocumented.** `assertCanInsertExhibit`
(rule 15, the write above) is not the only place `isBoardMember` appears board-blind: `canSelectExhibit`'s
`board_only` case (rule 14, the `case "board_only":` branch — **not cited by line number, per this
item's own rule; it drifted from `rules.ts:431` to `:544` to `:546` across this document's own
lifetime, which is the point**) is `isAdmin(actor) || resolvePermission(actor, "A3", row.boardId)
|| isBoardMember(actor)` — the same town-level fact in the same inert position. `exhibit.byMeeting` is the
first tRPC consumer of that branch, so it inherits the property unchanged: any board member of the town
reads any board's `board_only` exhibit titles, not just their own board's. Not a `requireBoardActor`
question at all — `byMeeting` is a plain `protectedProcedure`, filtering per-row after the fact — but the
same general lesson applies one level down: a per-row rule can be handed the row's real board and still not
look at it. Pinned as a PASSING cross-board test in `exhibit.test.ts`
("does NOT scope byMeeting's board_only tier to the member's own board"), mirroring the `link` pin above,
so narrowing either one later is a deliberate change and not a silent one.

**Wave 4, Task 3 — what wiring the two guards found, and it is not about the guards.** Task 3
called `meeting.publishAgenda`, `exhibit.link`, `exhibit.byMeeting` and all seven `agendaItem`
writes from the agenda builder. Both guard shapes worked exactly as this item describes, first try,
with no change to `trpc.ts` and no fix round on the API side. What the wiring found is a client-side
cost this item had not yet named, alongside the `boardId`-prop cost it already had:

**Closing a hole moves a refusal into a place the UI may be hiding.** Item 13's rule is that every
newly-guarded mutation surfaces its error, and this task wrote nine `onError` handlers to satisfy
it — but two of them rendered into a region the user could not see, and both tests caught it only
because they asserted on `role="alert"` rather than on the string. A Radix `AlertDialog` marks
everything outside itself `aria-hidden`, and a REFUSED destructive write leaves that dialog open
(the close lives in `onSuccess`). So an error rendered beside the form is invisible for exactly the
case it exists for, and the user is left with a Delete button that appears to do nothing — the
silent-refusal shape all over again, now one layer down. **Render a refusal INSIDE the confirmation
dialog that triggered it** (`InlineItemForm.tsx` and `AgendaSection.tsx` both do, each with the
outer branch suppressed while the dialog is open). Every wave 5/6 write behind a confirmation
dialog inherits this.

**Where the same write is reachable both WITH and WITHOUT a confirmation dialog, pin both paths,
not one.** Task 3's fix round found the gap the paragraph above leaves open:
`AgendaSection.tsx`'s delete runs `itemCount > 0 ? setConfirmDelete(true) : handleDeleteSection()`
— a precondition (an `itemCount`/`count`-style branch) that skips the dialog entirely when the
section is already empty. That makes ONE write have TWO runtime paths to its refusal — one that
never opens the dialog described above, one that does — and a single refusal test written against
whichever path happens to be convenient will pass while the OTHER path's `role="alert"` sits
unpinned, because the same `error` state renders into two different JSX locations depending on a
variable (`confirmDelete`) that has nothing to do with which mutation is in flight. The raw
evidence: before the fix, `AgendaSection.tsx` had two `role="alert"` sites and its test file had
two `findByRole("alert")` assertions — 2-and-2, matching — because both tests exercised the SAME
(outer) site; the in-dialog site was unpinned the whole time and a raw site-count-vs-assertion-count
check would not have caught it. **Any destructive write with an `itemCount`/`count`-style branch
that skips the confirmation dialog needs two refusal tests, not one: one with the precondition set
so the dialog is skipped, one with the precondition set so it opens** — named as distinctly as
`AgendaSection.test.tsx`'s "shows a refusal when the delete is FORBIDDEN" (empty section, no
dialog) and "shows a refusal INSIDE the confirmation dialog when a non-empty section's delete is
FORBIDDEN" (non-empty section, dialog opened) now are, so a reviewer checking refusal coverage
reads two rows for that one write instead of inferring reachability from the component's own
source.

**Mechanisation for the rule above: a documented procedure, not a gate — measured, not assumed.**
V8 branch coverage (already configured in `packages/web/vitest.config.ts`, never run with
thresholds) DOES catch this specific bug mechanically: reverting `AgendaSection.test.tsx` to its
pre-fix-round-1 state and running, **from `packages/web`** (the command resolves `@/test/render`
etc. through that package's own `vitest.config.ts` `resolve.alias`; run verbatim from the repo root
instead and it fails outright — `Test Files 1 failed | Tests no tests`, an `@/test/render`
alias-resolution error, no coverage report at all — reproduced during the wave 4 fix round that
added this parenthetical):

```
cd packages/web
npx vitest run --coverage --coverage.include='src/components/meetings/AgendaSection.tsx' \
  --coverage.reporter=lcov --coverage.reporter=text \
  src/components/meetings/__tests__/AgendaSection.test.tsx
```

produces `BRDA:178,6,1,0` in `coverage/lcov.info` — the in-dialog `error &&` branch's truthy side,
taken zero times, naming the exact unpinned line — while the outer branch at line 202 shows
nonzero on every arm. That is a real, reproducible signal, not a guess. Whether it should become a
STANDING gate was measured rather than assumed: scoping coverage to just the five files this task
and its fix round touched (`AgendaSection.tsx`, `InlineItemForm.tsx`, `ExhibitRow.tsx`,
`ExhibitUploader.tsx`, `PublishAgendaDialog.tsx`) — all five fully reviewed, all five gates green —
still produces **60 zero-hit branches**, the overwhelming majority of them ordinary untested UI
paths (loading spinners, `isPending` states, pluralization ternaries) with no relationship to
refusal reachability. A bare "no zero-hit branches" gate on even this small, hand-picked,
already-correct file set would fail on its first run for 59 unrelated reasons before it ever
reached the one that matters — the "noisy mechanism erodes trust" failure this document already
warns about elsewhere. Narrowing it to just the branches that matter means hand-curating a manifest
of specific `file:line:branch` triples — unlike `cache-key-parity`'s `MIGRATED` map or
`pathfilter-pin-coverage`'s grep, which key off TEXT that survives reformatting, a line-number-keyed
manifest breaks on the next unrelated edit to the same file and needs re-curation on a cadence no
author will remember to run. **A repo-wide branch-coverage threshold is worse still** — this
suite's own numbers make the case: `routes/home.tsx` sits at 24% branch coverage and
`routes/meetings.$meetingId.review.tsx` at 17%, against files in the 80s and 90s elsewhere; a
single threshold either sits low enough to catch nothing or high enough to fail immediately on
unrelated, pre-existing gaps.

**What lands instead: the exact command above, run from `packages/web`, for a wave 5/6 author to
run on the files they touched, in the task's own verification step — not a CI gate.** Scope
`--coverage.include` to the
component(s) a task's destructive writes live in, run only that component's own test file, and
read the `% Branch` column plus — if it is not 100 and the reason is not obvious — the
`coverage/lcov.info` `BRDA` lines for the specific refusal conditional; a `0` in the second-to-last
field names the untaken branch by line number directly. This costs one extra flag on a command
already being run and reads output the author already knows how to interpret, without the
manifest-maintenance or repo-wide-noise costs above.

**Caveat, found in wave 6 Task 4's fix round, and it is scoped rather than general: branch coverage
only names a refusal unpinned when the conditional sits behind a MOUNT GUARD.** The worked example
above (`AgendaSection.tsx:167`, `{confirmDelete && (<AlertDialog …>`) is a mount guard — the whole
dialog, refusal included, is absent from the tree until `confirmDelete` is true — so `BRDA:178,6,1,0`
correctly named it unpinned. `routes/meetings.$meetingId.review.tsx`'s two minutes-generation dialogs
are NOT mount-guarded: both `<Dialog open={...}>` components are always in the tree, and Radix
suppresses the closed one's rendering downstream (`display: none` under the hood), which React does
not treat as "unevaluated" — a closed dialog's children, including a `{generateError && <p
role="alert">…}` inside it, are evaluated on every render regardless of `open`. Measured directly:
against this screen's un-mounted-guard code plus the pre-fix test file (`75affd1`, 34 tests, no test
that ever exercises the regenerate dialog's error state), `--coverage.include` on the file reports
`BRDA:1119,104,0,102` `BRDA:1119,104,1,1` — the truthy (refusal) arm reads HIT once, with nothing
ever rendered to a user, because the dialog mounts (with `generateError` null) whenever a nearby test
opens it. Wrapping that same dialog in a mount guard (`{regenerateDialogOpen && (<Dialog …>`) and
re-running one isolated, unrelated test (`-t "renders the meeting header…"`, which never opens the
regenerate dialog at all) reports `BRDA:1120,105,0,0` `BRDA:1120,105,1,0` for the same conditional —
both arms genuinely zero, because the guard keeps the dialog out of the tree entirely when it is
closed. Same conditional, same missing test coverage; the mount guard is what makes the branch
report the truth. **What to do instead when a refusal conditional sits inside an always-mounted
`<Dialog open={...}>` (or anything else hidden only downstream — `hidden`, `aria-hidden`, CSS,
Radix's own portal suppression): do not trust a nonzero hit count on that branch as proof the refusal
was reached. Reason about reachability directly — is there a test that actually opens/reveals this
specific container and asserts on `role="alert"` (or whatever the refusal renders) from inside it —
and write that test if it does not exist, independent of what the branch counter says.** This matters
because item 2's coverage procedure was adopted in wave 4 specifically to catch unpinned refusal
branches, over a CI gate; a false positive on exactly the case it was chosen for is worse than the
procedure not existing, since it reads as confirmation rather than as silence.

**A shared error `useState` rendered into more than one dialog is a defect shape in itself, not
just a coverage gap.** Two confirmed instances, both wave 6 Task 3/4, both the identical shape:
`meetings.$meetingId.minutes.tsx`'s `actionError` fed four render sites (the outer paragraph plus
the submit/publish/return dialogs) and `meetings.$meetingId.review.tsx`'s `generateError` fed two
(the generate and regenerate dialogs). In both, the state was cleared only by each dialog's own
Cancel button — never by opening a DIFFERENT dialog, and never by Radix's own close paths (Escape,
an outside click) on the SAME one. A refusal from one write survives to be shown, accurately
worded, inside a different action's dialog — worse than useless, because it reads as a refusal of
the action the user is currently attempting. `minutes.tsx` was fixed first (fix round 1, fresh
`onOpenChange` handlers that clear the shared error whenever a dialog OPENS, wired to both the
trigger buttons and each `Dialog`/`AlertDialog`'s own `onOpenChange`); `review.tsx` had the
identical shape, unnoticed by an implementer and a reviewer who had both just read that fix,
until a coverage dispute forced a second look at the surrounding lines (task-4 fix round 2). Fixed
the same way there. **Neither instance was split into per-dialog state** — clearing on open is
still required per dialog even with separate variables (reopening the SAME dialog after a failed
attempt must not show the stale message either), and once that clear is in place a shared error
can no longer leak across dialogs, so a second variable would add nothing a case depends on.
**Check for this shape whenever a screen has more than one dialog and one `useState` error feeds
more than one `role="alert"` site** — grep the file for `useState<string | null>` (or similar)
names ending in `Error`, then count how many `role="alert"` blocks read that same name. **Not
proposed as a mechanical gate**: the two known instances are both files this document already
names as reviewed line by line, so the population it would run against is small, and a grep for
"one error name feeding N alert blocks" would also flag the ordinary, correct case of one error
rendered at one site read by two tests (no leak at all) — false-positive rate not measured because
no third instance has yet turned up to justify building it; if one does, measure the grep's hit
rate against every dialog-bearing screen in the phase before treating it as a gate, the same way
the branch-coverage-threshold idea above was measured and rejected rather than assumed.

**Where a table has TWO creation paths, reconcile the authorization, not the transport.** `exhibit` is
the first table in this phase reached by both a tRPC procedure and a Stage-1 Fastify route, and the
answer was NOT to move one into the other. The file-upload path stays at `POST /api/files/exhibits`
(multipart, byte sniffing, a 5 MB ceiling, `withWrittenFile` wrapping the insert — none of which a JSON
procedure can carry), and the DELETE stays at `DELETE /api/files/exhibits/:exhibitId` (it removes the
bytes after the transaction commits, which a tRPC resolver cannot do). What is shared is the RULE, the
BOARD DERIVATION and the visibility vocabulary. The cost of the tRPC half is worth naming because it is
invisible until the two sit side by side: the Fastify route checks resolver-side, after deriving the
board, so it never trusts a claimed board and has NO mismatch hazard; the tRPC procedure must authorize
before `.input()`, so it inherits a client-supplied `boardId` whose only job is feeding the guard, and
then has to pay for it with the mismatch defence. That is this item's already-stated cost, met in the
wild.

**The cost, stated rather than left to be discovered:** the board id `requireBoardActor` needs is not
needed by the WRITE itself for a row-targeted procedure — it exists purely so a guard declared before
`.input()` has something to authorize on. Every such write inherits a client-supplied field whose only
job is feeding the guard, and the client-side plumbing to supply it was a real cost, paid rather than
merely predicted: ~~the client-side plumbing to supply it — `CancelMeetingDialog.tsx` will need a
`boardId` prop it does not have today (see that component's own `TODO(phase-e-wave-3)` marker).~~
**True only when this paragraph was written, in wave 3, Task 1. Closed in wave 3, Task 2 (`c34b987`)**,
which added the required `boardId` prop — threaded from the component's only caller,
`boards.$boardId.meetings.tsx` — and discharged the marker; see item 11's re-run above ("11 # at
`c34b987` — Task 2 closed `CancelMeetingDialog.tsx`'s ... raw-write authorization holes"). At HEAD,
`CancelMeetingDialog.tsx` has carried a required `boardId` prop since that commit and no
`TODO(phase-e-wave-*)` marker remains in the file — verified directly (`grep -n "boardId"` and
`grep -n "TODO(phase-e-wave"` against the file, both re-run at wave 5, Task 0's fix round). This
paragraph itself kept describing the pre-`c34b987` state as current fact for two further waves and
three prior close-outs, even though this same document's item 11 re-run and item 2's own "Wave 5,
Task 0" carry-over section both already narrate the fix correctly elsewhere — found by a reviewer
reading this item's prose paragraph-by-paragraph rather than by its Known-gaps bullets; see item 14's
close-out below for why the standing sweep had been missing exactly this shape. Worth it for
FORBIDDEN-before-BAD_REQUEST (item 13's rule) — a cost that was, in fact, paid, not merely documented
and then left unpaid.

**A separate finding, orthogonal to authorization but found by exactly the same "verify by mutation"
discipline item 13 requires, and now closed STRUCTURALLY rather than by a convention to remember:
resolving `ctx.actor()` for the first time INSIDE a procedure's own `ctx.withTenant` callback
self-deadlocks under a single-connection pool.** `ctx.actor()` is memoised per request
(`context.ts`), but an UNresolved call runs its own internal `withTenant` — a second, nested
transaction on the same pooled connection while the first is still open. This was found on an EARLIER
version of `cancel`'s resolver, which called `assertCanUpdateMeeting(await ctx.actor(), {...})`
resolver-side for its own re-check (before the mismatch defence above became a pure board-id
comparison, which needs no actor at all): deleting the guard to run item 13's required deletion-pin
mutation removed the ONLY thing that had been warming `ctx.actor()`'s memo before the transaction
opened, and every `meeting.cancel` test hung at vitest's 30s per-test timeout instead of failing —
reproducing it also leaked scratch databases, because vitest force-kills a timed-out test and
`withTestDb`'s own teardown `finally` never got to run. **Fixed in `context.ts`, not in `meeting.ts`:**
`bindTenantAccess` (the one place both `createTrpcContext`, production, and `fixtures.ts`'s
`contextFor`, every router test, build their `withTenant`/`actor()` pair) now tracks a per-request
in-transaction flag and refuses a reentrant call — of EITHER `ctx.withTenant` or `ctx.actor()` — with a
named, immediate error instead of a hang. Verified directly, not by absence of a hang:
`packages/api/src/trpc/__tests__/context.test.ts` reproduces the exact reentrant call and asserts it
throws in under a second, alongside a positive control proving sequential (non-nested) use of both
still works. ~~**Any future procedure that re-checks something inside its own transaction and reaches
for `ctx.actor()` there for the first time now gets a loud, immediate, named error instead of a
hang**~~ — **that sentence described the guard's INTENT, not its code, and the gap between the two
was a blocking finding in the whole-branch review. NARROWED; read the paragraph below instead.**

**The guard fired on a warm memo, and this item said it did not.** As shipped, the check was
`if (inTransaction)` — it never consulted `actorPromise`, so `ctx.actor()` threw inside
`ctx.withTenant` even when the memo was already RESOLVED and no second transaction would open.
Reproduced by the reviewer: warm the memo, call inside the transaction, get
`Error: ctx.actor() called for the first time from INSIDE a ctx.withTenant() transaction` — and it
was not the first time. **This compounds rather than sits still**, which is why it blocks wave 4
rather than being logged: every guarded procedure reaches its resolver with a WARM memo, because
`requireActor`, `requirePermission`, `requireBoardPermission` and `requireBoardActor` all
`await ctx.actor()` in middleware; and this item's own "row-level rules stay in the resolver by
necessity" paragraph directs waves 4, 5 and 6 to write exactly
`assertCanUpdateAgendaItem(await ctx.actor(), { boardId: row.board_id })` inside the transaction that
read the row. A wave-4 author writing the documented shape would have got a plain `Error` →
`INTERNAL_SERVER_ERROR` carrying a message that names the wrong cause. `meeting.ts` escaped only
because `assertMatchesAuthorizedBoard` compares two strings and needs no actor at all; that escape
does not generalise to a single other table.

**Fixed by narrowing the guard, not by narrowing the documentation** — the documented resolver-side
shape has to work, because three waves are told to use it. The condition is now
`inTransaction && !actorSettled`. `actorPromise !== undefined` refuses less than the invariant
warrants, so `!actorSettled` is chosen as the conservative reading — a defined-but-PENDING memo is
one refactor away from unsafe. But do not repeat the stronger claim this paragraph used to make:
narrowing to `actorPromise !== undefined` does **not** reopen the deadlock, because a second call on
a pending memo returns the SAME promise and opens no second transaction. Measured — that narrowing
runs the api suite green in normal time, failing only the state-3 pin. "Settled" cannot be read
synchronously off a raw promise, so `bindTenantAccess`
tracks it with a flag set from the memo's own settlement handlers (both branches — a REJECTED load
opens no second transaction either). All three states are pinned separately in `context.test.ts`, and
the middle one was verified by mutation the way item 13 requires — reverting the condition to
`inTransaction` alone turns "ALLOWS a ctx.actor() call from inside a ctx.withTenant() callback once
the memo is already SETTLED" red, and leaves the other two green:

| state                            | inside a transaction | behaviour                                     |
| -------------------------------- | -------------------- | --------------------------------------------- |
| cold memo (never called)         | yes                  | throws — the original hazard, preserved       |
| settled memo (middleware warmed) | yes                  | **succeeds** — the false positive, closed     |
| defined but still pending        | yes                  | throws — a conservative refusal, not a hazard |

**State 3's reachability, since a test that cannot fail is worth less than the sentence that says
so:** `inTransaction` is a single flag, so a pending actor load and a separately-open `ctx.withTenant`
cannot coexist — the `withTenant` half of the guard refuses the second one first. The only reachable
form of "in a transaction with an unsettled memo" is therefore a re-entry into the actor's OWN load
window (call `ctx.actor()`, do not await it, call it again), which is what that test constructs. It
is reachable, so the test stays; it is narrow, and saying which narrow shape it is beats leaving a
reader to assume it covers more.

**RESCOPED in wave 5, Task 7's fix round, and this time the SCOPE was wrong rather than the
condition.** Everything above is about WHEN the guard should fire. The flag it fired on was
per-REQUEST, and a request is not the unit the hazard lives in. `httpBatchLink` — the client's
default transport — puts N procedure calls on ONE HTTP request; tRPC builds ONE context for it and
resolves the calls CONCURRENTLY. So the first call to reach `ctx.withTenant` set the flag and every
sibling on the batch was refused. The live meeting screen's five-query loader got one result and
four reentrancy errors, a `207 Multi-Status`, and rendered blank. Present since Stage 1, Task D1;
invisible to 1725 green tests because every router test drives ONE procedure through `createCaller`
and the web suite stubs the transport (item 8), so nothing anywhere built a batch.

The hazard is NESTING — `withTenant` called from inside another `withTenant`'s own callback — and
nesting is a property of a call's DYNAMIC EXTENT, not of the request it arrived on. Two CONCURRENT
transactions take two pooled connections and cannot deadlock each other; on the single-connection
test pool they simply QUEUE. `bindTenantAccess` now holds its marker in an `AsyncLocalStorage`
established around `rawWithTenant`, so it is visible to everything that call awaits and to nothing
else. Two consequences worth carrying into wave 6:

- **State 3 above changed shape.** While the marker was per-request, a pending actor load left the
  flag set for the whole request, so the only reachable third state was a bare second `actor()` call
  in the load's own window — refused, even though it returns the same promise and opens no second
  transaction. That bare re-entry is now allowed, correctly. The state that still threatens a
  connection, and that the test now constructs, is a pending load reached from inside a SEPARATE,
  open `withTenant` of the same context.
- **A per-request unit of state is a design decision, not a default.** Anything `bindTenantAccess`
  or a future context helper holds is shared by every procedure the client chose to batch together.
  Ask of each one whether it is per REQUEST or per CALL before writing it, because the tests in this
  repository cannot tell you: `trpc/__tests__/http-batch.test.ts` is the only one that builds a
  batch at all.

**The example files a reader lands on now match this item's own rule.** `board-scope.test.ts`'s
four board-scoped procedures and `require-permission.test.ts`'s `editAgenda`/`scheduleMeeting` used
to declare `.input().use(guard)` — the preemptable order — because they predate this item's
rewrite and nothing about what THEY test (board-override resolution) depends on declaration order.
They were reordered in the same fix round that added the reorder pin above, specifically because an
author who greps this codebase for a working example and copies the first board-scoped procedure
they find should not land on the wrong order by accident.

**If the action is one of the 18 board-scoped codes, the guard takes a `BoardScope` and the
procedure must resolve the board.** The set is derived, not hand-written —
`BOARD_SCOPED_CODES` in `packages/api/src/trpc/trpc.ts` computes it from the two shipped
`designated_boards` permission templates, and today resolves to `A1 A2 A3 A5 A6 M1–M7 R1–R6`.
Passing no board is **not** fail-closed: an override that grants is ignored (a board-specific
clerk is wrongly refused) and one that revokes is ignored too (a barred clerk is wrongly
**allowed**). Use `requireBoardPermission(code, boardIdFrom())`; `requirePermission` throws at
module import time if you hand it a board-scoped code with no board, so the mistake never reaches
a request.

**Wave 4, Task 5 — close-out: what the board-mismatch mechanism got right across the whole wave,
what the rule-14/15 finding turned into, and what waves 5 and 6 need that the paragraphs above do
not yet say.**

**What survived, unchanged, across every table this wave touched.** The mechanism above was
designed against `meeting`, where the board is a column, and every subsequent table this wave
reached (`agenda_item`, `exhibit`, two joins out) needed zero changes to `assertMatchesAuthorizedBoard`
itself — only to what gets read before calling it. That is the property worth naming at close-out:
`requireBoardActor`/`requireBoardPermission` authorizing a CLAIMED board pre-`.input()`, and a
resolver-side re-derivation of the REAL board from inside the same `ctx.withTenant` transaction, is
a mechanism about PROVENANCE (read fresh, inside the write's own transaction, never from client
input), not about SHAPE (a column vs. a join vs. a join of a join). Five of the seven tables item 2
names now have that RLS finding checked against `0000_baseline.sql` directly — `meeting`,
`agenda_item`, `meeting_attendance`, `minutes_document`, and `exhibit` as of this wave — all five
tenancy-only, no board predicate, no role predicate, so the mismatch defence is load-bearing for
all five the moment a row-targeted board-scoped WRITE touches them. ~~`motion`, `vote_record` and
`minutes_section` remain the only three of the original seven still unchecked.~~ — **checked in
wave 5, Task 2; all seven are tenancy-only. See the grep in the Task 2 paragraph above.**

**What finding 3 (rule 14/15's board-blind `isBoardMember` branch) changed: nothing in the
mechanism, and one thing in how this document records a decision.** The finding itself is not a
flaw in `requireBoardActor` — the guard did exactly what it promises, authorizing the real board
correctly two joins out; the rule it guards simply has a branch that does not consult the board it
was handed. The general lesson recorded in the Task 2 section above ("`requireBoardActor` guarantees
that the board a rule is asked about is the board the write is really about. It cannot guarantee
that the rule looks at it.") stands as written. What this close-out changed is procedural: the
owner's decision on it (leave rule 14's town-wide `board_only` visibility as-is, 2026-09-10) had
been reached but never landed in this document — it lived only in the plan's own progress ledger,
which is exactly the kind of loss item 14 exists to catch when a decision is made outside a task's
own diff. See the "Known gaps" bullet on this ("Wave 4, Task 2's own open items", finding 3) for
the recorded decision itself; it is stated once there rather than duplicated here.

**What waves 5 and 6 need that this item does not yet say.** Wave 5's own plan
(`docs/superpowers/plans/2026-09-10-phase-e-wave-5-live-and-sse.md`) names nine tables it writes to
— `motion`, `vote_record`, `meeting_attendance`, `executive_session`, `guest_speaker`,
`agenda_item_transition`, `future_item_queue`, `meeting`, `agenda_item` — and reports all nine as
`FOR ALL USING (town_id = get_current_town_id())`, tenancy-only, verified against
`0000_baseline.sql` directly, the identical shape this item has been finding table after table.
Two things worth stating here rather than leaving a wave-5/6 author to re-derive them from that
plan alone:

- **The join is uniform across eight of the nine, and it is one hop, not two — but not all nine,
  and wave 5's own plan overstates this by one table.** `motion`, `vote_record`,
  `meeting_attendance`, `executive_session`, `guest_speaker` and `agenda_item_transition` each
  carry a `meeting_id uuid NOT NULL` column and no `board_id` column at all (verified directly
  against `0000_baseline.sql`'s `CREATE TABLE` statements, not taken on the plan's word), so the
  board is `meeting.board_id`, one join — a SIMPLER shape than `exhibit`'s two-join derivation this
  wave solved; reuse `agenda-item.ts`'s `assertMeetingOnAuthorizedBoard`-style per-row derivation
  directly rather than re-deriving a two-join query for a one-join table. **`future_item_queue` is
  the exception, checked the same way and found different: it carries `board_id uuid NOT NULL`
  directly, and its `source_meeting_id` column is NULLABLE** (a queued item can exist with no
  meeting behind it, e.g. one dismissed and re-queued). So `future_item_queue` needs NO join at
  all — the board-mismatch defence there is the `meeting`-shaped case (compare a column, not a
  join result), simpler than the other eight, not the same as them. Wave 5's own plan states "every
  table this wave writes" derives its board via `meeting_id` — true for eight, not for this one;
  worth catching here since a copier who trusts that sentence for `future_item_queue` specifically
  would write a join the schema does not need and does not support (there is no `meeting_id` column
  on this table to join from when `source_meeting_id` is null).
- **`assertCanInsertVoteRecord` needs a FIFTH guard shape this item has not yet named.** It is
  `(actor: Actor, tx: TenantTx, subject: VoteRecordSubject) => Promise<void>` — `async`, and it
  takes a `TenantTx` as its SECOND argument (corrected earlier in this item, in the "Corrected in
  the whole-branch fix round" paragraph above, after two places first said "a THIRD argument"). It
  cannot go behind `requireBoardPermission` OR `requireBoardActor` unchanged, for the same reason
  neither can express `assertCanUpdateUserAccount`'s subject-carrying shape: those two guards run
  BEFORE `.input()`, with no `TenantTx`, and this rule's self-vote branch (M8, a live `board_member`
  lookup for the caller's own active seat) genuinely needs one. It stays resolver-side, the same
  category as the row-level "these minutes are still a draft" rules above — not a gap in the guard
  catalogue, but a fifth shape this item's four-shape count (Actor-only, board-scoped-by-code,
  board-scoped-by-rule, subject-carrying) does not cover, because none of the first four rules that
  motivated them needed a `TenantTx` of their own. ~~Whichever wave wires it should record why it
  stays resolver-side next to the rule itself, the way `assertMatchesAuthorizedBoard`'s own doc
  comment does, rather than re-deriving the reasoning silently.~~ — **wired in wave 5, Task 3
  (`voteRecord.insert`), and recorded in `routers/vote-record.ts`'s header. It is not ONE guard:
  see "Wave 5, Task 3" below, finding 1 — resolver-side alone was not available, so the procedure
  carries a synchronous necessary condition in middleware AND the real rule in the resolver.**
- ~~**Two tables have no rule at all today**, per wave 5's own plan: `agenda_item_transition` and
  `future_item_queue`. Deciding what code authorizes them (or minting a new one) is a wave-5
  decision this item does not make for them — named here only so "no rule exists yet" is not
  mistaken for an oversight this item failed to flag.~~ — **the count was TWO in the plan and FOUR
  in the code; closed in wave 5, Task 2 for all four.** `executive_session` and `guest_speaker` had
  no rule either — the plan did not say so because both have an obvious code (M6
  `trigger_executive_session`, M7 `manage_speaker_queue`) and "a code exists" reads as "a rule
  exists" until someone greps: before `09f7e88` M6 and M7 had no rule and no guard anywhere, and
  occurred in `packages/api/src` in exactly one place — `require-permission.test.ts`'s
  `BOARD_SCOPED_CODES` roster, a test fixture, which is the same footprint A5 had before wave 4's
  Task 2 and the same reason a sweep reads past it: a code named only by a roster is named by
  nothing that runs. (`09f7e88`'s own commit message says the strings "did not occur anywhere in
  `packages/api`"; that overstates it and does not reproduce —
  `git grep -n -E "M6|M7" d796f29 -- packages/api` also finds the seed JSONB in `0000_baseline.sql`.
  Corrected here and in `rules.ts` rather than left standing.) Both
  bookkeeping tables took **M1** (`start_run_meeting`), the code of the action that causes them,
  rather than a new code of their own — the reasoning is stated next to each rule in `rules.ts`
  (21d, 21e) and summarised in "Wave 5, Task 2" below. A fifth gap the plan also did not name:
  `vote_record` had INSERT and UPDATE rules and no DELETE, while the pre-tRPC `VotePanel.tsx`'s raw
  `.delete().eq("motion_id", motionId)` re-vote did. **Correction, single fix wave after wave 5's
  review:** `VotePanel.tsx:207` is a stale citation — the file now calls `voteRecord.recordForMotion`
  (one transaction) and performs no raw delete at all; see the M3 paragraph below, corrected the
  same way.

**`future_item_queue`'s own board column, re-verified at wave 5 Task 0 rather than taken on the
plan's word.** The bullet above states it from wave 5's own plan; Task 0 checked it directly against
`packages/api/drizzle/0000_baseline.sql` and it holds exactly as stated:

```
$ grep -n "CREATE TABLE public.future_item_queue" -A 13 packages/api/drizzle/0000_baseline.sql
CREATE TABLE public.future_item_queue (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    board_id uuid NOT NULL,
    town_id uuid NOT NULL,
    source_meeting_id uuid,
    ...
```

`board_id uuid NOT NULL` is a direct column; `source_meeting_id` carries no `NOT NULL` at all. Its RLS
(`future_item_queue_tenant_isolation`) is the identical tenancy-only shape as the other eight —
`FOR ALL USING (town_id = get_current_town_id())`, no board predicate. So the mismatch defence for a
row-targeted write on this table is the `meeting`-shaped case (compare `board_id` directly, no join),
not the eight-table `meeting_id`-join shape — exactly as the paragraph above already said, and now
checked rather than trusted.

**Wave 5, Task 0 — four items wave 4 left as recorded decisions, checked against HEAD and closed or
re-recorded rather than carried forward silently a second wave.**

1. ~~The revoking-board-override proof covers 2 of 7 `agendaItem` writes.~~ — **checked against HEAD
   (`fb3a5cd`) and confirmed still true; re-recorded here rather than fixed, since closing it is a
   wave-6-sized cost this task's scope does not buy.** All seven writes (`insert`, `update`, `reorder`,
   `delete`, `instantiateFromTemplate`, `setOperatorNotes`, `markComplete`) carry the byte-identical
   guard, differing only in the `action` string passed to `requireBoardPermission("A2", boardIdFrom(),
{action})` — verified directly:
   ```
   $ grep -n 'requireBoardPermission("A2"' packages/api/src/trpc/routers/agenda-item.ts
   387:      requireBoardPermission("A2", boardIdFrom(), {
   449:      requireBoardPermission("A2", boardIdFrom(), {
   502:      requireBoardPermission("A2", boardIdFrom(), {
   546:      requireBoardPermission("A2", boardIdFrom(), {
   595:      requireBoardPermission("A2", boardIdFrom(), {
   665:      requireBoardPermission("A2", boardIdFrom(), {
   696:      requireBoardPermission("A2", boardIdFrom(), {
   ```
   **Superseded in part by wave 5, Task 2 — re-run rather than trusted, and it answers FIVE now,
   not seven:** `setOperatorNotes` and `markComplete` no longer carry that guard at all. They are
   `.use(requireBoardActor(assertCanUpdateAgendaItemProgress))` — A2 OR M1, the settled answer to
   the A2-versus-M1 question `agenda-item.ts`'s header had left open (see "Wave 5, Task 2" below).
   Both DO now carry a dedicated M1-only test, which is not the REVOKING-override shape this bullet
   asks for but does exercise the board-override mechanism on each (`boardOverrides: [{ boardId,
   permissions: { M1: true } }]`, global all-false — the `designated_boards` shape). So the gap
   below is now **three** of seven with no override-specific pin (`reorder`, `delete`,
   `instantiateFromTemplate`), not five.
   ```
   $ grep -cE '^[[:space:]]+requireBoardPermission\("A2"' packages/api/src/trpc/routers/agenda-item.ts
   7   # at fb3a5cd
   5   # at 18bad5f
   ```
   Anchored to leading whitespace, deliberately: the unanchored
   `grep -c 'requireBoardPermission("A2"'` this bullet originally ran answers **9** at `fb3a5cd`,
   not 7 — the two extra are prose mentions in the file's own header, the same
   markers-versus-mentions confusion item 11 records for `TODO(phase-e-wave-`. The seven line
   numbers listed above were the real guards; the count beside them was not what that command
   prints.
   Only `insert` and `update` carry a dedicated "honours a REVOKING board override" test
   (`agenda-item.test.ts:417`, `:752`); `reorder`, `delete`, `instantiateFromTemplate`,
   `setOperatorNotes` and `markComplete` are protected by the identical guard code but have no
   override-specific pin of their own — each does carry a plain board-mismatch refusal test, which is
   a different claim (item 2's "the board-MISMATCH case" versus "the board OVERRIDE case" are two
   different things a `BoardScope` guard has to get right, and only the override half is
   under-covered here). **This is a test-coverage gap, not a live authorization hole**: every write is
   guarded, and the override-resolution logic itself lives in `requirePermission`'s own board branch,
   exercised generically in `require-permission.test.ts` and concretely on two of seven real
   `agendaItem` writes plus `meeting.insert`/`cancel`/`updateStatus`. Left open for whichever wave next
   touches this file: add the same "honours a REVOKING board override" shape to the remaining five,
   each verified by mutation the way `insert`'s and `update`'s already are.
2. ~~`refusalMessage` in `lib/trpc.ts` is a fourth implementation, not a consolidation.~~ — **partially
   closed in this task.** At `fb3a5cd` five inline `err.data?.code === "FORBIDDEN"` branches existed
   outside `refusalMessage` itself: `CreateTemplateDialog.tsx:105`, `CancelMeetingDialog.tsx:83`,
   `boards.$boardId.templates.tsx:120` (inside its own local `describeActionError`),
   `routes/meetings.tsx:257`, and `CreateMeetingDialog.tsx:312`. Two matched `refusalMessage`'s exact
   message shape byte-for-byte and are now folded into it
   (`CancelMeetingDialog.tsx`, `routes/meetings.tsx` — see this task's own commit). `CreateMeetingDialog.tsx:312`
   is deliberately NOT one of them, exactly as the carry-over note said: its own comment already states
   why ("Not `refusalMessage`: both of its sentences say the action did not happen, and half of this
   one did"). **Still open:** `CreateTemplateDialog.tsx:105` and `boards.$boardId.templates.tsx:120`'s
   `describeActionError` share a DIFFERENT message shape from `refusalMessage`
   ("Ask a town administrator to `<action>`." / "Something went wrong. Please try again.") — an
   admin-gated-write phrasing, not a permission-refusal phrasing — duplicated between exactly those two
   files. Folding them needs a second exported helper (or `describeActionError` promoted out of
   `boards.$boardId.templates.tsx` and into `lib/trpc.ts` alongside `refusalMessage`/`errorMessage`),
   not a call to `refusalMessage` itself; left for whichever wave next touches either file, since
   promoting a page-local function is a slightly bigger and different change than the two straight
   swaps this task made.
3. ~~`agendaItem.update`'s web-side refusal message string is unpinned.~~ — **closed in this task.**
   `InlineItemForm.tsx`'s `updateItem` mutation already called
   `refusalMessage(err, "edit this agenda item")` on `FORBIDDEN` — the wiring was correct — but
   `InlineItemForm.test.tsx`'s own stub already defined `server.updateRefuses` and no test ever set it,
   the identical shape as the sibling insert/delete refusals it sits beside. Added the missing test and
   verified by mutation (blanking `updateItem`'s `onError`, confirming only the new test goes red,
   restoring byte-identical). The API-side pin this carry-over note pointed at
   (`agenda-item.test.ts:692`, "refuses a caller with no A2 on this board, and changes nothing") is
   unchanged and was never the gap — it was always the web side that had none.
4. **The rule 14 `board_only` town-wide visibility decision — checked against HEAD and already
   correctly recorded, no change needed.** The owner's 2026-09-10 decision ("leave rule 14's town-wide
   `board_only` visibility AS-IS for now... Do not narrow it in wave 5, wave 6, or later without a
   fresh decision") is stated in full, as a decision rather than an open question, in this item's own
   "Wave 4, Task 2's own open items" list (finding 3) and referenced from the "Wave 4, Task 5"
   close-out paragraph above. `exhibit.test.ts` still pins both cross-board reads as PASSING tests
   (`exhibit.link`'s and `byMeeting`'s board-blind `isBoardMember` branches) — verified directly rather
   than assumed. Recorded here only so a reader of this specific carry-over list sees all four
   accounted for in one place; the decision itself is not duplicated a third time.

**Wave 5, Task 2 — closing the rules gap BEFORE the routers that need it, and the one question
wave 4 handed forward.**

Ten rules, all `BoardScope`, all in `rules.ts` (the grep above moves 19 -> 29). Four tables this
wave writes had no rule at all; a fifth had an operation with none; and one existing pair of
procedures was guarded by the wrong code.

| table                    | writes the product performs | code     | rule                                              |
| ------------------------ | --------------------------- | -------- | ------------------------------------------------- |
| `executive_session`      | INSERT / UPDATE / DELETE    | M6       | `assertCan{Insert,Update,Delete}ExecutiveSession` |
| `guest_speaker`          | INSERT / DELETE             | M7       | `assertCan{Insert,Delete}GuestSpeaker`            |
| `agenda_item_transition` | INSERT / UPDATE             | M1       | `assertCan{Insert,Update}AgendaItemTransition`    |
| `future_item_queue`      | INSERT                      | M1       | `assertCanInsertFutureItem`                       |
| `vote_record`            | DELETE                      | M3       | `assertCanDeleteVoteRecord`                       |
| `agenda_item` (live-run) | UPDATE                      | A2 OR M1 | `assertCanUpdateAgendaItemProgress`               |

**One function per write the product performs, which is a DIFFERENT answer from rules 1/2's
`assertCanDeleteAgendaItem` decision, and the difference is the point.** Wave 4 declined to add an
agenda-item DELETE rule because A2 was already stated twice in that file, so the rule was findable
and a third identical body would have been a name with no caller. None of these codes was stated
_once_: a reader auditing `rules.ts` for "what governs deleting a guest speaker" found nothing, and
"nothing" reads as "nothing governs it" — which was in fact true. The operations also differ in what
a refusal has to tell the caller, which this file's header makes load-bearing ("the message is part
of the rule"). Operations the product does NOT perform get no function.

**`agenda_item_transition` and `future_item_queue` had no obvious code and took M1 rather than a new
one.** Both are bookkeeping written as a side effect, never acted on directly, so "the code of the
causing action" is the only non-arbitrary answer available — and the causing action for both is
running the meeting. Two checks rather than one, because "the causing action" alone would be a
guess: a transition row is written in the same user action as `meeting.current_agenda_item_id`,
which `assertCanUpdateMeeting` already governs with an M1 branch, so any other code would put an
authorization boundary through the middle of one action; and a future-queue row is written only by
adjourning, alongside three other M1 writes, so under A2 an M1 presiding officer would adjourn and
silently lose the deferred items — a lost row, not a refusal the user can see. **Minting a new
`PermissionCode` was considered and rejected**: a code no template grants and no screen exposes
refuses everyone, in a system where unset means false.

**`vote_record` DELETE is M3, and deliberately NOT rule 5's self-vote branch.** It is the only one of
the six above where a plausible wrong answer already existed in the file: rule 5 (INSERT) allows a
board member to record their OWN vote (M8), rule 6 (UPDATE) does not. DELETE resembles UPDATE.
`VotePanel.tsx`'s pre-tRPC re-vote was `.delete().eq("motion_id", motionId)` — every member's vote on
that motion, not one seat's — so a self-vote branch there would have been a licence to delete other
people's votes, since the statement was not keyed by seat at all. **Correction, single fix wave
after wave 5's review:** `VotePanel.tsx:207` is now `});`, unrelated syntax, not a citation for this
claim — the re-vote is `voteRecord.recordForMotion`, and `vote-record.ts`'s own header states it
still "clear[s] every vote on the motion, write[s] the roll" server-side in one transaction, so the
reasoning above holds even though the file-and-line no longer does.

**The A2-versus-M1 verdict: A2 OR M1, for the live-run columns only, and it is the fourth guard
shape.** `routers/agenda-item.ts`'s header predicted "a second code, hence `requireBoardActor`" and
that is exactly what it is. `agendaItem.setOperatorNotes` and `agendaItem.markComplete` are now
`.use(requireBoardActor(assertCanUpdateAgendaItemProgress))`; the other five writes in that file
(seven total, minus these two) keep `requireBoardPermission("A2", …)` — `git grep -cE
'^[[:space:]]*requireBoardPermission\("A2"' -- packages/api/src/trpc/routers/agenda-item.ts`
answers 5. The line between them is CONTENT versus LIVE-RUN state —
`status` and `operator_notes` are what the meeting did to the agenda, not what the agenda says.
**It is a WIDENING, so nothing that worked before stops working:** dropping A2 for M1 alone would
refuse a hand-built matrix holding A2 without M1, and keeping both costs nothing because every
shipped template granting A2 also grants M1. **What this means for Task 4's wiring:** nothing
changes on the client — the input shape, the `boardId` prop and the mismatch defence are all
identical; what changes is who gets through, and the two procedures were re-guarded in Task 2 rather
than left for Task 4, because a decided rule that is not applied is the same silent hole as an
undecided one.

**Why this had to land before Task 3, not alongside Task 4.** `handleMeetingEnd` — which Task 3
moves whole into one procedure — writes `agenda_item.status = 'deferred'`, `future_item_queue`,
`agenda_item_transition` and `meeting.status` in one act. Three of the four are M1. Had the fourth
stayed A2-only, an M1 presiding officer's adjournment would have been refused halfway through, which
is a partial adjournment and worse than either answer. The rules had to be coherent as a SET before
the procedure that spans them was written.

**Every one of the ten verified by mutation, per item 13** — blank the rule's body, confirm a NAMED
test goes red, restore from a copy and confirm the checksum. Each also verified by a SECOND mutation
this file had not used before: swap the code the rule resolves (M6 -> M7, M1 -> A2, M3 -> M2) and
confirm the same named test still goes red. That second one is the reason
`board-scope.test.ts`'s new per-rule block seeds an actor holding **every code except the one under
test**: the existing FAMILIES table cannot distinguish a deleted guard from a guard keyed to the
wrong code, because the actors it seeds hold and lose the two codes together. The guard SWAPS in
`agenda-item.ts` were mutated the same way — deleting either `.use()` turns all 5 of that
procedure's tests red (the `ctx.authorizedBoardId` wiring-bug shape `agenda-item.test.ts`'s header
already records), and moving one after `.input()` turns exactly ONE red, the reorder pin, with
`expected 'BAD_REQUEST' to be 'FORBIDDEN'`.

**Wave 5, Task 3 — the routers those rules exist for, and the four things the wave found that this item
did not already say.**

**Twenty-three new procedures — 6 queries and 17 mutations**, across `motion`, `vote_record`,
`meeting_attendance`, `executive_session`, `guest_speaker`, `agenda_item_transition` and `meeting`'s
three composites; plus publishes added to the eleven writes already on `AWAITING_PUBLISH`. Counted
from the router rather than by hand, because the first two places this task stated a number got it
wrong — commit `7be58c8`'s own message says "six reads and thirteen writes" for a commit that adds
fourteen, and an earlier draft of this paragraph said nineteen:

```
$ node -e '…Object.keys(appRouter._def.procedures)…'   # against packages/api/dist
wave5 new procedures: 23 queries: 6 mutations: 17
total procedures in appRouter: 92
```

Every guard shape this item catalogues worked as described, first try, with no change to `trpc.ts`.
What follows is what it did NOT already say.

**1. The FIFTH guard shape has a real call site now, and it is TWO guards, not one.**
The bullet above ("`assertCanInsertVoteRecord` needs a FIFTH guard shape") said it "stays
resolver-side" and asked whichever wave wired it to record why. Recorded — in
`routers/vote-record.ts`'s header — and the answer is more than "resolver-side": **resolver-side
ALONE is not available**, for two reasons this item already establishes elsewhere and had not
connected:

- a procedure with no middleware guard loses FORBIDDEN-before-BAD_REQUEST (this item's central rule);
- and it never sets `ctx.authorizedBoardId`, so `assertMatchesAuthorizedBoard` — the default defence
  for a row-targeted board-scoped write — throws its wiring-bug `Error` on the first real call.

So `voteRecord.insert` carries a local, synchronous **necessary condition** in middleware
(`assertCouldRecordAVote`: M3 for the board, or the `board_member` role — structurally
`assertCanInsertExhibit`, which `requireBoardActor` already handles) AND the real rule in the
resolver. The cost is that the rule is expressed in two places, and it is paid down by keeping the
weaker copy OUT of `rules.ts` (so an auditor of that file finds rule 5 and only rule 5) and by a
named test for the exact gap between them — a board member who passes the guard and is refused by
the rule. **A wave-6 author with an `async` rule should copy this shape, not invent a third.**

**2. A composite procedure has a rule per TABLE, and picking one is a decision with a cost.**
New in this wave and not covered above: `meeting.callToOrder`, `meeting.navigateToAgendaItem` and
`meeting.adjourn` each write three or four tables in one transaction, and each table has its own
`assertCan*` — 21 (admin/A1/M1), 8 (M2), 2a (A2 or M1), 21d (M1), 21e (M1). All three are guarded by
the rule governing their PRIMARY write (`assertCanUpdateMeeting`) and not by the union. The reasoning
is in `callToOrder`'s own doc comment; the general form belongs here:

- **Requiring every rule** refuses a caller who can perform the act's main effect because of a
  subordinate one. An M1 presiding officer holding no M2 could not call a meeting to order, over the
  recording-secretary flag. That is rule 2a's own stated failure ("worse than either answer") one act
  earlier.
- **Requiring the narrowest** (M1 here) is coherent but contradicts a procedure that already ships:
  `meeting.updateStatus` lets an A1 holder drag a meeting to `open` or `adjourned` from the kanban, so
  an M1-only `callToOrder` would allow through one procedure what it refuses through another.
- **What shipped**: the primary write's rule, applied to the whole act, with the gap named. It is a
  NARROWING either way — all of these writes were authorized by nothing at all before — but it stops
  short of the rules for M2 specifically, and that is a decision to revisit with rule 21 rather than
  in a router.

**3. The publish inventory's per-file canary fires by file name, and that was verified by breaking a
file rather than by reading the check.** `trpc/__tests__/router-wiring.test.ts`'s "every router file
that writes a live-meeting table is represented in the scan" is the guard `realtime/events.ts` tells
Task 3 to trust. Re-indenting `guest-speaker.ts`'s three procedure keys from two spaces to four —
something prettier would not produce but a hand edit can — produces exactly the intended failure:

```
AssertionError: guest-speaker.ts writes a live-meeting table (matched directly against the raw file
text) but the scan attributed NO mutation to "guestSpeaker." — a formatting or structural change
likely broke PROCEDURE_KEY or TOP_LEVEL_FUNCTION for this file specifically, and it is now silently
unprotected.
```

No regex needed widening: five new router files were picked up with no change to the scan.
`AWAITING_PUBLISH` went 11 → 0, and the inventory gained one assertion it needs now that the ledger
is empty — that `publishes` is really being read off the source for its two named canaries, since a
`publishes` stuck at `true` would make an empty-ledger check green for the wrong reason.

**Correction (wave 6, Task 2, fix round 1) — the per-file guard does not reach every router file,
only every router file that writes a live-meeting table.** A wave-6 brief asserted the new
`future-item.ts` "must be reachable by the publish inventory's per-file canary, which fails by file
name if a router becomes unscannable," and directed re-indenting `byMeeting:` from two spaces to
four to demonstrate it, exactly as done to `guest-speaker.ts` above. It stayed green — all 5 tests
in `router-wiring.test.ts`. The scan itself explains why: `future_item_queue` is not one of the
eight `LIVE_MEETING_TOPICS`, and the per-file loop skips any file with no live-meeting write before
it ever asks whether the file is scannable —

```
if (liveTablesWrittenIn(source).length === 0) continue; // this file touches no live table
```

(`trpc/__tests__/router-wiring.test.ts:552`). So the guard's own name — "every router file … is
represented in the scan" — is true only of the subset that writes one of the eight tables; a
read-only router, or one scoped to a different table entirely, can go unscannable with nothing
failing. Whether that scope is the right one is a separate question (a router with nothing to
publish has nothing the canary needs to protect), but the boundary itself is real and worth stating
plainly next to the canary's own description, since "it protects every router" is exactly the
over-reading its name invites.

**4. The inventory is a boolean per mutation, so a COMPOSITE needs a topic-set test of its own.**
The check asks "does this mutation call `publishRealtimeEvent` at all". Three of this wave's
mutations write four live-meeting tables; announcing one of the four passes it and leaves three
panels stale on every other device — the exact silent failure `realtime/events.ts` exists to prevent,
one level down from where that file looks for it. The answer is a test helper
(`routers/__tests__/live-fixtures.ts`'s `captureRealtimeEvents`) that opens a real `LISTEN`
connection and asserts the exact topic SET, used on every write this wave added. **Any future
multi-table mutation needs one; the inventory will not ask for it.**

**Verified by mutation, per item 13, each restored from a copy with the checksum re-checked:**

| mutation                                                         | result                                                                                                                                     |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| delete `motion.insert`'s `.use()`                                | 8 of 8 tests red — the `ctx.authorizedBoardId` wiring-bug shape                                                                            |
| move `motion.callVote`'s `.use()` after `.input()`               | exactly 1 red, `expected 'BAD_REQUEST' to be 'FORBIDDEN'`                                                                                  |
| drop `assertMatchesAuthorizedBoard` from the row-targeted helper | 8 board-mismatch tests red, across four routers                                                                                            |
| drop it from the by-meeting helper                               | 7 board-mismatch tests red, a disjoint set                                                                                                 |
| drop `assertBoardMembersOnBoard`'s row-count check               | 6 red — and `motion.insert` then **succeeds silently** with a mover from another town (the ninth reproduction of the FK-bypasses-RLS hole) |
| drop `voteRecord.insert`'s resolver-side rule 5 call             | exactly the 2 board-member tests red; the M3 path stays green                                                                              |
| drop `guestSpeaker.delete`'s publish                             | the inventory fails naming `guestSpeaker.delete`                                                                                           |
| re-indent `guest-speaker.ts`'s procedure keys                    | the per-file canary fails naming `guest-speaker.ts`                                                                                        |
| drop `meeting.adjourn`'s already-adjourned early return          | exactly 1 red, the two-device race test                                                                                                    |

**Wave 5, Task 5 — a fifth answer to "where does a write go", and it is not a
guard shape.** The four shapes this item catalogues all answer "which rule
authorizes this procedure". Task 5's central problem was a different question
the item had never had to ask: **which ACTOR performs a write that nobody
requested.**

`routes/meetings.$meetingId.live.tsx` carried four `useEffect`s that fired when
a motion row arrived over the realtime subscription carrying a new `status`.
They wrote `executive_session` (twice), `minutes_document` +
`notification_event`, and the whole adjournment. Every connected device ran all
four; the only thing between two clerks and two writes was an in-memory
`useRef<Set>` of processed motion ids, which dies on reload and is shared with
nobody. None of the four had an authorization check of any kind.

**The answer that generalises: a write that is a CONSEQUENCE of a transition
belongs in the transaction that performs the transition, not in a procedure the
observers call.** `motion.ts`'s header already established the fact this rests
on — an outcome status is reachable only through `voteRecord.recordForMotion` —
so the transition has exactly one origin and its consequences went there. The
alternative the task's brief also offered (idempotent procedures each client
calls) was measured against two costs and rejected: it leaves N−1 devices
performing a write they did not author, and it surfaces a FORBIDDEN on every
device whose operator merely watched. **The test for which answer applies is
whether the trigger is OBSERVED DATA or LOCAL UI STATE.** One of the five
reactive writes stayed client-side for exactly that reason: the
post-executive-session tracking effect is triggered by `isPostExecSession`, set
when one device's operator answers a dialog, which no server can observe. It
calls an idempotent procedure instead.

**The authorization cost is the composite-procedure decision this item already
records for `callToOrder`, one act further out.** `recordForMotion` is M3, and
it now performs acts whose own rules are 21b (M6, executive session) and 21
(admin/A1/M1, the meeting's status). Requiring those in addition would refuse
the recording secretary mid-roll-call, which is rule 2a's stated failure. The
rule applied is the one governing the act's primary write; it is a NARROWING
either way, because all four writes were authorized by nothing before.

**"Prove the dedup with two concurrent callers" needs two CONNECTIONS, and the
proof is worth copying.** `routers/__tests__/vote-record.test.ts`'s
`concurrently` helper opens two `connectAsAppRole` handles, builds a caller on
each, and `Promise.allSettled`s them — so they really are two backends
contending for the same rows rather than two awaits on one. Each assertion is
on the COUNT of what landed, and each guard is a WHERE clause rather than a
check-then-write, because READ COMMITTED re-evaluates a blocked statement's
predicate against the committed row:

| mutation                                         | result                                                               |
| ------------------------------------------------ | -------------------------------------------------------------------- |
| drop `entered_at IS NULL` from the stamp         | 1 red — `expected [ 'entered', 'entered' ] to have a length of 1`    |
| drop `status <> 'approved'` from the approval    | 1 red — two `notification_event` rows for one approval               |
| drop `meeting.status = 'open'` before adjourning | 1 red — `expected [ true, true ] to have a length of 1`              |
| drop `FOR UPDATE` from the motion lock           | all 3 red, `23505 vote_record_unique_per_motion` — the roll collides |

The last row is the one a copier should read twice: **serializing the procedure
on its own subject row is what makes the consequence guards reachable at all.**
Without it the two callers' delete-and-reinsert of the roll collided before any
consequence ran, and the loser got an INTERNAL_SERVER_ERROR — which is what
concurrent "Record Vote" presses did in production, undetected, because nothing
ever ran two.

**A write two procedures perform is one body, and the publish must stay
visible to the inventory.** Adjournment has two origins now (the "without
objection" declaration and a passed motion), so `meeting.adjourn`'s SQL is
extracted as `performAdjournment` and both call it. `performAdjournment` does
NOT publish, deliberately: `router-wiring.test.ts`'s inventory attributes a
helper's writes to the mutations that NAME it but reads `publishes` only ONE
level deep, so a publish buried inside a helper-of-a-helper is invisible to it
and the inventory starts failing for the wrong reason. For the same reason
`voteRecord.recordForMotion` calls `publishRealtimeEvent` in a loop in its own
file rather than reaching for `meeting.ts`'s `publishLiveMeetingTopics` — the
scan reads THIS file's text. **The inventory is blind across a module boundary;
a cross-module helper's writes are yours to announce.**

### Subscriptions follow item 2's rule unchanged, plus one

Added in **wave 5, Task 1**, which shipped the first `.subscription(` in this codebase
(`trpc/routers/realtime.ts`). Everything above about guard placement carries over, and that was
**measured against a real Fastify server and a real `httpSubscriptionLink` client** rather than
assumed from the mutation case:

- **Middleware runs at SUBSCRIBE time, before the generator body.** A middleware that throws means
  the generator's first line never runs. So `.use(...)` still goes BEFORE `.input()`, for the
  identical reason.
- **`opts.getRawInput()` resolves for a subscription**, even though the request is a GET with input
  in the query string. `requireBoardPermission`, `requireBoardActor` and `boardIdFrom()` therefore
  work on one exactly as they do on a mutation.
- **A reconnect re-runs the whole chain.** The client merges `lastEventId` into the same raw input
  and the server builds a NEW context, so the Fastify gate (session, account, tenant, origin) and
  every middleware run again.

The one addition: **nothing may be yielded until every refusal has had its chance.** A guard that
runs after the first `yield` is not a guard — the client has already acted on an event it was not
entitled to, and no later refusal takes that back. Refuse with a `TRPCError`, never a plain
`Error`: a `TRPCError` thrown from middleware OR from inside the generator reaches the client's
`onError` and the client stops, while a plain `Error` is treated as a dropped connection and
silently resumed (both measured).

**Authorization lifetime, stated rather than left implicit.** A subscription's context is built once
and lives for the whole stream, and a live meeting runs for hours. `trpc.ts` sets
`sse.maxDurationMs` (`SSE_MAX_STREAM_DURATION_MS`, five minutes), so the server ends every stream on
that cadence and the client's own verified resume handshake opens a new request. **Authorization is
therefore evaluated when a stream opens and re-evaluated in full at every reconnect, which the server
forces at least every five minutes; it is not re-evaluated between those points.** Measured: at the
deadline the generator's `finally` runs with `signal.aborted === true`, the client resumes with no
gap, no duplicate and no `onError`, and a fresh context is built.

**A subscription must open at most one `ctx.withTenant`, at subscribe time.** A NESTED call is what
`bindTenantAccess`'s reentrancy guard refuses (two merely concurrent ones are fine, since wave 5
Task 7's rescope), and a stream that fans out per-event work from inside its subscribe-time
transaction is the only shape in this codebase that could produce one. Events carry no payload, so there
is nothing per event to read. `routers/__tests__/realtime.test.ts` counts the transactions and the
actor resolutions, so adding either goes red rather than being discovered under load.

### The client half of one stream (wave 5, Task 4)

Task 1 built the subscription; Task 4 gave it a caller, and three things it
found belong here rather than only in one hook's header.

**The ADR is wrong about `splitLink`, and the correction is one line of code.**
`docs/advisory-resolutions/5.1-realtime-transport.md` says "no `wsLink`/`splitLink`
client wiring is needed". That is true of the WebSocket fallback it was
contrasting against and false of the SSE path it chose: `httpBatchLink` refuses a
subscription outright ("Subscriptions are unsupported by `httpLink`"), so a
single-link client cannot carry both. `packages/web/src/lib/trpc.ts` splits by
operation TYPE; everything that is not a subscription still batches over POST
exactly as before. `EventSource`'s `withCredentials` is passed but buys nothing
here — it governs CORS requests, and `/api/trpc` is same-origin through the Vite
proxy in development and nginx in production, so the session cookie is sent
either way.

**And the split is PINNED, in jsdom, in about forty lines.** Task 4's report
called this seam unautomatable and deferred a manual dev-server check to Task 6
or 7; a reviewer then wrote the test, so the claim is struck and the method is
recorded here because every later subscription needs it. Measured first: with
`condition: () => false` — routing every subscription into `httpBatchLink`,
which refuses one — the web suite was green at 505 passed / 80 files before this
test existed, and typecheck (5 successful) and lint (0 errors) are blind to the
mutation with or without it. The regression was 100% silent and presented only as
"the live meeting never updates". With the test in place the same mutation
answers `1 failed | 508 passed`, and the one failure is it. The test is `lib/__tests__/trpc.test.ts`'s "the link
split", and it works because `httpSubscriptionLink` resolves
`globalThis.EventSource` LAZILY, at subscribe time, inside its
`observable((observer) => …)` body. A fake constructor on the global therefore
answers "which branch did this operation take?" without any transport working at
all. Both directions are asserted, so the predicate cannot be inverted either: a
subscription MUST open an `EventSource` (verified — `() => false` reddens exactly
that test, with `httpBatchLink`'s own refusal as the message) and a query MUST
NOT (verified — `() => true` reddens the query half).

**The generalisation, which cost this wave twice: "jsdom cannot do X" is a claim
about the TRANSPORT, and it is almost never a claim about the BEHAVIOUR under
test.** Two implementers in wave 5 declared something unautomatable and a
reviewer automated both. Before writing "unautomatable" in a report, state what
the test would have to observe, then check whether the library resolves that
thing lazily or takes it as an option — a fake at the seam is usually enough,
and the alternative on offer (a manual check, deferred to a later task) is
coverage nobody will run twice.

**A subscription's `error` is not its `status`, and dropping it is not the same
decision.** `useLiveMeetingEvents` returns `void` because nothing has ever read
the connection `status` and `ConnectionStatusBar` (Task 6) should define that
vocabulary. Discarding `useSubscription`'s whole result also discarded its
`error`, which is a different thing: a `TRPCError` — `NOT_FOUND` for a meeting
outside the caller's tenant, or anything the auth chain throws at subscribe —
makes this client STOP rather than resume (the transport ADR's addendum measured
exactly that), so the stream died permanently with nothing on screen and, until
Task 6, a `ConnectionStatusBar` still reporting a Supabase heartbeat this screen
no longer uses. **Every subscription this phase adds must pass an `onError` that
reaches a human.** This one raises a `duration: Infinity` toast under a stable
id — persistent because the condition is, one id because a refusing reconnect
loop would otherwise stack a column of them, and a toast rather than a banner
because the hook is called above the screen's status routing and fires for a
meeting still in `MeetingStartFlow`. Pinned in
`hooks/__tests__/useLiveMeetingEvents.test.ts`; deleting `onError` from the
`subscriptionOptions` call turns both of its tests red.

**The topic → query-key mapping is the client's, and the coupling needs TWO
mechanisms, not one.** A topic with no client mapping is received, matched by
nothing and dropped: a panel that stops updating on other devices, with no error
anywhere. `hooks/useLiveMeetingEvents.ts` closes it twice over, and neither half
is redundant — the type is derived from the PROCEDURE'S OUTPUT and cannot see
`LIVE_MEETING_TOPICS` the array, while the test reads
`packages/api/src/realtime/events.ts` as TEXT and cannot see whether a mapping's
VALUE is right:

- `Record<LiveMeetingTopic, …>`, so a topic added server-side fails
  `npx turbo run typecheck --force` by name;
- `hooks/__tests__/useLiveMeetingEvents.test.ts` parses the
  `LIVE_MEETING_TOPICS` array out of the API source and compares it to the
  mapping's keys — a NAMED failing test rather than a compiler error, which is
  what a brief can ask for. Reading the source as text rather than importing it
  is deliberate: `@town-meeting/api`'s `exports` map publishes types only, and
  `events.ts` imports `drizzle-orm`. Same technique as
  `router-wiring.test.ts`'s publish inventory.

Only the per-site deletion sweep can tell you a mapping invalidates the WRONG
router. It was run.

**One topic is not one-to-one with its table, and that is behaviour preservation
rather than a design choice.** `agenda_item` invalidates `trpc.agendaItem` AND
`trpc.exhibit`, because the Supabase channel it replaces invalidated a single
`select("*, exhibit(*)")` key — so an `agenda_item` change refetched the
meeting's exhibits as a side effect of them being embedded. Two procedures back
that one read now. There is no `exhibit` topic and there was no `exhibit`
Supabase channel either; giving it one would be a feature.

**A read the screen OBSERVES cannot be pinned with `isInvalidated`.** New in this
task and general: `invalidateQueries` on a key with a live observer triggers an
immediate refetch, which clears `isInvalidated` again — so the assertion every
writer test in this repo uses is a RACE for any key the screen under test also
reads. Item 8's existing examples all seed keys only the SHELL reads
(`agendaItem.countByMeeting`, `meeting.byBoard`), which have no observer, and
that is why the problem had not surfaced. Two answers, both used here: assert the
REFETCH instead (`stub.countFor("motion.byMeeting")` grew), or seed a key under
the same ROUTER that this screen does not observe (the same procedure for a
different meeting id) — `pathFilter()` matches it, nothing refetches it, and the
flag stays set.

### The app-global transport surface (wave 5, Task 6)

Task 6 finished the transport by deleting the last two Supabase heartbeats — one in
`components/ConnectionStatusBar.tsx`, one in `lib/connection-error-handler.ts`, both app-global —
and three of its findings generalise past this wave.

**Count the things that can be disconnected, not the indicators you inherited.** The obvious
migration keeps one shared connection state, because the old world had one shared WebSocket. The
SSE world has TWO disconnectable things and they live in different places: the live meeting's SSE
stream, which exists on exactly one screen, and the browser's own reachability, which is app-global
and governs every query and mutation everywhere. A single state cannot carry both — on `/boards`
there is no stream, and on `live.tsx` a healthy browser says nothing about whether the stream is
alive. Collapsing them is what made the old bar report a transport its own screen no longer used.
The app-global half reads TanStack Query's `onlineManager` rather than `navigator.onLine`, so the
indicator cannot disagree with the object the cache itself consults before pausing a mutation.

**A bounded reconnect is not an outage, and any future subscription inherits this.**
`SSE_MAX_STREAM_DURATION_MS` ends every stream at five minutes to bound authorization staleness,
and `sse-bounds.test.ts` pins that the deadline emits no `event: return` — which is exactly what
makes the client resume rather than stop. The client-side trace, read off `@trpc/client`'s own SSE
state machine, is `pending → connecting → pending`: a real transition through `connecting`, twelve
times an hour, on a stream that is working perfectly. **An indicator wired to
`status === "connecting"` cries wolf twelve times an hour during a live public meeting, which is
worse than no indicator — the one time it means something is the one time nobody looks.**
`useLiveMeetingEvents` answers with a five-second grace window before it will say anything about a
`connecting` stream, while `error` bypasses the window entirely (a `TRPCError` makes this client
STOP, so there is nothing to wait for). The window delays the SAYING, never the invalidation.
Pinned by `useLiveMeetingEvents.test.ts`'s "stays silent through a bounded reconnect that resolves
inside the grace window", which is red under BOTH obvious regressions — an immediate
`setStatus("reconnecting")`, and a timer with no `clearTimeout` cleanup (that one reddens on the
last assertion, `expected 'reconnecting' to be 'healthy'`, which is the whole reason the test
advances the clock again AFTER the stream is back).

**Two surfaces for one condition can be right, and the discriminator is event-versus-state.**
Task 6 added a rendered banner and KEPT Task 4's `duration: Infinity` toast rather than replacing
it, on the same reasoning item 12 gives for `RouteErrorBoundary` versus an in-component
`role="alert"`. The toast is the EVENT: raised once by the HOOK, so it is guaranteed regardless of
what the caller renders — and `live.tsx` renders no banner in its `MeetingStartFlow` branch or any
loading branch, both of which the hook is called above. The banner is the STATE: a standing
sentence for whoever walks up to the laptop ten minutes later, and the only surface for
"reconnecting", which is not an event and has no moment to fire at. **The `Toaster` a hook-raised
toast needs is in `root.tsx`, above `Outlet` — app-global, not `live.tsx`'s.** A hook that toasts
with no mounted `Toaster` above it is a silent no-op, so check the mount point before relocating
either the hook or its caller.

**And one correction to a brief, recorded because the same wrong intuition is easy to have twice:
resuming from `lastEventId` does NOT mean a client missed nothing.** Resume is about id
MONOTONICITY, not replay. `routers/realtime.ts` says so in its own comment — Postgres does not
queue notifications for an absent listener, so anything published during the gap is gone — and it
therefore re-yields EVERY topic when a `lastEventId` is present. A reconnect has almost certainly
missed something; what makes the old whole-cache invalidation wrong is not that nothing went stale
but that the server now says exactly WHAT did.

### Realtime events are invalidation signals, and the tenancy filter is application code

A `LISTEN` connection **cannot** carry tenant context: `LISTEN` is session-scoped, `app.town_id` is
`SET LOCAL` transaction-scoped, and a notification is delivered between transactions. No policy
applies to the delivery. So `eventMatchesSubscriber` in `realtime/bus.ts` is the whole of the
tenancy guarantee for this transport — the one place in Phase E where "no redundant `WHERE town_id`
alongside RLS" does not apply, because there is no RLS to be redundant with. It is pinned by a test
in two places (`realtime/__tests__/bus.test.ts` and `routers/__tests__/realtime.test.ts`); deleting
the town comparison turns both red.

An event carries a TOPIC and nothing else. Both the `NOTIFY` payload's fields (`townId`,
`meetingId`) are filter inputs that stop at the bus. That is not only simpler — a `NOTIFY` channel
is GLOBAL to the database and any session that can connect can read it, so a payload carrying row
data would be visible to every tenant's connection with nothing in the schema saying so.

**What wave 5's Task 3 owes this:** `publishRealtimeEvent(tx, ...)` is application-level, so a write
that forgets to call it leaves every other device stale with no error anywhere. It is called from
inside the write's own `ctx.withTenant` transaction, which is what makes the invalidation
transactional — `pg_notify` is delivered at COMMIT and discarded on ROLLBACK (measured and pinned),
so no client is ever told to refetch a row that then did not happen. A database trigger on the nine
tables could not be forgotten and is the documented escalation if the per-mutation call proves
unwieldy across Task 3's thirty-five write sites; it was declined because a trigger knows the TABLE
and the topic is not always the table, and because it would fire for the 60-second notification
sweep and every background `TenantJob`.

---

## 3. NOT_FOUND, not FORBIDDEN, for a row in another town

A board that does not exist and a board belonging to another town must be **indistinguishable** to
the caller. `FORBIDDEN` on a foreign row confirms the row exists, which turns any id-guessing loop
into an existence oracle across towns. RLS already makes the row invisible rather than merely
filtered, so `NOT_FOUND` is also the honest answer: from inside the caller's tenant context there
is nothing there.

**Answer it consistently across every procedure in a router**, including the ones that do not
naturally have an opinion. `board.stats`' correlated subqueries and `board.recentMeetings`' scan
both degrade to `{0, 0}` and `[]` for an id that never existed, exactly as they would for a real
board with no members yet — so a screen that calls `stats` without `detail` would render a
convincing, empty-but-real board for an id that is not there. `board.ts` closes that explicitly:

```ts
async function assertBoardExists(tx: TenantTx, boardId: string): Promise<void> {
  const rows = toRows<{ id: string }>(
    await tx.execute(sql`SELECT id FROM board WHERE id = ${boardId}`),
    (message) => new Error(`board.assertBoardExists: ${message}`),
  );
  if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND" });
}
```

`stats` and `recentMeetings` both call it before counting.

### A foreign key is a hole RLS does not close

Any FK pointing at a tenant-scoped row is a hole RLS does not close. PostgreSQL's own documentation
says so directly: uniqueness, primary key and foreign key constraint enforcement **bypasses row
security** to preserve data integrity. So an INSERT that takes a foreign key from client input and
relies on the FK alone to keep it in-tenant is not protected by `FORCE ROW LEVEL SECURITY` at all —
the constraint will happily reference a row RLS would otherwise hide from the caller's own `SELECT`s.

This was not theoretical. Phase E wave 1 Task 3's `person.insertStaffAccount` takes a `personId` and
inserts a `user_account` referencing it via `user_account_person_id_fkey`. Without an explicit
existence check, a reviewer reproduced this directly: as Newcastle's admin, calling
`insertStaffAccount` with **Bristol's** `personId` succeeded — no error, no refusal — and wrote
`user_account{town_id: Newcastle, person_id: <Bristol's person>}`. Bristol's own admin can neither
see this row (RLS hides it) nor delete it, and it consumes `user_account_person_id_key`, so that
Bristol person can **never** get an account in their own town — a permanent, silent `CONFLICT` for
a person who did nothing wrong.

**Every insert that takes a foreign key from client input needs an explicit tenant-scoped existence
check first**, run through `ctx.withTenant` (so RLS actually filters it) before the write that
references the id. `board.ts`'s `assertBoardExists` and `person.ts`'s `assertPersonExists` are the
two existing instances of the pattern — same shape, same reason, written independently before this
item existed to name the rule:

```ts
async function assertPersonExists(tx: TenantTx, personId: string): Promise<void> {
  const rows = toRows<{ id: string }>(
    await tx.execute(sql`SELECT id FROM person WHERE id = ${personId}`),
    (message) => new Error(`person.assertPersonExists: ${message}`),
  );
  if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND" });
}
```

This is not specific to `person`. Every FK-bearing write in the ~75 remaining screens is a candidate
— `board_member`, `invitation`, `meeting`, `minutes_*` and anything else that inserts a row carrying
a foreign key whose target table is tenant-scoped. Verify the gap the way it was found here: delete
the existence check, attempt the cross-tenant write, and confirm it is refused (NOT_FOUND) rather
than silently succeeding.

**Scope correction (wave 6, Task 1, reproduced against a real database): this hazard is INSERT-side
specifically, not a general property of writes on an RLS-covered table.** Every one of the nine
reproductions above is an INSERT taking a foreign key from client input. Probed directly, tenant
context town A targeting town B's `minutes_document`:

```
UPDATE minutes_document SET status = 'published' WHERE id = <town B's document>  →  0 rows, no write
SELECT the same row as town A                                                    →  [] (invisible)
the row read back as town B, unchanged                                           →  still 'approved'
INSERT carrying an FK to town B's invisible row (the shape above)                →  SUCCEEDED, silently
```

`FOR ALL USING (town_id = get_current_town_id())` covers `UPDATE` the same way it covers `SELECT` —
there is no constraint-enforcement bypass on the write path itself, only on the FK's target lookup.
So an existence check guarding an UPDATE's target row buys the **honest `NOT_FOUND`**, not the
prevention of a write that RLS was already stopping: removing `resolveMinutesDocumentScope`'s
`if (!row)` still turns every cross-tenant test on `minutesDocument`'s six status transitions red,
but the four board-scoped ones answer FORBIDDEN (the mismatch defence comparing against an empty
board id) and the two administrator-gated ones, with no mismatch defence behind them, report success
or `INTERNAL_SERVER_ERROR` for a transition that changed nothing — never a cross-tenant write. Do
not carry "any unguarded cross-tenant write succeeds silently" into a brief; say INSERT.

---

## 4. The client call shape

Reads:

```ts
// packages/web/src/routes/boards.$boardId.tsx
const {
  data: board,
  isLoading: isBoardLoading,
  isError: isBoardError,
  error: boardError,
} = useQuery(trpc.board.detail.queryOptions({ boardId }));

const { data: stats } = useQuery(trpc.board.stats.queryOptions({ boardId }));

// Spread when you need to add TanStack options — do not drop the ones the
// screen already had. `enabled` here is a real behaviour, not noise: without
// it this query fires on every page load regardless of which tab is open.
const { data: recentMeetings = [] } = useQuery({
  ...trpc.board.recentMeetings.queryOptions({ boardId, limit: 5 }),
  enabled: activeTab === "meetings",
});
```

Route loaders prime the same cache the component reads:

```ts
export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  // Not wrapped in try/catch: a nonexistent or foreign board answers NOT_FOUND
  // and letting that reject routes to RouteErrorBoundary — visible, not the
  // indefinite "Loading board..." the old select("*").limit(1) produced (an
  // empty array is neither an error nor a board).
  await queryClient.ensureQueryData(trpc.board.detail.queryOptions({ boardId: params.boardId }));
  return { boardId: params.boardId };
}
```

Writes are `useMutation` plus invalidation — see item 7 for exactly which keys.

---

## 5. Error and loading states are required, and `role="alert"` is the pin

The failure this phase exists to end is a screen that renders nothing and says nothing. Every
migrated screen needs three distinguishable states: loading, error, and content. The error state
carries `role="alert"`, which is what the test asserts on.

```tsx
if (isBoardError) {
  const notFound = isTRPCClientError(boardError) && boardError.data?.code === "NOT_FOUND";
  return (
    <div className="..." role="alert" aria-live="assertive">
      <AlertTriangle className="..." aria-hidden="true" />
      <p>
        {notFound ? "This board could not be found." : "Something went wrong loading this board."}
      </p>
      <p>
        {notFound
          ? "It may have been deleted, or it belongs to another town."
          : "Try reloading the page. If the problem continues, contact support."}
      </p>
      <Link to="/boards">Back to Boards</Link>
    </div>
  );
}

if (isBoardLoading || !board) {
  return (
    <div className="...">
      <p>Loading board...</p>
    </div>
  );
}
```

Verified by mutation: deleting the `isBoardError` branch makes the error test fail with
`Unable to find role="alert"`, and the screen sits on "Loading board..." forever — the exact
silent-failure mode being migrated away from.

---

## 6. The test idiom

- **A typed mock per screen**, built the way item 8 describes.
- **Authorization is not re-proven on the web.** It stays in the API's real-Postgres suite. Web
  tests cover rendering, interaction, loading and error states. A web test that "proves" a
  permission is proving what its own mock returned.
- **One wiring entry per new router**, in `packages/api/src/trpc/__tests__/router-wiring.test.ts`.
  This closes the one hole a typed mock cannot: calling the wrong _procedure_. Add your router's
  procedures to the pinned list:

```ts
const procedures = Object.keys(appRouter._def.procedures).sort();
expect(procedures).toEqual(
  expect.arrayContaining([
    "board.detail",
    "board.recentMeetings",
    "board.stats",
    "permissions",
    "town.portalAddress",
    "town.setPortalAddress",
    "whoami",
    /* yours */
  ]),
);
```

Note `arrayContaining` pins only what it names. Grow the list as you add procedures.

---

## 7. Cache invalidation — a read owns its key

**The commit that moves a read to tRPC also updates every writer that was invalidating the key it
abandoned, in that same commit.** This is a completion gate, not advice.

After migrating a read, run `grep -rn "queryKeys\.<entity>" packages/web/src` and update every
`invalidateQueries` hit, or record in the commit why one does not apply.

During the transition, a Supabase-backed writer invalidates **both**:

```ts
// packages/web/src/components/boards/ArchiveBoardDialog.tsx
onSuccess: () => {
  void queryClient.invalidateQueries({ queryKey: queryKeys.boards.detail(boardId) });
  void queryClient.invalidateQueries({ queryKey: queryKeys.boards.byTown(townId) });
  void queryClient.invalidateQueries({ queryKey: queryKeys.members.byBoard(boardId) });
  void queryClient.invalidateQueries(trpc.board.pathFilter());
  // Archives every active `board_member` row on this board — a fourth
  // writer of the legacy `queryKeys.members.byBoard` key above, added in
  // Task 3's own fix round after a reviewer caught this dialog missing it.
  void queryClient.invalidateQueries(trpc.boardMember.pathFilter());
  // ...
};
```

(Kept in sync with the real file, not re-quoted from memory: `ArchiveBoardDialog.tsx`'s own
`onSuccess` carries both `pathFilter()` calls today. An earlier version of this example omitted the
`trpc.boardMember.pathFilter()` line — the exact line Task 3's own blocking finding added — which
matters here specifically, since this is the example roughly 80 wave migrations copy from.)

The legacy line stays because other, unmigrated screens still read that key. It goes when the last
legacy reader does — not before.

**Default to router-level `trpc.<router>.pathFilter()`, not per-procedure `queryFilter()`.** A
board edit can change what both `detail` and `stats` return, and a writer should not have to know
which procedures some screen happens to call.

**Bare `invalidateQueries()` with no filter is banned in a mutation's `onSuccess`.** It invalidates
every query in the cache, which hides exactly the bug this item is about: a writer that
invalidates everything is indistinguishable from a writer that invalidates the right key, so the
day someone narrows it, the missing key surfaces as a bug in a screen nobody touched.

~~The one carve-out already in the tree, and it is a real one: `initConnectionErrorHandler` in
`packages/web/src/lib/connection-error-handler.ts` calls bare `invalidateQueries()` in its
`status === "SUBSCRIBED"` reconnect branch, after a Realtime reconnect. That is not a writer —
nothing local changed; the client has no idea WHAT went stale while the socket was down, and
"everything" is the correct answer. A connection-level recovery may invalidate globally. A mutation
may not. Do not "fix" that handler on a grep.~~ — **closed in wave 5, Task 6. THE BAN IS NOW
ABSOLUTE: there is no sanctioned bare `invalidateQueries()` anywhere in `packages/web/src`, and a
grep that finds one has found a bug.**

That carve-out rested on "the client has no idea WHAT went stale," and under SSE the client is told.
`routers/realtime.ts` treats a resumed stream as "you may have missed something" and re-yields every
topic, so `useLiveMeetingEvents` invalidates the nine live-meeting routers BY NAME on exactly the
reconnects that matter — strictly narrower and strictly more correct. The handler itself is gone
along with its Supabase heartbeat: there is no app-global socket left whose re-SUBSCRIBE could be
the trigger, and the one reconnect that does happen is the five-minute bounded one, so the old
branch would now have fired a whole-cache invalidation twelve times an hour per clerk in the room.
Quote the grep, and note it must be ANCHORED — the unanchored form matches this very paragraph and
the three prose mentions in `providers/QueryProvider.tsx`'s header, the markers-versus-mentions
hazard of item 11:

```
$ git grep -nE '^[[:space:]]*(void )?queryClient[.]invalidateQueries[(][)];' <ref> -- packages/web/src
a357d59:packages/web/src/lib/connection-error-handler.ts:54:          void queryClient.invalidateQueries();
                       # and nothing at HEAD
```

_Found the hard way in Task 4: four writers — `EditBoardDialog`, `ArchiveBoardDialog`,
`NoticeTemplateEditor`, `MinutesWorkflowEditor` — invalidated `queryKeys.boards.detail(boardId)`
while the screen had moved to tRPC's key. A rename left the old name on screen for the full 60s
`staleTime`, and a saved notice template came back reverted._

### This rule is now a test, not just a paragraph

This exact rule was violated three more times after Task 4 named it — blocking review in Tasks 2, 3
and 5 — by implementers who had all read this item. Naming a rule in a document a human has to
remember to re-check is not enough; `packages/web/src/lib/__tests__/cache-key-parity.test.ts` checks
it mechanically, on every `npx turbo run test`, and fails with a filename instead of waiting for a
reviewer's grep.

What it checks: for every `invalidateQueries(` call in a non-test file, if the call's own argument
names a `queryKeys.<namespace>` for a namespace in its hand-maintained `MIGRATED` map (quote
`cache-key-parity.test.ts`'s own `MIGRATED` object — this paragraph used to carry a count and a
roster instead, and it drifted from three to seven to eleven entries without ever being updated;
the object is the only statement of it that cannot go stale), the same file must also call the matching
`trpc.<router>.pathFilter()` somewhere. The match is scoped to roughly 250 characters measured from
inside the `invalidateQueries(` call itself, not the whole file — a whole-file version of this check
raises 12 false positives at HEAD (files that read a migrated key in a `useQuery` far from an
unrelated `invalidateQueries()` call); the windowed version raises zero.

That contrast is real but the "windowed versus whole-file" framing above overstates what the number
`250` itself buys: the precision comes from the match being **forward-only** from the
`invalidateQueries(` marker, not from the width being small. Widening the forward-only window all
the way to 999999 characters — in effect everything from the call to the end of the file — still
raises zero false positives, while a bidirectional variant of the same check (the width measured on
both sides of the marker, rather than only ahead of it) picks up 1, 4 and 9 of the twelve at widths
1000, 3000 and 10000 respectively, climbing to the full 12 once its own width is unbounded — which
is just the whole-file check by another name. `250` could be far larger with the same result; what
actually does the work is that nothing behind the marker is ever read.

Validated against `git archive` snapshots of six real commits from this wave, not assumed: it
reproduces two of the three blocking findings a human reviewer found by hand, by file, at the commit
each shipped — `TownSealUpload.tsx`/`settings.minutes-workflow.tsx` at `841f4db`, and
`AddBoardDialog.tsx` (its only violation) at `7a17fa6` — and raises zero violations at HEAD (`2d78964`).
It does **not** reproduce the third named finding, "the four person writers at `3b22df8`" — and that
is not a scoping miss: by that commit those files already called `trpc.person.pathFilter()`; what was
actually missing and fixed at `4f8b3fc` was the WRITER TEST pinning each call (item 8's "pin the
writers, not just the readers"), a different failure mode from a missing invalidation call. See the
Known-gaps entry below for the untuned second half that would close that gap too.

---

## 8. Mock the transport, not the proxy

**This is the single highest-leverage item in this document.** It is the file 80 tests get copied
from.

### What went wrong

Task 4's screen test did `vi.mock("@/lib/trpc", ...)`, replacing the options proxy with hand-built
`queryOptions()` objects. Two facts follow, both measured rather than suspected:

1. **The suite could not catch a missing `pathFilter()` call.** A reviewer deleted
   `NoticeTemplateEditor`'s invalidation line and ran everything: **940 tests, nothing red.** The
   keys those tests exercised (`["board.detail", input]`) were invented by the tests and matched
   nothing the app produces, so no invalidation assertion was even expressible.
2. **Mocking `@/lib/trpc` wholesale binds nothing to the router.** Renaming `name` to `nayme`
   inside the mock left `tsc --noEmit` at **exit 0**, because the mock's return type was inferred
   from the mock. Any column the assertions do not name could drift from the procedure with
   typecheck and tests both green.

### What to do instead

Leave `@/lib/trpc` **unmocked**. Replace `globalThis.fetch` — the actual boundary between the app
and the API — using `packages/web/src/test/trpc.ts`:

```tsx
// packages/web/src/routes/__tests__/boards.$boardId.test.tsx — MODULE SCOPE,
// above the it(...) blocks. Not inside a test. See "scope" below.

import { installTRPCFetchStub, trpcTestError } from "@/test/trpc";
import { trpc } from "@/lib/trpc";

/** Mutable so a test can change what the server returns between refetches. */
const server = { boardName: "Select Board", detailRejects: false };

const stub = installTRPCFetchStub({
  "board.detail": () => {
    if (server.detailRejects) trpcTestError("NOT_FOUND");
    return { id: "b1", name: server.boardName /* ...every column the procedure selects... */ };
  },
  "board.stats": () => ({ active_members: 3, meetings: 7 }),
  "board.recentMeetings": () => [],
});

describe("board detail", () => {
  beforeEach(() => {
    server.boardName = "Select Board";
    server.detailRejects = false;
  });
  // ...
});
```

### Scope: once per file, at collection scope

`installTRPCFetchStub` installs the stub in a `beforeEach` and restores the original `fetch` in an
`afterEach`. **Call it above your `it(...)` blocks, exactly once, and route per-test variation
through mutable state the handlers close over** — the `server` object above. Calling it from
inside a test body throws with an actionable message.

That guard is not decoration. Vitest **silently ignores** a lifecycle hook registered while a test
is running, so the first version of this helper — which called `afterEach` from wherever it
happened to be invoked — had two failure modes and no way to notice either:

| Where it was called | What happened                                                                                                                                                                           |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| inside a test body  | the hook was dropped; `fetch` stayed stubbed past the end of the file, and the doc comment's "cannot leak" promise was simply false                                                     |
| at module scope     | the hook ran and unstubbed `fetch` after test 1; every later test failed with `Unable to find an element with the text: Select Board` — a DOM error pointing nowhere near the transport |

`packages/web/src/test/__tests__/trpc-stub-scope.test.ts` pins both directions: the supported form
answers across two tests with its call log reset between them and `fetch` restored by `afterAll`,
and each helper refuses a call made from inside a test body. Verified by mutation — dropping the
scope guard, the call-log reset, or the restore each turns that file red.

`setupAppQueryClient()` carries the identical requirement, for the identical reason. Both throw
rather than degrade.

`TestHandlers` is keyed by `AppRouter`'s flattened procedure paths, and each handler's input and
output are inferred from the procedure. Both halves verified by mutation:

| Mutation                          | Result                                                                                 |
| --------------------------------- | -------------------------------------------------------------------------------------- |
| `name:` → `nayme:` in the payload | `TS2322: Property 'name' is missing ...`                                               |
| `"board.stats"` → `"board.statz"` | `TS2353: '"board.statz"' does not exist in type 'Partial<{ ... "board.detail" ... }>'` |

**The binding is not total, and the gap runs one way.** A missing or misspelled field is rejected;
an **extra** one is not. This compiles clean:

```ts
"board.stats": () => ({ active_members: 3, meetings: 7, bogus: 1 }),
```

Excess-property freshness is lost through the `Partial<>` and conditional mapping `TestHandlers` is
built from. So read a green typecheck as **"nothing the procedure returns is missing"**, not "this
payload is exactly the procedure's shape".

Left as-is deliberately, and the reasoning is here so it does not get re-litigated: closing it
would cost either the `Partial<>` (every file would then have to supply a handler for every
procedure on the router) or the inference itself. And the failure mode is benign — a component
reads its fields through `queryOptions()`, whose type is the real `inferProcedureOutput`, not the
mock's shape. An extra key in a handler is invisible to the component and cannot make a failing
assertion pass.

Because the real proxy runs, the query keys are real, and the assertion that was impossible before
is now routine:

```tsx
// `stub` and `server` come from the module-scope install shown above.
it("refetches when a writer invalidates trpc.board.pathFilter()", async () => {
  renderRoute("b1");
  expect((await screen.findAllByText("Select Board")).length).toBeGreaterThan(0);
  const before = stub.countFor("board.detail");

  server.boardName = "Renamed Board";
  await queryClient.invalidateQueries(trpc.board.pathFilter());

  await waitFor(() => expect(stub.countFor("board.detail")).toBeGreaterThan(before));
  expect((await screen.findAllByText("Renamed Board")).length).toBeGreaterThan(0);
});
```

Verified by mutation: swapping `trpc.board.pathFilter()` for `trpc.town.pathFilter()` fails with
`expected 1 to be greater than 1`.

### Pin the writers, not just the readers

The 940-green-tests hole was on the **write** side, so close it there.
`packages/web/src/components/boards/__tests__/ArchiveBoardDialog.test.tsx` is the template: real
proxy, real `QueryClient`, Supabase mocked only at `@/hooks/useSupabase`.

```tsx
const detailKey = trpc.board.detail.queryOptions({ boardId: board.id }).queryKey;
queryClient.setQueryData(detailKey, board);
expect(queryClient.getQueryState(detailKey)?.isInvalidated).toBeFalsy();

// ...render the dialog, type the confirmation, click Archive...

await waitFor(() => expect(queryClient.getQueryState(detailKey)?.isInvalidated).toBe(true));
```

Verified by mutation: deleting `ArchiveBoardDialog`'s `pathFilter()` line turns this red.
`EditBoardDialog`, `NoticeTemplateEditor` and `MinutesWorkflowEditor` now have the same pin, in
`__tests__/EditBoardDialog.test.tsx`, `__tests__/NoticeTemplateEditor.test.tsx` and
`__tests__/MinutesWorkflowEditor.test.tsx` — all three verified the same way: delete the
`pathFilter()` line, watch the new test go red, restore it. **Two more joined in this wave's fix
round:** `AddBoardDialog.tsx`, pinned in `__tests__/AddBoardDialog.test.tsx`, and
`routes/settings.meeting-notices.tsx`, pinned in `routes/__tests__/settings.meeting-notices.test.tsx`
— both had shipped their `pathFilter()` call without the pin and were caught in review; both
verified the identical way. Six writers carry the pin as of `2d78964`. That roster is what goes
stale first, not the pin discipline itself — re-run `grep -rl "\.pathFilter()" packages/web/src`
rather than trust the count above staying current. (It answers **113** at `43c2963`, wave 6 Task 5's
close, against 6 when the roster above was written — which is the whole argument for re-running it.)

**Wave 6, Task 5 found a `pathFilter()` obligation that no grep of any kind could have surfaced, and
this is the shape to watch for.** Migrating a READ can create a new obligation for a writer in a
different file, with no legacy key involved on either side. `EditBoardDialog`'s "does this board have
meetings" check moved from a raw `meeting` head-count onto `trpc.board.stats` — a procedure on a
DIFFERENT router from the table the count reads. `CreateMeetingDialog` was already invalidating
`trpc.meeting.pathFilter()`, correctly, and that call does not match a `board.*` key, so creating a
meeting silently stopped re-enabling the name field for the full 60s `staleTime`. Item 7's prescribed
procedure ("grep `queryKeys.<entity>`, check every `invalidateQueries` hit") finds this only by
accident, because the legacy key it points at (`queryKeys.meetings.byBoard`) names `meeting`, not
`board`; `cache-key-parity.test.ts` cannot see it either, since the file DOES call a `pathFilter()`
and the check is per-file-and-namespace, not per-procedure. This is the read-side twin of backlog
entry 8's write-side blind spot. **The question to ask is not "which legacy key did this abandon"
but "which ROUTER does the procedure live on, and does every writer that changes what it returns
invalidate THAT router" — and those are different answers whenever a procedure aggregates across
tables** (`board.stats`, `board.list`'s `active_member_count`, `boardMember.memberCount`). This is
NOT only a question to ask at the moment you migrate a read: `EditBoardDialog`'s case above was
triggered by a read migration, but the next occurrence, one commit later, was standing writer debt
with no migration on either side — widen the framing accordingly. Found by hand, fixed with its pin
in the same commit.

**Chasing the same shape one step further (wave 6, Task 5, `dc1b035`) found five more writers, none
of them touched by a read migration at all.** `board.stats.active_members`
(`boards.$boardId.tsx`'s Overview) and `board.list.active_member_count` (`/boards`) are the
identical cross-router aggregate over `board_member` rows, and had been since `board.stats` and
`board.list` first shipped — `boards.$boardId.tsx` moved to `board.stats` in unit 0, `/boards` to
`board.list` in wave 2, both waves before this one. Five mutations changed what those two columns
report and invalidated `trpc.boardMember.pathFilter()` instead of `trpc.board.pathFilter()`:
`AddMemberDialog`'s `boardMember.addBoardMember`, `MemberArchiveDialog`'s
`boardMember.archiveMembership`, and `MemberTransitionDialog`'s `archiveMembership`, `addToBoard`
and `convertToStaff`. Seating or retiring a member left the Overview's member count and `/boards`'s
"N / M" cell stale for up to the full 60s `staleTime`, on every affected screen, since before wave
6 started. Found by hand (the same "which router does the aggregate live on" question, asked of
`boardMember`'s own writers rather than at a read's call site), fixed with three pins in the same
commit, each verified by deletion.

**The sweep this shape calls for is now complete for the whole API, not partial — verified by
scanning every `count(*)` on every router, not only `board`'s:**

```
$ grep -rn "count(\*)" packages/api/src/trpc/routers/*.ts
```

Five procedures aggregate across a foreign-key boundary in some sense, but only three of them are
cross-ROUTER: `board.stats` (counts `board_member` and `meeting`, on the `board` router) and
`board.list`'s `active_member_count` (counts `board_member`, also on `board`) — both closed above.
The other four are same-noun: `agendaTemplate.countForBoard` counts `agenda_template` on the
`agendaTemplate` router, `agendaItem.countByMeeting` counts `agenda_item` on `agendaItem`,
`meetingAttendance.countByMeeting` counts `meeting_attendance` on `meetingAttendance`, and
`boardMember.memberCount` counts `board_member` on `boardMember` itself — each router matches the
table it counts, so `pathFilter()` on that router covers its own aggregate by construction, and the
cross-router shape cannot occur there. There is no sixth router with a `count(*)` this scan missed
(19 router files, this grep's the whole list). So the hazard this item names is real and was worth
naming, but it does not generalize past the three `board.ts` procedures already fixed — the next
wave should not spend a task re-deriving that, only re-run the grep above if a new cross-table
`count(*)` is added to any router.

**Write the pin the same commit a writer's `pathFilter()` call lands, not on a later wave.** These
six calls already exist and already serve an already-migrated screen; deferring the pin to
"whichever wave migrates \[the screen]" is what let a reviewer delete one and get 947 green tests
in the meantime. A wave that adds a new writer against an already-migrated read owes it the pin in
the same commit, for the identical reason.

**`pathfilter-pin-coverage.test.ts` mechanizes this discipline, and its own credit is per TEST FILE,
not per writer inside it — named in wave 3's Task 0.** If a test file imports writer A (and
genuinely asserts `isInvalidated`/`countFor(` about A's own key) and ALSO imports writer B — for any
reason, including one that has nothing to do with B's own `pathFilter()` call — B is credited as
pinned too, purely because the file contains SOME invalidation assertion and SOME import of B.
Proven as a fixture, not asserted: `pathfilter-pin-coverage.test.ts`'s own "credits an unrelated
writer merely for being imported alongside a genuinely-pinned one" test constructs exactly this case
and shows it passes. ~~Not audited against every real writer in the tree to confirm none currently
rides on this hole in practice ... so treat this as a known mechanism limit, not a claim that HEAD is
clean of it.~~ — **audited in wave 3's whole-branch review, and the hole had real occupants.** The
review swept the eighteen `pathFilter()` calls that wave 3's Tasks 3+4 fix round added and found TWO
that turn nothing red: `routes/meetings.$meetingId.agenda.tsx`'s section-REORDER handler (the file was
credited by its add-section pin) and `routes/meetings.$meetingId.live.tsx`'s `agenda_item` Realtime
handler (credited by its `meeting_attendance` Realtime pin). Both are exactly this shape — a second
call inside a file that already had a genuine pin for a different call — and both are now pinned in
their own right, each verified by deletion. So this is a **demonstrated** limit, not a theoretical
one: the credit is per test FILE, and a file's second, third and fourth `pathFilter()` calls ride in
free. **The mechanical check cannot close this; only the deletion sweep two paragraphs up can, so run
it.** Recorded here rather than only in the check's own header because a reader of this document who
never opens that test file should not have to rediscover the limit by tripping over it.

### The floor

If a payload genuinely cannot go through `installTRPCFetchStub`, it still carries
`satisfies inferProcedureOutput<...>` (or `satisfies RouterOutputs["router"]["procedure"]`, which
`packages/web/src/lib/trpc.ts` exports for exactly this). A mocked payload with no `satisfies` is
not reviewable.

**A green vitest run is not a typecheck.** `satisfies inferProcedureOutput<...>` is checked by
`tsc`, not by vitest — vitest transpiles and runs the file without ever evaluating a `satisfies`
clause. Unit 0's own final fix wave shipped two pin tests with an under-typed `setQueryData`
payload: vitest passed both, and only `npx turbo run typecheck --force`, run as its own step,
caught the gap. Run typecheck separately every time; a passing test run says nothing about whether
a payload still matches the procedure's real shape.

---

## 9. The test harness — settled, not left to each file

### QueryClient: use `setupAppQueryClient()`

`packages/web/src/test/render.ts` builds a fresh `QueryClient` per render, but `lib/trpc.ts` binds
its options proxy to the singleton in `lib/queryClient.ts`, and every `clientLoader` calls
`ensureQueryData` on that same singleton. A tRPC screen rendered under a _different_ client has the
loader priming one cache and the component reading another.

Task 4 worked around it by calling `queryClient.setDefaultOptions({...})` on the production
singleton in its own `beforeEach` and never putting them back. Safe only under vitest's per-file
isolation — and about to be copied eighty times. **Decided and implemented in unit 0:**
`renderWithProviders` now takes a `queryClient`, and `setupAppQueryClient()` borrows the singleton
for one file with save/restore on both edges.

```tsx
import { renderWithProviders, setupAppQueryClient } from "@/test/render";

const queryClient = setupAppQueryClient();

renderWithProviders(<BoardDetailPage {...props} />, { route: "/boards/b1", queryClient });
```

It installs `retry: false, staleTime: 0, gcTime: Infinity`, clears the cache before and after each
test, and restores the production defaults in `afterEach`.

**Collection scope, once per file** — the same rule as `installTRPCFetchStub`, enforced the same
way: it registers lifecycle hooks, vitest ignores hooks registered during a running test, and a
silently-skipped `afterEach` here means the production singleton keeps test defaults for the rest
of the process. It throws if called from inside a test body.

`gcTime: Infinity` — not the `0` that `createTestQueryClient()` uses — is deliberate, and the
hazard is subtler than "the test breaks". A per-render client dies with the test, so immediate
collection costs nothing there. Here the cache outlives the render, and an invalidation assertion
reads a query with no observer left: under `gcTime: 0` that entry is already collected and
`getQueryState()` answers `undefined`.

The `.toBe(true)` assertion at the end of such a test fails **loudly** on that — reverting this
line turns both `ArchiveBoardDialog` tests red, which is what protects it. The quiet half is the
**precondition** those tests open with:

```ts
expect(queryClient.getQueryState(detailKey)?.isInvalidated).toBeFalsy();
```

`toBeFalsy()` passes on `undefined` exactly as happily as on a real un-invalidated entry. Under
`gcTime: 0` that line stops witnessing anything at all — it no longer establishes that the entry
was cached and un-invalidated before the write, so the test's later assertion loses the baseline
it was contrasted against. Keep the setting; know which line it is protecting.

Components with no tRPC read may keep using the default fresh client.

### Identity: `vi.mock("@/hooks/useCurrentUser")`, always

**`renderWithProviders`' `user` option does not reach `useCurrentUser()`.** `MockAuthProvider`
publishes its own `AuthContext`, created in `test/mocks/auth-mock.ts`. `useCurrentUser()` calls
`useAuth()` from `@/providers/AuthProvider`, which reads a **different** context object. Passing
`user:` configures a context the component under test never reads.

This is not a hypothesis. Quoting the greps rather than the bare numbers, because the bare numbers
are exactly what drifted here — **three times now**, not twice: this section's own previous count
(17 / 8 / 3) was already stale by the end of this wave, which alone added 18 new test files. Re-run
these before citing them anywhere else; the figures below are current as of `2d78964` and nothing
pins them to stay that way — the commands are what stay true:

```
$ grep -rl "renderWithProviders(" packages/web/src | grep -v test/render.ts | wc -l
35
$ grep -rl 'vi.mock("@/hooks/useCurrentUser"' packages/web/src | grep -v test/render.ts | wc -l
12
$ grep -rl 'vi.mock("@/hooks/useCurrentUser"' packages/web/src | grep -v test/render.ts \
    | xargs grep -l 'vi.mock("@/providers/AuthProvider"' | wc -l
3
```

The second grep, run unfiltered against `test/render.ts`, answers 13 — that file's own doc comment
above quotes the `vi.mock` call as prose, and a bare grep cannot tell a comment from code. Exclude
it. (The first grep needs the same exclusion for the same reason: `render.ts` also quotes
`renderWithProviders(...)` in its own doc comments and defines the function itself, so it matches
without being a caller.)

Of the 35 files that call `renderWithProviders` (up from 17 when this item was first written — this
wave's 18 new test files roughly doubled it), not one reaches `useCurrentUser` through
`MockAuthProvider`: the files that depend on identity mock the hook directly (12 repo-wide, up from
8), and the 3 that also mock `@/providers/AuthProvider` return a literal from `useAuth` rather than
routing to `useMockAuth` — that count has not moved. `useMockAuth` has **zero callers** outside its
own module. `MockAuthProvider` is inert everywhere it is used — see the Known gaps entry below for
what "everywhere" is countable as.

The rule for Phase E is therefore one mechanism, the one that works:

```tsx
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ townId: "town-1" }),
}));
```

Do not add a second. (Retiring `MockAuthProvider` entirely is worth doing, and was not done here.)

---

## 10. The column-parity audit covers props, not just JSX

Task 4 audited every field the screen itself reads and still shipped a regression, because
`ArchiveBoardDialog` read `board.town_id` off an object the screen passed down. `board.detail` does
not select `town_id`; the prop was typed `Record<string, unknown>`, so the read compiled and
produced `""`, invalidating `["boards","byTown",""]` instead of the real list key. An archived
board kept appearing on `/boards` for up to a minute.

**Audit the props you hand to children, not only the JSX in the file you are editing.**

**A child component receiving a tRPC payload must take `inferProcedureOutput<...>`, never
`Record<string, unknown>`.** The bag type is what made it silent.

```ts
// packages/web/src/lib/trpc.ts
export type RouterOutputs = inferRouterOutputs<AppRouter>;

// packages/web/src/components/boards/ArchiveBoardDialog.tsx
interface ArchiveBoardDialogProps {
  board: RouterOutputs["board"]["detail"];
  /** The caller's own town id — NOT read off `board`. */
  townId: string;
  // ...
}
```

Verified by mutation: reintroducing `String(board.town_id ?? "")` is now
`TS2339: Property 'town_id' does not exist on type '{ id: string; name: string; ... }'`.

A caller still on untyped Supabase rows casts at its own call site, visibly and with a comment —
`routes/boards.tsx` does this at two call sites. Never widen the child's prop type back to the bag
to accommodate it; that is reintroducing the bug for every future caller.

---

## 11. Partial migrations need a machine-checkable marker

A file that keeps some Supabase calls because no procedure exists yet must carry a grep-able
token:

```ts
// TODO(phase-e-wave-2): town.detail, agendaTemplate.countForBoard
```

Task 4 left a careful ten-line prose comment and no token, and a completeness sweep would have read
that file as done.

Quote the grep, not the number — the count moves with what you match, which is half the reason
"82 files" drifted for so long:

```
$ grep -rl "@/lib/supabase" packages/web/src | grep -v __tests__ | grep -v '\.test\.' | wc -l
24
$ grep -rl "lib/supabase\|useSupabase" packages/web/src | grep -v __tests__ | grep -v '\.test\.' | wc -l
59
```

(Re-run at Task 5, the close of wave 1: 24 and 59, down from 26 and 63 at Task 2's fix round, which
was itself down from 67 one wave earlier. Quote the grep, not the number, is the rule this drift
itself demonstrates: re-run it rather than trusting any of these three figures.)

Do NOT run `grep -rn "TODO(phase-e-wave" packages/web/src | wc -l` and report the raw number as
"how many gaps remain" — corrected here after the first version of this document did exactly that
and reported **15**, which a reviewer showed measures the wrong thing. That count mixes actual
markers with PROSE MENTIONS of a marker (a header comment saying "see the `TODO(phase-e-wave-2)`
marker below," a test file's own comment citing one) — of the 15, only 8 are lines where the
comment's content actually IS the token, and even that undercounts distinct GAPS by one:
`AddPersonDialog.tsx` carries the identical marker twice (its file-header doc comment at line 14 AND
an inline comment at line 126, both `invitation.insert`) for what is one gap, not two. The
grep that isolates real markers — anchored so the comment's own first word must be the token, not a
sentence mentioning it — answers 8:

```
$ grep -rnE "^[[:space:]]*(//|\*) TODO\(phase-e-wave" packages/web/src | wc -l
8
```

**Written with `[[:space:]]`, not `\s` — every quoted grep in this document that anchors on
leading whitespace now is, and this is why.** `\s` is a GNU/PCRE extension; POSIX ERE (what `git
grep -E` implements) does not recognise it as a shorthand class, so it matches the literal
characters `s` or backslash-then-`s` depending on the tool, which in practice means it matches
nothing useful for this pattern. Measured on this exact command, at this exact commit:

```
$ grep -rnE   "^\s*(//|\*) TODO\(phase-e-wave" packages/web/src | wc -l    # GNU grep, \s
8
$ git grep -nE "^\s*(//|\*) TODO\(phase-e-wave" -- packages/web/src | wc -l # git grep, \s
1
$ git grep -nE "^[[:space:]]*(//|\*) TODO\(phase-e-wave" -- packages/web/src | wc -l
8
```

`git grep -E` silently undercounts by 8× — a reader who runs the `\s` form through `git grep`
(the more common way to reproduce a count in this repo) would conclude the phase is nearly done
when 8 markers remain, not 1. This single character has now produced **nine** wrong counts in this
project's history (the eight the `TODO(phase-e-wave` grep itself produced before this fix, plus the
board-scoped-guard census below, which carried the identical `\s` and was never itself run through
`git grep` to notice). `[[:space:]]` is honoured by both POSIX ERE and GNU/PCRE, answers
identically under `grep -E` and `git grep -E`, and is what every quoted grep in this document uses
from this point on — including the two `requireBoardPermission`/`requireBoardActor` census
commands later in this item, which carried the same `\s` and are fixed the same way. wave 5, Task 7
had already caught this once, locally, for one grep (the `AppShell.tsx` re-run below already notes
it) but the fix was never propagated to the canonical pattern this item opens with, or to the other
`\s`-anchored greps in the document — exactly the kind of drift item 14 exists to catch, found here
by re-deriving the count rather than trusting the prose.

**Stale as of wave 2's own final fix round — corrected here, and timestamped the way item 9
timestamps its greps (item 9: "current as of `2d78964`"); this enumeration read as current and was
not.** The 8-lines-7-gaps count above was wave 2 Task 4's snapshot and drifted the same task it was
written in: `boards.$boardId.tsx`'s `agendaTemplate.countForBoard` and `ProgressChecklist.tsx`'s
`boardMember.countByTown` both closed (Tasks 2 and 3 respectively — before this enumeration was even
written), `StaffAccountFlow.tsx`'s `board.listByTown` marker closed the same way (Task 3), and
`settings.town.tsx`'s `board.byTown` marker closed too (its own Known-gaps entry above already says
so). Re-run at HEAD, this fix round's own commit (`bb60e295b8ebc81e26a03206dcac6aaa6548c8ed`):

```
$ grep -rnE "^[[:space:]]*(//|\*) TODO\(phase-e-wave" packages/web/src | wc -l
6
```

Those 6 lines name 5 distinct gaps: `AddPersonDialog.tsx` (`invitation.insert`, marked twice),
`home.tsx` (`meeting.byTown` / `minutesDocument.pendingByTown` / `board.listActive` — exists, not
wired here, see the Known-gaps bullet below), `boards.$boardId.templates.$templateId.edit.tsx`
(`agendaTemplate.detail` / `agendaTemplate.update` — a marker this same review round added; see its
Known-gaps entry below), `boards.$boardId.tsx` (`town.detail` — exists, not wired here; this
review round restored the marker after closing the file's other gap silently dropped it, see its
own Known-gaps entry below), and `people.tsx` (`boardMember.listByTown`). Whether the count is 15,
8, 7, 6, or 5 depends entirely on what you constrain the grep to and when you ran it — quote the
grep AND the commit, always, and prefer describing the gaps by name (as the bullets below do) over
reporting a bare count that a reader cannot check without also re-deriving which lines you meant.

**Re-run again in wave 3's Task 1 fix round, per that round's own L5 finding: this enumeration was
correct as of `bb60e295` but the review's own new markers moved it before this paragraph was
updated — the identical drift item 14 exists to catch, one wave later.**

```
$ grep -rnE "^[[:space:]]*(//|\*) TODO\(phase-e-wave" packages/web/src | wc -l
22
```

22 lines, up from 6 — and the growth is markers ADDED to files that already had the gap, not new
gaps created: wave 3 Task 0 added `CreateMeetingDialog.tsx`'s and `templates.tsx`'s (both named in
that task's own brief, discussed above), and Task 1's fix round added `CancelMeetingDialog.tsx`,
`meetings.tsx`, `boards.$boardId.meetings.tsx` and `meetings.$meetingId.tsx` — four files whose raw
Supabase reads/writes item 11's sweep had been reading as "done" only because they carried no token,
exactly the hole this item exists to close. `CancelMeetingDialog.tsx`'s marker is qualitatively
different from the others: its raw write has NO authorization check at all today (tenancy-only RLS),
not a completeness gap alone — see that file's own marker and `meeting.ts`'s header, "`updateStatus`:
the gap the review round found," for the sibling case in `meetings.tsx`. `home.tsx`'s own marker
count DROPPED by one within this same span (`meeting.byTown` closed, retagged `phase-e-wave-6` — see
its own Known-gaps entry) — both directions happened in the same fix round, which is exactly why
"quote the grep, not the number" stays the rule rather than trying to memorise a running total.

**Re-run at wave 3 Task 2 (`c34b987`), its fix round (`1b1d635`), and Task 3's own close-out
(`0643553`) — the identical drift item 14 exists to catch showed up again in between: this
paragraph stopped at Task 1's fix round and was never updated across Task 2, even though Task 2's
own progress note already recorded the numbers.**

```
$ grep -rnE "^[[:space:]]*(//|\*) TODO\(phase-e-wave" packages/web/src | wc -l
11   # at c34b987 — Task 2 closed CancelMeetingDialog.tsx's and meetings.tsx's raw-write
     # authorization holes (both markers named `updateStatus`/the kanban gap above)
20   # at 1b1d635 — Task 2's fix round re-tagged four writers newly implicated by adding
     # `meetings: "meeting"` to cache-key-parity's MIGRATED map (item 7): MeetingStartFlow.tsx,
     # PublishAgendaDialog.tsx, meetings.$meetingId.agenda.tsx, meetings.$meetingId.live.tsx —
     # each got a `TODO(phase-e-wave-4/5)` marker for a `meeting` write that was already
     # unauthorized before this fix round and still is; only the missing invalidation the
     # MIGRATED entry flagged was in scope to close
17   # at 0643553 — Task 3 discharged `meetings.$meetingId.tsx`'s own three
     # `TODO(phase-e-wave-3)` markers (the header comment and both inline `meeting.detail`
     # citations) by migrating the file's nine reads onto tRPC in full — see this wave's
     # Task 3 report
```

```
17   # unchanged in wave 3 Tasks 3+4's fix round — that round added eleven
     # `pathFilter()` invalidations and eight pin tests but closed no
     # Supabase read and opened no new gap, so no marker moved in either
     # direction. Recorded rather than left silent: "the number did not
     # change" is itself a re-run result, and the alternative is a reader
     # assuming the enumeration simply was not checked.
18   # after the whole-branch fix round. The one added marker is
     # `routes/meetings.$meetingId.minutes.tsx`'s
     # `TODO(phase-e-wave-6): minutesDocument.detail / the minutes status
     # writes` — the countdown going UP because a gap that was already there
     # got NAMED, which this item's own closing paragraph says is legitimate.
     # That file was reached only for its missing `pathFilter()` invalidation
     # (see the Known-gaps bullet); every read and write on it is still raw
     # Supabase, and item 11's sweep had been reading it as done purely
     # because it carried no token. Same hole as the four files Task 1's fix
     # round re-tagged.
13   # at the end of Phase E wave 4, Task 0 — down from 18, and now with
     # ZERO `phase-e-wave-2` markers left in the tree
     # (`grep -rnE "^[[:space:]]*(//|\*) TODO\(phase-e-wave-2\)" packages/web/src`
     # answers empty). Task 0 closed all four of wave 2's leftover markers —
     # `boards.$boardId.tsx` (`town.detail`), `people.tsx`
     # (`boardMember.listByTown`), `AddPersonDialog.tsx` (`invitation.insert`,
     # which carried the marker twice) and
     # `boards.$boardId.templates.$templateId.edit.tsx`
     # (`agendaTemplate.detail`/`agendaTemplate.update`) — removing 5 marker
     # lines (18 − 5 = 13), and opened no new gap: the five lines removed are
     # exactly the five this task's own brief named, no more and no less.
14   # at 5d11393, the close of Phase E wave 4, Task 2 — UP by one from
     # Task 0's 13, and legitimately so (this item's own closing paragraph:
     # a task may raise the count by NAMING a gap that was previously
     # silent). `ExhibitUploader.tsx` gained its first marker ever, for the
     # raw `handleAddUrl` insert that item 11's sweep had been reading as
     # done purely because the file carried no token; and
     # `PublishAgendaDialog.tsx`'s existing marker had its CLAIM corrected
     # rather than removed — it said no procedure existed, which stopped
     # being true in Task 2's first commit. Neither file is wired yet; Task
     # 3 owns that.
12   # at 24bfcd4, the close of Phase E wave 4, Task 3 — DOWN two from
     # Task 2's 14, and the two removed are exactly the two Task 2 named:
     # `PublishAgendaDialog.tsx`'s (`meeting.publishAgenda`, now wired) and
     # `ExhibitUploader.tsx`'s (`exhibit.link`/`exhibit.byMeeting`, now
     # wired). No marker was ADDED: `routes/meetings.$meetingId.agenda.tsx`,
     # `AgendaSection.tsx`, `InlineItemForm.tsx`, `AgendaItemRow.tsx` and
     # `ExhibitRow.tsx` all reach zero raw Supabase calls in the same task,
     # so none of the five needed one. `InlineItemForm.tsx` is the one worth
     # naming: it had NEVER carried a marker despite three raw, unauthorized
     # `agenda_item` writes (its delete was three unwrapped round trips), so
     # item 11's sweep had been reading it as done — the exact hole this
     # item exists to close, found by a task brief rather than by the grep.
 6   # at cd10b54, the close of Phase E wave 4, Task 4 — DOWN six from
     # Task 3's 12, and now with ZERO `phase-e-wave-4` markers left in the
     # tree (`grep -rnE "^[[:space:]]*(//|\*) TODO\(phase-e-wave-4\)" packages/web/src`
     # answers empty; the 6 that remain are all wave-5/6). The six removed
     # are exactly the six on this task's own two files:
     # `CreateMeetingDialog.tsx` carried FOUR (a header line plus three
     # inline) for three gaps, and `routes/templates.tsx` TWO (header plus
     # inline) for one. No marker was added: both files reach zero raw
     # Supabase calls, and `lib/meeting-helpers.ts` — which never carried a
     # marker at all despite being the live create-from-template writer — is
     # deleted rather than marked.
 6   # unchanged again at 59d8f91 (wave 5, Task 4's close-out) — the same six
     # lines. (Anchored to `dcb12e4` when first written, which is the
     # PRE-AMEND sha of `c8bd764` and is reachable from nothing: item 11 asks
     # for the grep AND a commit that exists, and a sha that has been rebased
     # or amended away fails the second half silently. Re-run and unchanged at
     # `59d8f91`, which is on the branch.) Task 4 REWROTE `meetings.$meetingId.live.tsx`'s marker rather
     # than discharging it (its reads are all tRPC now; its WRITES are Task
     # 5's, and the marker names them), and left MeetingStartFlow.tsx's
     # alone for the same reason. A marker whose claim changes without its
     # count moving is exactly the case item 14's "the unit of staleness is a
     # CLAIM, not a file" covers, so it is recorded here rather than passed
     # over as "no change". The other two greps this item tracks DID move, in
     # the direction the phase wants:
     #   $ grep -rl "@/lib/supabase" packages/web/src | grep -v __tests__ \
     #       | grep -v '\.test\.' | wc -l      -> 15   (24 at wave 1's close)
     #   $ grep -rl "lib/supabase\|useSupabase" packages/web/src \
     #       | grep -v __tests__ | grep -v '\.test\.' | wc -l  -> 32  (59 then)
 6   # unchanged at fb3a5cd (wave 5's own base) and at 1ef127a (wave 5,
     # Task 0's own commit) — re-run per item 14's close-out, and neither
     # wave 4's fix round nor the wave-5 plan commit nor Task 0's own two
     # files touched a Supabase read/write this item tracks. The 6 lines:
     # MeetingStartFlow.tsx and meetings.$meetingId.live.tsx (both
     # wave-5), home.tsx, meetings.tsx (x2) and
     # meetings.$meetingId.minutes.tsx (all wave-6).
 4   # at 01ff3ab, the close of Phase E wave 5, Task 5 — DOWN two, and now
     # with ZERO `phase-e-wave-5` markers left in the tree
     # (`grep -rnE "^[[:space:]]*(//|\*) TODO\(phase-e-wave-5\)" packages/web/src`
     # answers empty; all 4 that remain are wave-6). The two removed are
     # exactly the two this task's own files carried,
     # `MeetingStartFlow.tsx` and `meetings.$meetingId.live.tsx`, and both
     # are removed for the same reason: every write in each is a procedure
     # now and neither file imports `@/hooks/useSupabase` any more. Each
     # marker survives as STRUCK-THROUGH prose in its file's header, which
     # the anchored grep correctly does not count — the comment's first word
     # is `~~TODO(`, not `TODO(`, and that is the distinction the anchor
     # exists to make. No marker was added: the eight component files this
     # task also converted reach zero raw Supabase calls, so none needed one.
     # The other two greps this item tracks:
     #   $ grep -rl "@/lib/supabase" packages/web/src | grep -v __tests__ \
     #       | grep -v '\.test\.' | wc -l      -> 15   (unchanged at 59d8f91:
     #     not one file in this wave imported that module directly; they all
     #     reached the same client through `useSupabase`)
     #   $ grep -rl "lib/supabase\|useSupabase" packages/web/src \
     #       | grep -v __tests__ | grep -v '\.test\.' | wc -l  -> 25  (32 then)
 5   # at 670d9df, the close of Phase E wave 5 (Task 7) — UP one from Task
     # 5's 4, and legitimately so, by this item's own rule that a task may
     # raise the count by NAMING a gap that was previously silent. The added
     # line is `layouts/AppShell.tsx`'s `TODO(phase-e-wave-6): meeting.liveByTown`,
     # for the `useLiveMeetingId` raw Supabase read that had sat unmarked
     # through four waves; Task 6 added it while deleting that file's Supabase
     # heartbeat. All 5 remaining lines are wave-6
     # (`grep -rnE "^[[:space:]]*(//|\*) TODO\(phase-e-wave-5\)" packages/web/src`
     # answers empty, as it has since 01ff3ab):
     #   layouts/AppShell.tsx (meeting.liveByTown)
     #   routes/home.tsx (minutesDocument.pendingByTown, board.listActive)
     #   routes/meetings.tsx x2 (board.listActive)
     #   routes/meetings.$meetingId.minutes.tsx (minutesDocument.detail)
     # Note the grep is written with `[[:space:]]`, not `\s`: `git grep` is
     # POSIX ERE and silently matches nothing for `\s`, which has produced
     # eight wrong counts in this project. The other two greps BOTH moved,
     # and Task 6 is the whole of the movement:
     #   $ grep -rl "@/lib/supabase" packages/web/src | grep -v __tests__ \
     #       | grep -v '\.test\.' | wc -l      -> 14  (15 at 01ff3ab)
     #   $ grep -rl "lib/supabase\|useSupabase" packages/web/src \
     #       | grep -v __tests__ | grep -v '\.test\.' | wc -l  -> 23  (25 then)
     # Re-derived against `git archive 670d9df`, not against the working tree
     # and not from any task report — which matters this time, because this
     # task's Part 1 temporarily edited two tracked files and restored them.
 0   # at 43c2963, the close of Phase E wave 6, Task 5 — ZERO, for the first
     # time since this countdown was written. Re-derived, not carried over:
     # the wave's base (`e2cae4a`) had SEVEN lines, not the five this log
     # listed at 670d9df — the three board writers below acquired theirs in
     # the fix round after wave 5's review (finding L8), after this entry was
     # written, and `meetings.tsx` carries two lines for one gap:
     #   $ git grep -nE "^[[:space:]]*(//|\*) TODO\(phase-e-wave" e2cae4a -- packages/web/src
     #   ArchiveBoardDialog.tsx  MinutesWorkflowEditor.tsx
     #   NoticeTemplateEditor.tsx  AppShell.tsx  home.tsx  meetings.tsx x2
     # All seven are Task 5's own files and all seven are discharged. Each is
     # struck through in place (`~~TODO(...)~~ — closed in wave 6, Task 5`)
     # rather than deleted; the anchored grep correctly does not count a
     # `~~TODO(` line, which is the distinction the anchor exists to make (see
     # the 01ff3ab entry above). No marker was ADDED: all twelve of Task 5's
     # files reach zero raw Supabase calls.
     #
     # **Zero markers is NOT the definition of done, and this countdown is
     # the wrong measure to celebrate it with** — Task 0 of this wave found
     # seven files with real, unmarked Supabase code that the countdown was
     # structurally incapable of seeing, and Task 5 closed exactly those
     # seven (plus five more). The measure that matters is the IMPORT grep
     # below:
     #   $ git grep -l 'from "@/lib/supabase"\|from "@/hooks/useSupabase"\|@supabase/supabase-js' \
     #       -- packages/web/src | wc -l   -> 2  (17 at e5250ad)
     # and the two are `lib/supabase.ts` and `hooks/useSupabase.ts`
     # themselves, which Task 6 deletes. The other two greps this item
     # tracks, for continuity:
     #   $ grep -rl "@/lib/supabase" packages/web/src | grep -v __tests__ \
     #       | grep -v '\.test\.' | wc -l      -> 5   (14 at 670d9df)
     #   $ grep -rl "lib/supabase\|useSupabase" packages/web/src \
     #       | grep -v __tests__ | grep -v '\.test\.' | wc -l  -> 11  (23 then)
     # Both residues are comment-only prose plus the two modules — the
     # comment-versus-code hazard this item names two paragraphs down, now
     # the ONLY thing either mention grep is still counting.
```

**Wave 6, Task 0 — the marker grep is not the measure that matters, and re-deriving the "23 files"
headline by hand found the sweep is wrong in three different directions at once.** The task's own
brief quoted item 11's SECOND grep (the "honest denominator," `lib/supabase\|useSupabase`) at **23**
remaining files. Re-run at HEAD (`e5250ad`):

```
$ grep -rl "lib/supabase\|useSupabase" packages/web/src | grep -v __tests__ | grep -v '\.test\.' | wc -l
23
```

Confirmed. But 23 answers "how many files mention the string," which is not "how many files still
depend on the client," and not "how many gaps item 11's own token sweep is silently missing" either
— three different questions this one number gets asked to answer.

1. **One of the 23 is comment-only prose in a file the anchored TOKEN grep never claims to cover:**
   `src/test/render.ts` matches only because its own doc comment quotes
   `vi.mock("@/lib/supabase")` as an example for other files to copy (line 142) — it imports nothing
   from either module itself.
2. **Six more are comment-only prose in files that HAVE been migrated**, each carrying a header that
   narrates the fact rather than a live import: `MeetingStartFlow.tsx` ("this file's writes are all
   still raw Supabase … this" — struck through, in its own header), `CreateMeetingDialog.tsx`
   ("`lib/supabase.ts`'s own header"), `useQuorumCheck.ts` ("migrated off `@/lib/supabase` onto
   tRPC"), `lib/trpc.ts` ("`lib/supabase.ts` is being removed"),
   `routes/meetings.$meetingId.agenda.tsx` ("`@/lib/supabase` is gone from it"), and
   `routes/meetings.$meetingId.live.tsx` ("`useSupabase`, and the adjournment write's total
   absence…"). Verified individually, not assumed from the grep alone: each file's only match is a
   prose sentence, confirmed by reading it. So 22 of the 23 have a live dependency; 16 do, once the
   six migrated headers are also excluded.
3. **Four of the remaining sixteen carry no `TODO(phase-e-wave` token at all, despite live, unwrapped
   Supabase code — the exact hole this item exists to close, still open at HEAD:**
   `CommandPalette.tsx` and `MeetingSubnavHeader.tsx` (`import { supabase } from "@/lib/supabase"`,
   live reads, no marker, no header comment mentioning Phase E at all), `EditBoardDialog.tsx` (a raw
   `count` query against `meeting` at its own line 82, sitting in a file whose header otherwise
   narrates a `board.update` migration as if the file were fully converted), and
   `boards.$boardId.templates.$templateId.edit.tsx` (a raw `board` name lookup at its own line 73,
   in the exact file this item's own log above records as "**closed** in Phase E wave 4, Task 0" —
   that entry closed the template read/write pair and never re-checked the file for anything else).
   Anchored `grep -n "TODO(phase-e-wave" <file>` answers empty for all four, confirmed directly, not
   inferred from the countdown.

   **Re-deriving this by hand past the brief's own four found three more of the identical shape it
   did not name**, because the brief's own diagnosis is limited to the files it happened to sample:
   `AddPersonDialog.tsx` and `EditPersonDialog.tsx` each carry a live raw `person` table read (an
   email-uniqueness check, `.eq("email", email).limit(1)`) behind a `useSupabase()` call with no
   marker, sitting in files whose own header comments narrate their WRITES as migrated
   (`person.insert`/`person.insertStaffAccount`/`invitation.insert` for the first,
   `person.update` for the second) and say nothing about the read that remains; and
   `SourceDataPanel.tsx` is unwrapped raw Supabase for every one of its reads, with no header comment
   at all — **this item's own section mentions the file zero times, not once as first written here.**
   (`git show e5250ad:docs/superpowers/plans/phase-e-conventions.md | grep -n SourceDataPanel` finds
   two pre-task mentions, and both sit outside item 11 entirely: one in item 14's wave-5 close-out
   history, one in the Known-gaps list below — neither is "an unrelated context within item 11,"
   because neither is within item 11 at all.) So it was never named as an unmigrated screen anywhere
   in this document, in or out of item 11, until now. **The corrected count is seven files, not four**,
   all confirmed by reading the file
   directly rather than trusted from either number: `CommandPalette.tsx`, `MeetingSubnavHeader.tsx`,
   `EditBoardDialog.tsx`, `boards.$boardId.templates.$templateId.edit.tsx`, `AddPersonDialog.tsx`,
   `EditPersonDialog.tsx`, `SourceDataPanel.tsx`. An eighth candidate,
   `routes/meetings.$meetingId.review.tsx`, carries the same no-token, all-raw shape but is not
   counted with the other seven, because it is not silent the way they are — this document names it
   as a still-raw, wave-6-owned screen in at least four other places (item 7's "the legacy line
   stays," item 8's `pathfilter-pin-coverage` discussion, and two of Task 3's own open-items lists) —
   so a reader of this DOCUMENT, as opposed to a reader of only its token countdown, already knows.
   The other seven have no such standing mention anywhere in this file; the token sweep is the only
   place a reader would look, and it says nothing.

**Why a mention grep and an import grep disagree, and why that gap is exactly where the four (now
seven) unmarked files hide.** `grep -rl "lib/supabase\|useSupabase"` matches the STRING anywhere in
a file — a doc comment quoting the module name, a header narrating a past migration, a real `import`
— and cannot distinguish them; that is what items 1 and 14 call the comment-versus-code hazard for
every other grep in this document, and it applies here with the same force. **The measure that
answers "does this file still depend on the client" is an import grep**, because an import is the
one thing the phase's own definition of done (`lib/supabase.ts` deleted turns any remaining
dependency into a build error) actually cares about:

```
$ git grep -l 'from "@/lib/supabase"\|from "@/hooks/useSupabase"\|@supabase/supabase-js' -- packages/web/src | wc -l
17
```

17, not 23 — 16 real consumers plus `lib/supabase.ts` itself (which necessarily imports
`@supabase/supabase-js`; it is the module the other 16 import FROM, not a 17th dependent). Of those
16, this item's anchored token grep already knows about 7 (the files carrying a live
`TODO(phase-e-wave` marker: `ArchiveBoardDialog.tsx`, `MinutesWorkflowEditor.tsx`,
`NoticeTemplateEditor.tsx`, `AppShell.tsx`, `home.tsx`, `meetings.$meetingId.minutes.tsx`,
`meetings.tsx`) and one more this document names in prose elsewhere without a token
(`meetings.$meetingId.review.tsx`). **The remaining eight account for the rest: the seven real,
silent gaps this task found, plus `useSupabase.ts` itself**, which is infrastructure rather than a
screen and needs no marker of its own, the same as `lib/supabase.ts`. An import grep cannot tell you
WHICH lines are unmigrated inside a partially-converted file (that is what the token exists for,
scoped per-gap rather than per-file); a mention grep cannot tell you whether a file has any live
dependency at all. Between them, an import grep is the correct DENOMINATOR (how many files still
truly depend on the client) and the token grep is the correct NUMERATOR only for the files that
bothered to mark themselves — which is exactly why a file with real, unmarked code invisibly drops
out of the numerator while staying in a correct denominator, and why checking the two against each
other is what surfaces it. None of the seven newly-named files had a token to begin with, so none of
item 11's own countdown numbers above are wrong on their own terms — the countdown was always
counting real markers correctly; it was never capable of noticing a file with no marker to count,
which is the same class of blind spot item 14 names for prose claims and this item now names for
itself.

Whether the count is 22, 20, 17, 13, or something else by the time this is read depends entirely on
what closed since — quote the grep, not the number, still the rule four tasks later.

This countdown is not monotonic within a wave regardless of which grep measures it — a task can
legitimately raise it by naming a gap explicitly that was previously silent (Task 5 added
`ProgressChecklist.tsx`'s `memberCount` gap while closing `home.tsx`'s town-header read). It only has
to reach zero once `packages/web/src/lib/supabase.ts` itself is deleted (see this item's own closing
paragraph); tracking it per-task is for visibility, not for proving progress every single time.

The second is the honest denominator: `useSupabase()` is a one-line re-export of the same client,
and a file reaching it that way is no more migrated than one importing directly.

Track `grep -rn "TODO(phase-e-wave" packages/web/src` as a countdown to zero. It reaches zero at
the same moment `packages/web/src/lib/supabase.ts` is deleted, which is the phase's real
definition of done — with the client gone, a screen that still depends on it is a build error
rather than a silent zero-row read.

---

## 12. Which error surface is canonical

Both surfaces are needed, and they handle different moments:

| Surface                     | Handles                                                                                                                                                                                              | Where                                                                                                                    |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `RouteErrorBoundary`        | A rejection **before mount** — the `clientLoader`'s `ensureQueryData` throwing NOT_FOUND for a deleted or foreign row. There is no component yet, so there is no in-component branch to run.         | `export { RouteErrorBoundary as ErrorBoundary }` at the bottom of the route module. Let the loader reject; do not catch. |
| In-component `role="alert"` | A failure **after mount** — a refetch, a `staleTime` expiry, a query the loader did not prime (`stats`, `recentMeetings`), a tab-gated query firing later. The boundary is not re-entered for these. | The `isBoardError` branch of item 5.                                                                                     |

A migrated screen ships **both**. Neither substitutes for the other, and eighty screens will
diverge if each author picks one.

---

## 13. The rule that outranks the rest

**For every security-relevant assertion, delete the guard and watch the test go red before
believing it.** Then restore it and diff byte-identical.

This is a live habit in this repo because the alternative has already happened here, four times:

1. A `notification-service` suite written on a mock that could not express the bug it covered.
2. `lib/push.ts` mocked wholesale, leaving zero executed coverage of the module under test.
3. A portal search test whose fixture made its assertion vacuous.
4. An admin-gates test that iterated the very list it was testing, so it agreed with itself.

Unit 0 added a fifth to the list before it was fixed: 940 tests that could not notice a deleted
cache invalidation (item 8).

A sixth, also from unit 0's own final fix wave: two pin tests carried an under-typed `setQueryData`
payload, and vitest passed both. A green vitest run is not a typecheck — vitest never evaluates a
`satisfies` clause, it only runs the code around it. Only `npx turbo run typecheck --force`, run as
its own step, caught the gap (see item 8's floor). Believing "tests pass" without also running
typecheck is the same mistake as believing a mutation went red without watching it happen.

A rewritten test is not a migrated test. The remaining Supabase-mocking test files are
**rewritten**, not adapted — an adapted chainable mock is how each of the four above began.

Mutations performed in unit 0, all red then restored:

| Guard deleted or changed                                         | Result                            |
| ---------------------------------------------------------------- | --------------------------------- |
| `isBoardError` render branch                                     | `Unable to find role="alert"`     |
| `ArchiveBoardDialog`'s `trpc.board.pathFilter()` line            | invalidation test red             |
| `queryKeys.boards.byTown(townId)` → `byTown("")`                 | legacy-key test red               |
| `trpc.board.pathFilter()` → `trpc.town.pathFilter()` in the test | `expected 1 to be greater than 1` |
| `name:` → `nayme:` in a stub payload                             | `TS2322`                          |
| `"board.stats"` → `"board.statz"`                                | `TS2353`                          |
| a pinned procedure renamed in the router                         | `router-wiring.test.ts` red       |
| `board.town_id` reintroduced in `ArchiveBoardDialog`             | `TS2339`                          |
| `assertCollectionScope` guard removed from the stub              | scope test red                    |
| the stub's per-test call-log reset removed                       | `expected 2 to be 1`              |
| the stub's `afterEach` fetch restore removed                     | `afterAll` red: `[Function Mock]` |

Two of those were found by mutating something that had just been written and was passing. The
`TestHandlers` type originally keyed off `AppRouter["_def"]["procedures"]` directly: it compiled,
the tests passed, and it checked **nothing** — that type is nested, so `"board.detail"` was never
a key and `inferProcedureInput` of a sub-router is `never`. The tell was the error message naming
`board` rather than `board.detail`. The harness scope bug was the same shape: green, and untrue.

A seventh, from Task 2's fix round (wave 1): the same wave's own regression-pin test for
`town.updateProfile` asserted `BAD_REQUEST` on input that failed to parse, and "delete the guard
and watch it go red" was never actually run against it before it shipped. A reviewer ran it: with
`assertCanUpdateTown` deleted entirely, the test **stayed green**, because the parser alone still
answers `BAD_REQUEST` for bad input whether or not a guard exists to run first. This is what item 2
now states as the general rule and repeats here because test discipline is where people look for
it: **a refusal test must assert `FORBIDDEN`, full stop.** Not "on input that parses" — that
qualifier was itself an over-correction from the same fix round (see item 2), and stated as an
absolute it would have forbidden the very test that fixes this: the reorder pin below is built on
input that does NOT parse, on purpose, because that is the only way to catch a guard declared after
`.input()` instead of before it.

**A guard can be deleted-and-caught while still being misplaced, and item 13's own mutation does
not by itself tell the two apart.** Deleting a guard proves it existed. It says nothing about WHERE
it was declared, because deletion removes the guard from both a correctly-ordered and a
wrongly-ordered procedure identically. The same reviewer proved this on `town.updateProfile`
directly: moved its `.use(requireActor(...))` from before `.input()` to after it — reproducing the
exact shipped defect on live code, not a synthetic router — and ran the whole API package.
**42 files, 565 tests, all green.** Every existing refusal test on that procedure used input that
parses, so none of them could see the reorder; the parser still ran and, for valid input, still
succeeded either way. The fix was a SECOND kind of pin, not a stronger version of the first: a test
whose input does NOT parse, so that a guard which no longer runs before the parser is answered by
the parser (`BAD_REQUEST`) instead of the guard (`FORBIDDEN`) — see `town.updateProfile`'s "answers
FORBIDDEN even when a refused caller's input also fails validation (the reorder pin)" in
`packages/api/src/trpc/routers/__tests__/town.test.ts`, and the equivalent in
`require-permission.test.ts`'s synthetic router. Verify a reorder pin the way the deletion pin is
verified — move the `.use()` after `.input()`, confirm the specific test (and only that shape of
test) goes red, restore.

If your mutation does not go red, you have not written a test. You have written a comment that
runs.

**A red gate run leaks a scratch database, invisibly, and this is a standing property of the
harness — not a wave-5 anecdote.** `npx turbo run test --force` runs the web and api packages as
sibling turbo tasks. When the web task fails, turbo **kills** the still-running api task rather
than waiting for it to finish; every api test opens its Postgres scratch database inside
`withTestDb`, whose teardown runs in a `finally`, and a kill means that `finally` never executes.
This is a different mechanism from the vitest-force-kills-a-timed-out-test leak documented in item
2's reentrancy-guard discussion above — that one kills a single hung test from inside the same
process; this one is turbo killing an entire sibling task from outside it — and the ordinary "check
for a stray connection" instinct finds nothing here: no backend survives the kill, so
`pg_stat_activity` shows **zero** rows on the leaked database whether or not it leaked. The check
that actually sees it is

```
SELECT datname FROM pg_database WHERE datname LIKE 'tmm_test%';
```

run after **any** red `npx turbo run test`, not only once the suite finally goes green. Wave 5,
Task 5's fix round reproduced it directly: a forced-red web task left the api task's output
stopped mid-run with not one test result printed, one scratch database with zero
`pg_stat_activity` backends on it; the task itself had accumulated 27 the same way across two
earlier red runs before this was known to check for. Leak size scales with how far the api task got
before the kill, so the count itself is not diagnostic — the query is. Every future red
`turbo run test`, in wave 6 and beyond, leaks the same way; check `pg_database`, not the backend
count, every time.

**A turbo test run can go red at exit 1 while every assertion in it passed, and this is a third
hazard of exactly this species, not a wave-6 anecdote either.** Wave 6, Task 5 shipped
`ArchiveBoardDialog.handleArchive` and `EditBoardDialog.handleSave` calling `await mutateAsync(...)`
inside a handler the button invoked as `void handler()` — the returned promise was discarded, so a
refusal (or any rejection) inside either handler became an unhandled promise rejection. `npx vitest
run` on the single file prints "2 errors" underneath its own green `Tests … passed` summary line —
easy to miss, since the line a developer's eye goes to first is still green. `npx turbo run test`,
run across the whole monorepo the way the gates require, reports the same thing as a **failed
task** at process exit 1, with `Tasks: N successful, M total` naming one fewer success than the
task count — the number the CI-order gate list singles out for exactly this reason. Grepping a
turbo run's output for `Tests |Test Files ` and calling that green is not a sufficient check: both
of those lines can read entirely clean while the task itself exited red. Read the `Tasks:` line, or
the process exit code, not only the per-file test counts — a third mechanism, alongside the leaked
scratch database just above, that produces the same "the summary you'd normally check reads green
and the run is not" shape for a different underlying reason.

**A retry policy is a harness hazard too, not only a mock — it can mask a real defect as
completely as any of the above, with no test and no mock involved at all.** Wave 5, Task 7 found
Fastify's default `maxParamLength` (100) 404ing the live meeting screen's six-procedure
`httpBatchLink` batch (`/api/trpc/exhibit.byMeeting,...` at ~151 characters) — a real defect, on
every load, in production. Task 6's browser check still recorded PASS: `QueryClient`'s
`retry: 2` retried each failed query independently, and by the time it did, the set of
still-in-flight queries had changed, so the retried batch was smaller and fit under 100 characters.
The screen rendered completely. **Nothing a developer would normally look at said otherwise** — no
console error (a 404 status on a `fetch` is not a thrown exception `httpBatchLink` surfaces as
one), no toast (nothing in this app's error-categorization path treats a transparently-retried
success as a failure worth reporting), no failing test (no test in the repository drove a real
batched HTTP request before `http-batch.test.ts` — item 8's "mock the transport" convention means
even the web suite's own tests stub `httpBatchLink` away entirely). The only places it was visible
at all: the Network tab, as a 404 request a retry immediately followed with a 200; and the API's
own request log, at `info` level, indistinguishable from any other 404 unless someone were already
looking for one. A retry policy that quietly re-shapes a failing request into a passing one is, for
observability purposes, exactly as dangerous as a mock that cannot express the bug it covers — the
fix is the same discipline item 13 already asks for: drive the real transport directly (a real
Fastify server, a real batched `fetch`, as `http-batch.test.ts` and `sse-bounds.test.ts` both do),
because a retry-smoothed browser check and a stubbed-transport unit test fail to see this defect
for the same underlying reason — neither one drives the real request shape past the real server.

---

## 14. The close-out step: re-check every Known-gaps bullet against HEAD

Added in wave 2's final whole-branch review, after that review found **four of the five most
recent Known-gaps bullets stale — three of them CLOSED and still described as open**
(`boards.$boardId.tsx`'s agenda-template half, `ProgressChecklist.tsx`'s `memberCount`,
`StaffAccountFlow.tsx`'s board picker) and one actively **wrong** rather than merely outdated
(`home.tsx`'s board-picker bullet kept insisting no archived-filtered procedure existed after
`board.listActive` shipped and was already wired into the identical gap one file over). A fifth
bullet — item 11's own marker enumeration — was stale in the same review for the identical reason:
it quoted a marker count that had already moved by the time it was written.

**The root cause is structural, not a discipline lapse a reminder fixes.** Every task in this wave
amended `phase-e-conventions.md` when its OWN work touched a bullet — closing the bullet it was
told about, adding the bullet its own file's remaining gap needed. No task's job was ever "does
anything ELSE in this document describe my work as still open." A bullet written by Task N about a
file Task N did not finish stays exactly as Task N left it, word for word, until something
_deliberately_ re-reads it against the current tree — and nothing in the per-task workflow asked
anyone to do that, so it did not happen, four times in a row, across three different tasks' own fix
rounds.

**The step:** before ending a task (or a fix round) that touches `phase-e-conventions.md`, or before
closing out a wave, re-read every bullet under "Known gaps this document does not close" against
HEAD — not against memory, not against what the task itself changed — and retire (with the
`~~strikethrough~~ ... closed in Task N` pattern already used throughout this document) any bullet
this wave's work closed, whether or not the task that closed it was the one that wrote the bullet.
A bullet is stale exactly as easily by someone else's fix landing nearby as by the task that named
it forgetting to update it — check the file, not the diff.

**Sharpened in wave 3, Tasks 3+4's fix round, because the step as written above was RUN and still
missed one.** Task 4's close-out sweep reported "none went stale because of this task's work," and
that was wrong: Task 3 had created `packages/api/src/trpc/routers/minutes-document.ts` one commit
earlier, and the `home.tsx` bullet's sentence "`minutesDocs` still has no router at all" had been
false ever since. The sweep missed it because of how it selected which bullets to re-read — it looked
for bullets that MENTION the files the task touched, and that bullet mentions `home.tsx`, a file
neither task edited. **The unit of staleness is a CLAIM, not a file.** So read each bullet for the
assertions it makes — "X does not exist", "Y is still unwired", "Z has no caller", "this is still
open" — and check each assertion against the tree, whether or not the bullet names anything you
touched. The three assertion shapes that go stale most often here, all three demonstrated in this
document's own history: **"no router/procedure exists"** (check `router.ts` and the router file, not
the screen), **"nothing is wired to it"** (grep for the procedure name across `packages/web/src`), and
**"marked with a `TODO(phase-e-wave-N)`"** (re-run item 11's anchored grep). A bullet naming a file
you never opened is exactly the one this step exists for; "my diff does not touch that file" is the
reasoning that produced four stale bullets in wave 2 and a fifth here.

**This was scoped to Known-gaps bullets only, and that scope was too narrow — widened at wave 5,
Task 0's fix round; see that fix round's own paragraph below for the incident that found it.** The
reasoning for not auditing the whole document every time still holds: item 11's own countdown grep
already does the analogous job for `TODO(phase-e-wave-*)` markers in the CODEBASE; this step is the
same discipline applied to the PLAN DOCUMENT's own claims about that codebase, which no automated
check can verify because "is this prose still true" is not a grep-able property. But "Known-gaps
bullets" was the wrong boundary to draw the exemption around — a present-tense status claim can sit
in a numbered item's ORDINARY PROSE just as easily as in one of its bullets, and nothing about the
method above (walk the bullets, check each assertion) ever looked there.

**The scope is now: every Known-gaps bullet, AND every numbered item's own prose body — not only
its Known-gaps sub-bullets.** This does not become "audit the whole document": the "Files to copy
from" table, the "Session History"-style narration of what a past commit did, and a fix round's own
retrospective paragraphs (the "what the item got right / got wrong" sections, once resolved) are
historical record, not present-tense claims about the CURRENT tree, and stay out of scope the same
way they always have. What changed is which part of a NUMBERED ITEM counts: read the item
paragraph-by-paragraph, not bullet-by-bullet, and treat any sentence asserting a component's current
shape ("`board.detail` leaves out `board_type`"), a marker's existence ("see that component's own
`TODO(phase-e-wave-3)` marker"), or a file's current state (including an approximate line-number
citation, which item 1 already tells you not to write for the identical reason) as a claim to verify
against HEAD — the same standard a Known-gaps bullet has been held to since wave 2.

**Widened again at wave 5, Task 6: a bullet can be contradicted by ANOTHER SECTION OF THIS FILE,
and the sweep as written cannot see that.** Wave 5, Task 4's Known-gaps bullet 4 said the SSE
routing seam "has no end-to-end test through the WEB client ... the ROUTING half is not [pinned]".
It was false on the day it shipped — the reviewer who struck that task's "unautomatable" claim wrote
the test in the same round, and item 2's "The client half of one stream" section describes it in
detail ("the split is PINNED, in jsdom, in about forty lines"). It then survived a close-out,
because every instruction above says to check a bullet against HEAD, and HEAD had not changed: what
had changed was a different paragraph of this document. **So check each assertion against the rest
of this document as well as against the tree — if another section narrates the same mechanism, read
it.** The cheapest form of this is a grep of this file for the symbol a bullet's claim turns on
(here, `trpc.test.ts`), which would have surfaced the contradiction immediately.

**Widened a third time in wave 6, Task 0's fix round: a claim that a file is absent from "any"
list in a multi-section document needs a grep of the WHOLE of that document for the filename, not
a read of the one section already open.** See wave 6, Task 0's own fix-round paragraph below for
the incident that found it, and for the more useful finding underneath it — whether either of the
two widenings above should already have caught this, and why the answer turns out to be no for a
reason worth knowing rather than a reason to shrug at.

**Wave 5, Task 0 — run now, before any wave-5 code, per this task's own brief ("now, not at the
end").** Method: walked every Known-gaps bullet and every present-tense status claim in items 2, 9
and 11 for the specific ASSERTION it makes (not for whether it names a file this task touched — the
mistake this step exists to catch), and re-ran the grep or read the code each assertion depends on,
anchored to `fb3a5cd` (this task's base) and, where a fix landed in this task, to `1ef127a`. Checked
and held, unchanged:

- Item 11's marker countdown — `grep -rnE "^[[:space:]]*(//|\*) TODO\(phase-e-wave" packages/web/src | wc -l`
  answers **6** at `fb3a5cd`, the same 6 lines recorded at the end of wave 4 (`cd10b54`) and unchanged
  since — see item 11's own re-run below for the full list.
- Item 2's board-scoped guard census — `requireBoardPermission` **9**, `requireBoardActor` **3**,
  `: BoardScope` in `rules.ts` **19** — all three unchanged from their `5d11393` figures; no wave-4
  fix round or the wave-5 plan commit added a new board-scoped write or rule.
- Item 9's "`useMockAuth` has zero callers outside its own module" and "`MockAuthProvider` is
  directly named in 4 files" — both re-grepped and both hold exactly (the 4 files are still
  `test/render.ts`, `test/mocks/auth-mock.ts`, `PermissionGate.test.tsx`,
  `boards.$boardId.test.tsx`). The RAW counts feeding this item's own table (35 `renderWithProviders`
  callers / 12 `useCurrentUser` mocks / 3 that also mock `AuthProvider`) have moved to 58 / 20 / 3 at
  `fb3a5cd` — expected drift the item's own text already disclaims ("nothing pins them to stay that
  way — the commands are what stay true"), not a false claim; the one figure that IS a substantive
  claim rather than a point-in-time count ("that count has not moved," about the 3-files figure) still
  holds, so left as-is rather than rewritten for a number the item already tells the reader not to
  trust.
- "Wave 4, Task 3's own open items," #2 (`agendaItem.setOperatorNotes`/`markComplete` still have no
  caller) and #3 (the legacy `queryKeys.exhibits.*` line stays in `meetings.$meetingId.review.tsx`) —
  both re-checked directly against the files and both still hold, exactly as worded; #1 in that same
  list was already struck through as closed in Task 4, also re-checked and still accurate.
- The `future_item_queue` fact in item 2's "what waves 5 and 6 need" section — re-verified directly
  against `0000_baseline.sql` rather than trusted; see that item's own new paragraph for the query and
  result. It was already correct; nothing here needed correcting.

**No false claim found in this pass.** The four items this task's own brief named as wave 4's
carry-over (immediately above, in item 2) were the ones actually stale in the sense that mattered —
not wrong prose, but decisions recorded outside this document (in the task's own brief) that had
never landed here at all, which is the same failure this step's own root-cause paragraph describes
("a decision reached but never landed in this document") one level up: a decision made in a
conversation rather than a diff. They are recorded above rather than left for a sixth carry-over.
**This verdict was itself wrong, found by the fix round immediately below — read that paragraph
before trusting "no false claim found" at any future close-out.**

**Sharpened again in wave 5, Task 0's fix round, because a false present-tense claim sat in item 2's
ORDINARY PROSE — not a Known-gaps bullet — and survived the pass immediately above along with three
prior close-outs.** A reviewer, verifying this task by execution, found that item 2's "The cost,
stated rather than left to be discovered" paragraph asserted `CancelMeetingDialog.tsx` "will need a
`boardId` prop it does not have today" and pointed at "that component's own `TODO(phase-e-wave-3)`
marker" — true when written, in wave 3, Task 1; false since wave 3, Task 2 (`c34b987`) added the
prop and discharged the marker, two waves and three close-outs before this one. The claim's falsity
was not hidden: this same document's own item 11 re-run at `c34b987` ("Task 2 closed
`CancelMeetingDialog.tsx`'s ... raw-write authorization holes") and item 2's "Wave 5, Task 0"
carry-over section (item 2 of the four, a few hundred lines below the stale paragraph) both
independently narrate the fix correctly — the document contradicted itself for two waves and no
close-out noticed. It survived the wave-3 sweep ("the unit of staleness is a CLAIM, not a file"),
the wave-4 sweeps, and this task's OWN sweep immediately above ("walked every Known-gaps bullet and
every present-tense status claim in items 2, 9 and 11") for the identical reason each time: every
one of those passes, in practice, walked BULLETS. The wave-5 pass's "every present-tense status
claim" language described an intention its own execution did not match — it re-checked the
Known-gaps list and a handful of named census lines, and never opened this paragraph. A reviewer
caught it by reading item 2 paragraph-by-paragraph instead of bullet-by-bullet, which is exactly the
method the scope-widening two sections above now requires. **The widened sweep, run against every
numbered item's prose (not only items 2, 9 and 11, and not only their bullets) as part of this same
fix round, found one further instance of the identical shape: item 1's "`board.detail` leaves out
`board_type`" claim, false since wave 2, Task 2 (`1939f57`) and never corrected anywhere in this
document until now.** Both are fixed in place at their own paragraphs (item 1's "documented —" line;
item 2's "The cost, stated rather than left to be discovered" paragraph); no third instance was
found — see the fix round's own report for the full method and negative result on the remainder of
the document.

**Wave 5, Task 4 — run at the close of the task, per the widened scope above
(every Known-gaps bullet AND every numbered item's own prose).** Method: walked
the bullets and the prose of items 1, 2, 7, 8, 9, 10 and 11 for the ASSERTIONS
they make, and re-ran the grep or read the code behind each. What moved:

- **"Wave 4, Task 3's own open items" #2 — `agendaItem.setOperatorNotes` and
  `markComplete` still have no caller — is now FALSE** and is struck through
  above. This is the bullet this task's own work falsified, and the one a
  file-based sweep would have found; recording it here because the other three
  below are the kind it would not.
- **Item 8's raw `pathFilter()` file count moved 45 → 53** and is re-run above,
  anchored to `59d8f91`. Eight new writer files, all live-meeting. (The
  close-out originally anchored this and the marker count to `dcb12e4` — the
  pre-amend sha of `c8bd764`, reachable from no branch. Both greps re-run at
  `59d8f91` and answer the same numbers; item 11's rule is the grep AND a
  commit that exists, and only the first half had been met.)
- **Item 11's marker count did NOT move (6), and that is a claim in its own
  right** — `meetings.$meetingId.live.tsx`'s marker was REWRITTEN rather than
  discharged (its reads are migrated; its writes are Task 5's), which is a
  changed claim behind an unchanged count. Recorded above rather than passed
  over as "no change".
- \*\*Item 2's "Wave 5, Task 2" paragraph says "nothing changes on the client —
  the input shape, the `boardId` prop and the mismatch defence are all
  identical". True as written (the A2 and the A2-OR-M1 forms take the same
  input), and worth one sentence it does not say: `AgendaItemDetailPanel.tsx`
  had no `boardId` prop at all, so "identical to the other seven writes" still
  meant threading a new prop from `live.tsx`. That is item 2's own already-named
  cost ("every such write inherits a client-supplied field whose only job is
  feeding the guard"), paid again, not a new one.

Checked and still true, unchanged: item 9's `useMockAuth`/`MockAuthProvider`
claims (this task added EIGHT test files — six live-meeting writer files,
`hooks/__tests__/useLiveMeetingEvents.test.ts`, and
`hooks/__tests__/useQuorumCheck.test.tsx` replacing the deleted
`hooks/useQuorumCheck.test.ts` — and none reaches either); "Wave 4, Task
3's own open items" #3 (the legacy `queryKeys.exhibits.*` lines stay —
`meetings.$meetingId.review.tsx` still reads them, and that file is wave 6's);
item 7's `initConnectionErrorHandler` carve-out (still the one bare
`invalidateQueries()` in the tree, still after a REALTIME reconnect — note for
wave 5, Task 6, which owns replacing it: Task 1's report already says the server
tells the client which topics to resync, so that branch should end up doing
nothing rather than doing less).

**Wave 5, Task 5 — run at the close of the task, per the widened scope (every
Known-gaps bullet AND every numbered item's own prose).** Method: walked the
bullets and the prose of items 1, 2, 7, 8, 9, 10, 11 and 12 for the ASSERTIONS
they make, and re-ran the grep or read the code behind each. Deliberately NOT
selected by "which files did this task touch" — the two most interesting
findings below name files this task never opened. What moved:

- **"Wave 5, Task 4's own open items" #1 and #3 are both FALSE** and are struck
  through above. #1 (`live.tsx`'s writes are all still raw Supabase) and #3
  (the `is_recording_secretary: 0` / `: 1` integer literals) are the two this
  task's own work falsified, and #1 was also **one short**: it counted four
  reactive WRITES and filed the adjourn-on-motion effect's under
  `handleMeetingEnd` because the same handler served a button. Five reactive
  writes across FOUR triggers is the honest statement, and the correction is
  recorded at the bullet rather than only here.
- **"Wave 5, Task 4's own open items" #4 contradicted a section of this same
  document, written above it.** It said the SSE routing half "is not"
  tested and that the cheapest coverage is a manual dev-server check; "The
  client half of one stream" says the split IS pinned, in jsdom, in about forty
  lines, by a reviewer in this same wave. Neither bullet nor section names a
  file this task touched, and no close-out had caught it. Corrected, and
  narrowed to what genuinely remains (no test drives a real `EventSource` from
  the web client). **This is the third instance of the exact shape wave 5, Task
  0's fix round found in item 2's prose** — a claim made true when written and
  falsified by a fix landing elsewhere, surviving because every sweep looked at
  the bullets whose FILES it had touched.
- **The `adjournment.adjourned_by` bullet's writer moved** and its prose said
  `live.tsx` writes it. The value and the defect are unchanged; the writer is
  `meeting.ts`'s `performAdjournment`, and `ctx.tenant.personId` is a source
  the client cannot choose where `currentUser?.personId` was not. Corrected in
  place, because wave 6 is told to read that bullet before touching either
  minutes file and would otherwise open the wrong one.
- **Item 11's marker countdown moved 6 → 4**, and there are now ZERO
  `phase-e-wave-5` markers in the tree. Re-run above, anchored to `01ff3ab`.
- **Item 8's raw `pathFilter()` FILE count did not move (53), and that is the
  wrong unit for this task** — what grew is the CALL count, 88 at this commit,
  28 of them this task's, all 28 swept RED. Recorded above, with the command.

Checked and still true, unchanged: item 2's board-scoped census moved for the
ordinary reason and is quoted rather than counted
(`grep -rnE "^[[:space:]]+requireBoardPermission\(" packages/api/src/trpc/routers/*.ts | wc -l`
answers **20**, `grep -rnE "^[[:space:]]+\.use\(requireBoardActor\(" …` answers **9**,
`grep -cE ": BoardScope" rules.ts` answers **29** — the first two grew in wave
5 Task 3 and this task added no rule and no guard, only callers); item 9's
`useMockAuth`/`MockAuthProvider` claims (this task rewrote eleven test files
and added none that reaches either); item 7's `initConnectionErrorHandler`
carve-out (still the one bare `invalidateQueries()` in the tree, still Task 6's);
"Wave 4, Task 3's own open items" #3 (the legacy `queryKeys.exhibits.*` lines
stay — `meetings.$meetingId.review.tsx` still reads them, and that file is wave
6's); and every legacy `queryKeys.*` line in the nine files this task
converted, each re-checked against item 7's rule that the legacy line goes when
the last legacy reader does — `SourceDataPanel.tsx` and
`meetings.$meetingId.review.tsx` still read all nine namespaces, so all of them
stay.

**Wave 5, Task 5's own open items.** Three, none of them a defect this task
introduced:

1. **`executiveSession.markEntered` and `executiveSession.discard` have no
   caller**, deliberately — the two reactive effects they were built for are
   gone, and the live path writes `executive_session` from
   `voteRecord.recordForMotion` with statements keyed by `entry_motion_id`
   rather than by session id (which is what makes `entered_at IS NULL`
   available as the idempotency guard). Both are kept, with tests: each is a
   real M6 action, `discard` carries a precondition the folded path also
   relies on, and wave 6's minutes surface may want a manual path into both.
   Recorded in `executive-session.ts`'s own header as a decision. What they
   must not become is a second way for a client to race the same write.
2. **The minutes re-render still names the wrong meeting.** `live.tsx` followed
   the minutes-approval write with
   `POST /api/meetings/${meetingId}/minutes/render` using the id of the LIVE
   meeting, while the document approved belongs to an EARLIER one (it is
   reached through `agenda_item.source_minutes_document_id`). So the
   un-watermarked re-render has always been requested for the wrong meeting,
   and the live meeting usually has no minutes document, so the call 404s into
   the `.catch(() => {})` that swallows it — the DRAFT watermark is never
   removed. Reproduced rather than repaired: the render endpoint is a Fastify
   Puppeteer route that cannot join the approval's transaction, and which
   document should be re-rendered is a minutes-surface question. It now sits in
   `VotePanel.tsx` with the defect named beside it and in
   `routers/minutes-document.ts`'s helper. **Wave 6 should fix it with the
   `adjourned_by` misattribution, not separately** — both are the same class
   (a live defect in what a generated legal record says) and both have the same
   two readers.
3. ~~**`ConnectionStatusBar` is still on a Supabase Realtime heartbeat
   channel**, and this screen still renders it — wave 5, Task 6's, carried
   forward from Task 4's list unchanged.~~ — **closed in wave 5, Task 6**,
   along with the identically-worded Task 4 bullet it was carried forward
   from. `live.tsx` renders `LiveStreamStatusBar` now, fed by
   `useLiveMeetingEvents`'s return value.

**Wave 5, Task 7 — the wave close-out, run over every Known-gaps bullet and
every numbered item's prose, and NOT selected by which files this task touched
(it touched two, both restored).** Method: walked items 1, 2, 7, 8, 9, 11, 12
and 14 paragraph-by-paragraph plus the whole Known-gaps list, took each
present-tense ASSERTION, and re-ran the grep or read the code behind it against
`git archive 670d9df` rather than the working tree — which mattered here,
because Part 1 of this task temporarily edited `packages/api/src/trpc/trpc.ts`
and `packages/web/src/lib/trpc.ts` and a working-tree sweep would have measured
the edits. Then, per the widening two sections above, grepped THIS FILE for the
symbol each surviving claim turns on. What moved:

- **Item 14's own Wave 5, Task 5 paragraph contained a false claim about this
  document, and it is the fourth instance of the shape this item keeps
  finding.** It states that "Wave 5, Task 4's own open items" #1 and #3 "are
  both FALSE and are struck through above." The verdict was right; the
  strikethrough was never applied. Both bullets still read as open, two tasks
  later, in the list wave 6 is told to read. Found by checking the ASSERTION
  ("is struck through above") against the document rather than by checking the
  bullets against the tree — the tree agreed with the paragraph all along.
  A claim that a document has been edited is a claim about the document, and
  nothing before this sweep ever re-read one. Both strikethroughs are now
  applied, with the corrections each needed (#1's reactive-write count was one
  short; #3's integer-literal SHAPE survives in two wave-6 files).
- **Item 11's marker countdown moved 4 → 5**, re-run above and anchored to
  `670d9df`. Up, not down, and legitimately: Task 6 NAMED `AppShell.tsx`'s
  four-wave-old raw Supabase read rather than creating a gap. Both of the other
  greps this item tracks moved the right way (15 → 14, 25 → 23), and all of
  that movement is Task 6's too.
- **Item 7's `initConnectionErrorHandler` carve-out is genuinely gone**, and the
  anchored grep it now carries answers empty at `670d9df`
  (`git grep -nE '^[[:space:]]*(void )?queryClient[.]invalidateQueries[(][)];' HEAD -- packages/web/src`).
  The three unanchored hits that remain are prose in `providers/QueryProvider.tsx`'s
  header — exactly the markers-versus-mentions hazard item 11 names, and the
  reason that paragraph's own grep is anchored.
- **Task 6's open item #4 ("the banner has never been seen in a browser") is now
  FALSE** and is struck through, with what the look found recorded as its own
  Known-gaps entry.

Checked and still true, unchanged: item 8's `pathFilter()` census — **53 files
and 88 `invalidateQueries(trpc.….pathFilter())` calls at `670d9df`, both
unchanged from `01ff3ab`, and the FILE LIST is identical** (Task 6 added no
invalidation); item 2's board-scoped census (`requireBoardPermission` **20**,
`.use(requireBoardActor(` **9**, `: BoardScope` in `rules.ts` **29** — all three
unchanged from Task 5's figures, since Task 6 added no procedure); item 9's
`useMockAuth` ("zero callers outside its own module") and `MockAuthProvider`
("directly named in 4 files" — still `test/render.ts`, `test/mocks/auth-mock.ts`,
`PermissionGate.test.tsx`, `boards.$boardId.test.tsx`), the raw counts feeding
its table having drifted to 65/20 exactly as that item says they will; "Wave 4,
Task 3's own open items" #3 (the legacy `queryKeys.exhibits.*` lines stay —
`meetings.$meetingId.review.tsx` still reads
`[...queryKeys.exhibits.byMeeting(meetingId), townId]` on raw Supabase, and still
imports `@/lib/supabase` directly); and Task 6's open items #1
(`getMutationErrorMessage` has no production call site — its only non-test
mentions are its own definition and two prose lines in `lib/trpc.ts`), #2
(`isPaused` appears **nowhere** in `packages/web/src`) and #3 (`useLiveMeetingId`
is still raw Supabase in `AppShell.tsx`, now with the marker counted above).

One imprecision, recorded rather than fixed: the `adjournment.adjourned_by`
bullet cites `minutes-formatters.ts:629-636` for the presiding-officer fallback,
which is at 630–634 at `670d9df`. Item 1 already says not to cite line numbers
for this exact reason; the bullet's substance is correct and was re-verified
(`meeting.ts:1124` writes `${personId}`, `minutes-assembler.ts:708` resolves it
through a `board_member.id` map, `formatAdjournmentText` falls back to
`attendance.presiding_officer`).

**Wave 6, Task 0 — run before any wave-6 code, per this task's own brief and
wave 5 Task 0's precedent ("now, not at the end").** Method: the codebase
itself moved almost not at all since the last sweep (`c2b4b25`) —
`git diff --stat c2b4b25 e5250ad` touches only the new wave-6 plan document and
a five-line doc-comment edit in `meeting.ts` (replacing two line-number
citations with symbol references, item 1's own rule, in the `adjourned_by` and
cache-comment paragraphs — no claim in THIS document depends on either
citation) — so this pass is a genuine re-verification, not a search for drift
a large diff would make obvious. Walked every Known-gaps bullet and every
numbered item's prose in items 1, 2, 7, 8, 9, 11, 12 and 14 for present-tense
assertions, re-ran the grep or read the code behind each, and — per the
widened lens — checked whether any OTHER section of this document contradicts
it. Re-verified directly rather than assumed:

- Item 2's board-scoped census: `: BoardScope` in `rules.ts` **29**,
  `requireBoardPermission` (anchored) **20**, `.use(requireBoardActor(` **9** —
  all three unchanged since `670d9df`.
- Item 8's `pathFilter()` file/call census: **53** files, **88** calls,
  unchanged.
- Item 9's `MockAuthProvider` ("directly named in 4 files") and `useMockAuth`
  ("zero callers outside its own module") — both hold exactly.
- Item 1's `exhibit_count` grep — **9** lines, unchanged, all comments/tests as
  the doc already says.
- The Known-gaps bullet on `assertCanSelectTownNotificationConfig` and its two
  siblings — still zero procedure callers, only their own definitions in
  `rules.ts`.
- Wave 5, Task 5's own open item 1 (`executiveSession.markEntered`/`discard`
  have no caller) — still true, zero non-test references outside
  `executive-session.ts` itself.
- Wave 5, Task 5's own open item 2 (`VotePanel.tsx`'s minutes re-render posts
  the LIVE meeting's id, not the approved document's) — still true at its
  current call site (`VotePanel.tsx`, `/api/meetings/${meetingId}/minutes/render`).
- Wave 5/6's `getMutationErrorMessage` and `isPaused` bullets — re-verified as
  part of this same task's item-2 clearing above (see "Carried forward" items
  5 and 6): both claims hold exactly as worded, and are now marked with an
  explicit outlives-Phase-E decision rather than re-carried silently.

**One false claim found, and it is this item's own headline number, not a
Known-gaps bullet — exactly the shape this item's widened lens exists to
catch.** Item 11's "23 remaining files" was presented as a clean, current
count; cross-checked against the rest of item 11's own history and against the
files themselves, it undercounts by omitting one bare grep-versus-import
distinction (comment mentions counted as dependencies) and overstates
completeness by four files with live, unmarked code — corrected in place at
item 11 above, in the same task that found it, per this item's own rule
("retire ... any bullet this wave's work closed, whether or not the task that
closed it was the one that wrote the bullet"). No second instance of the
"another section of this document falsifies a claim" shape (wave 5 Task 6's
finding) was found: the SSE/subscription sections, the guard-shape census, and
the Known-gaps list all agree with each other and with the code at HEAD.

**No other false claim found.** Stated with the method above rather than as a
bare assertion, per this item's own standing rule that an unstated method is
what produced two of this project's five sweep failures.

**Wave 6, Task 0's fix round — this same task's own sweep, immediately above, produced a false
absence claim, and it is the incident behind this item's third widening.** The sweep's Known-gaps
bullet (`2d5a704`) asserted `SourceDataPanel.tsx` "is not on any wave-6 task's file list ... not
Task 5, and not Task 3/4." That is false: Task 3's own file list, in the wave-6 plan document
(`docs/superpowers/plans/2026-09-12-phase-e-wave-6-minutes-and-completion.md`), names the file
directly ("`routes/meetings.$meetingId.minutes.tsx`, `components/minutes/SourceDataPanel.tsx`, and
whatever `MinutesEditor` needs"), eight lines from the Task 5 text the sweep had just quoted. The
claim was produced by reading Task 5's twelve-file list, seeing the name absent from those twelve,
and stopping there — writing "not Task 3/4" as if that had been checked the same way, when it had
not been grepped at all.

Neither of this item's first two widenings would have caught it, and the reason is more useful
than the miss. The first widening (every numbered item's own prose, not only Known-gaps bullets)
is about WHERE in `phase-e-conventions.md` a present-tense claim can hide; the false claim here
was already sitting inside a Known-gaps bullet, the one shape every version of this step has
always read, so that widening was never in play. The second widening — check each assertion
against the rest of THIS document, because another section can contradict it — comes closer, but
its own text scopes the check to another section of THIS FILE, `phase-e-conventions.md`, and its
worked example is accordingly a code-claim contradicted by this file's own section on the SSE
test. The contradiction here lived in a different file entirely: the wave-6 plan document, which
a claim about "any wave-6 task's file list" is _about_ but which is not a section of
`phase-e-conventions.md` for the second widening's check to reach. So this is a genuine scope gap
in what the second widening's text covers, not only an execution lapse inside an already-adequate
rule — a claim whose subject is another document's contents needs THAT document searched, and
nothing above ever named the plan document as something to grep.

**The method that works: before writing that a file, symbol, or claim is absent from every list or
section of a document, `grep -n "<the exact string>" <that document>` for it — the whole document,
not only the one section already open — and write "absent" only once that grep comes back empty.**
Applied here, `grep -n "SourceDataPanel" docs/superpowers/plans/2026-09-12-phase-e-wave-6-minutes-and-completion.md`
surfaces Task 3's line immediately. This is the same discipline item 11's own corrected count (a
few sections above, from this same task) already used for a claim about the CODE — reading each
candidate file directly rather than trusting a grep's mention count — applied to a claim about a
PLAN DOCUMENT instead of the codebase.

---

## Files to copy from

| Concern                                                  | File                                                                       |
| -------------------------------------------------------- | -------------------------------------------------------------------------- |
| Router, explicit columns, `NOT_FOUND` parity             | `packages/api/src/trpc/routers/board.ts`                                   |
| Procedure-name pin                                       | `packages/api/src/trpc/__tests__/router-wiring.test.ts`                    |
| Client, `RouterOutputs`                                  | `packages/web/src/lib/trpc.ts`                                             |
| Migrated screen: loader, three states, tab-gated query   | `packages/web/src/routes/boards.$boardId.tsx`                              |
| Screen test: real proxy, stubbed transport, invalidation | `packages/web/src/routes/__tests__/boards.$boardId.test.tsx`               |
| Writer test: pins an invalidation                        | `packages/web/src/components/boards/__tests__/ArchiveBoardDialog.test.tsx` |
| Test harness                                             | `packages/web/src/test/trpc.ts`, `packages/web/src/test/render.ts`         |
| Typed props into a child                                 | `packages/web/src/components/boards/ArchiveBoardDialog.tsx`                |

## Known gaps this document does not close

- ~~The board-scoped authorization form in item 2 is fixed and unit-tested ... but still has **zero
  call sites in a real procedure** — no shipped router calls `requireBoardPermission` yet.~~ —
  **closed in wave 3, Task 1.** `meeting.insert` (`packages/api/src/trpc/routers/meeting.ts`) calls
  `requireBoardPermission("A1", boardIdFrom())` for real, and the case this whole mechanism exists
  for — a revoking board override refusing on the barred board while still allowing the same actor
  elsewhere — is exercised by a real procedure for the first time (`meeting.test.ts`'s "honours a
  REVOKING board override" tests, on `insert`, `cancel` AND `updateStatus`). See wave 3's Task 1
  report for what this first real use found item 2 got right and wrong. `cancel`/`updateStatus`
  needed a FOURTH guard shape — `assertCanUpdateMeeting` is admin-OR-A1-OR-M1, not one code — and
  that shape is now `requireBoardActor` (`trpc.ts`), generalised in this same task's fix round rather
  than left as `meeting.ts`'s own one-off `requireCanUpdateMeeting` (the review round's audit of
  `rules.ts` found `assertCanUpdateMeeting` was not the only `BoardScope` rule that does not reduce
  to one code — see item 2's own "Wave 3, Task 1" section for the other two and why they either fit
  or do not). ~~`requireBoardPermission` has one real call site (`meeting.insert`);
  `requireBoardActor` has two (`meeting.cancel`, `meeting.updateStatus`) as of this task.~~ —
  **re-run at `5d11393` (wave 4, Task 2's close-out); quote the grep, not the number:**

  ```
  $ grep -rnE "^[[:space:]]+requireBoardPermission\(" packages/api/src/trpc/routers/*.ts | wc -l
  9    # agendaItem's seven writes (Task 1), meeting.insert, meeting.publishAgenda (Task 2)
  $ grep -rnE "^[[:space:]]+\.use\(requireBoardActor\(" packages/api/src/trpc/routers/*.ts | wc -l
  3    # meeting.cancel, meeting.updateStatus, exhibit.link (Task 2)
  ```

  (Both anchored to the start of the line on purpose. The unanchored forms answer 18 and 5 at the
  same commit, because these two names are discussed in half a dozen router doc comments and in
  `meeting.test.ts` — the same comment-versus-code hazard item 11's own marker grep has.) The
  board-scoped mechanism now has real users on both of its shapes, not just the single-code one.

- `assertCanSelectTownNotificationConfig` / `assertCanInsertTownNotificationConfig` /
  `assertCanUpdateTownNotificationConfig` are tested as pure functions
  (`packages/api/src/trpc/__tests__/admin-gates.test.ts`) but **no procedure calls them** — wave 1
  Task 4 built one, a reviewer proved it was the wrong direction, and it was deleted. The reasoning
  that survives, for whichever wave builds the real screen: `town_notification_config`'s RLS
  (`town_notification_config_tenant_isolation`, `0000_baseline.sql`) is **tenancy-only** over the
  town's SMTP/Twilio credentials, exactly like `board`'s policy — but unlike `board`, tenancy is not
  enough here, and today NOTHING client-reachable queries this table at all (the browser's Supabase
  client sends no service credential, so a request against it resolves no rows). Do not pattern-match
  `board.ts`'s "no guard, tenancy is enough" comment onto this table: that reasoning is exactly how an
  implementer ships a `select` that hands the raw Postmark token to any admin's browser, turning zero
  client exposure into admin-gated-but-still-client-reachable exposure — a real improvement over an
  ungated read that does not exist, and still the wrong direction for a screen nobody has designed.
  Separately, and worth recording rather than fixing in passing: the column is named
  `postmark_server_token_encrypted` and its own DB comment says "decrypted only at send time," but
  nothing in this repository encrypts or decrypts it — `lib/postmark.ts` reads and uses it as a
  plaintext token (see that file's own doc comment). Any future write path for this column inherits
  that contradiction and should not paper over it.
- ~~`setPortalAddress` is still resolver-form~~ — **closed in Task 5.** Converted to
  `.use(requireActor(assertCanUpdateTown)).input(...)`, and the schema tightened from a bare
  `z.string()` to `min`/`max` on `SUBDOMAIN_MAX_LENGTH`, which is what let the reorder pin exist at
  all (`packages/api/src/trpc/__tests__/town-portal-address.test.ts`) — see `town.ts`'s own doc
  comment on that procedure. Same task also gave it its first UI caller ever
  (`SetPortalAddressModal.tsx`, opened from `ProgressChecklist`'s "portal-subdomain" row) — the
  mutation had existed since Phase D with nothing in the product able to call it.
- `TestHandlers` rejects a missing field but accepts an extra one (item 8).
- `test/trpc.ts`'s `TestErrorCode` union had five members, not every code a real procedure can
  answer — found in Task 5 writing `SetPortalAddressModal.test.tsx`, the first test in this codebase
  to simulate a MUTATION's error response rather than a query's. **Corrected here after the review
  round: the first version of this bullet claimed `trpcTestError("CONFLICT")` "typechecked fine (the
  string is not itself constrained at the call site)" and called the gap "not a compile-time gap."
  Both halves are false, and `test/trpc.ts`'s own doc comment on `TestErrorCode` now says so — this
  bullet previously contradicted it.** `trpcTestError`'s parameter is plainly typed `TestErrorCode`,
  and `TestHandlers`' own typing infers a handler's input/output from the real router, so a string
  literal outside the union was never going to compile; verified by mutation, removing `| "CONFLICT"`
  from the union answers `TS2345: Argument of type '"CONFLICT"' is not assignable to parameter of
type 'TestErrorCode'` at the `SetPortalAddressModal.test.tsx` call site and `TS2353: ... 'CONFLICT'
does not exist in type 'Record<TestErrorCode, number>'` in `test/trpc.ts` itself — the check is in
  the function signature, not in `TestHandlers`, and it fires at the call site. What actually
  happened: `SetPortalAddressModal.test.tsx` was written and run with `vitest` alone, which does not
  evaluate types, so the missing union member surfaced instead as a confusing RUNTIME failure —
  `@trpc/client`'s own `transformResult` throwing `TransformResultError` ("Unable to transform
  response from server"), because `code: undefined` reached it before the type question was ever
  asked. Seeing a confusing runtime failure and concluding something about the type system without
  running `tsc` first is exactly the mistake item 8's "floor" section warns against — a green vitest
  run is not a typecheck, and a RED vitest run is not a type verdict either. The union genuinely was
  incomplete, though — that part of the original diagnosis holds, and closing it is real work, not a
  false alarm: fixed by adding `CONFLICT` to the union and both records (`-32009` / `409`, from
  `@trpc/server`'s own `TRPC_ERROR_CODES_BY_KEY`) — a three-place edit (the union, `JSONRPC_CODE`,
  `HTTP_STATUS`) — and the same shape of gap exists for every other `TRPC_ERROR_CODE_KEY` this
  harness does not yet list (`PAYMENT_REQUIRED`, `PRECONDITION_FAILED`, `TOO_MANY_REQUESTS`, …) — add
  the next one the same way, at the point a real procedure needs a test to simulate it, not
  preemptively.
- `MockAuthProvider` is directly named in 4 files (`grep -rl "MockAuthProvider" packages/web/src`:
  `test/render.ts` and `test/mocks/auth-mock.ts`, where it is defined and wraps every render, plus
  `PermissionGate.test.tsx` and `boards.$boardId.test.tsx`, the two tests that reach it by name). It
  is inert in all of them per item 9. The other `renderWithProviders` callers receive it too, just
  implicitly — `render.ts` wraps every render in it unconditionally — so retiring it touches every
  caller, not only the 4 that name it.
- `router-wiring.test.ts` pins only the procedure names it lists.
- ~~`cache-key-parity.test.ts` (item 7) checks only that a `pathFilter()` call exists in the file —
  not that every `pathFilter()`-calling writer is itself pinned by a writer test (item 8).\*\*
  ... Deliberately not shipped this round ... Available as a starting point for whichever wave next
  hits this gap, not as a finished check.~~ — **shipped in this wave's final whole-branch review**,
  as `packages/web/src/lib/__tests__/pathfilter-pin-coverage.test.ts`: for every non-test file whose
  comment-stripped code calls `trpc.<router>.pathFilter()`, at least one test file must import it (a
  static `from "..."` or a `vi.mock("...")`, resolving both `@/` and relative specifiers) and itself
  assert `isInvalidated` or call `countFor(`. Matching by import graph rather than filename was
  deliberate — a filename-only matcher fails on `routes/boards.$boardId.templates.$templateId.edit.test.tsx`
  (lives outside any `__tests__/` directory) and would be fooled by a plausible-but-wrong name like
  `Foo.pathfilter.test.tsx` that does not actually import `Foo.tsx` (see the check's own fixture
  tests for both). Comment-stripping is load-bearing the identical way item 11's marker grep needs
  it to be: without it, `routes/people.tsx` and `test/trpc.ts` both false-positive as writers because
  each mentions `trpc.<router>.pathFilter()` in a comment, not real code — and, as of Phase E wave 4
  Task 0's first commit (`f3a4afd`), so does a THIRD file, `routes/boards.$boardId.tsx`, whose new
  header comment on that commit explains why `town.detail`'s legacy key stays un-invalidated by
  naming `trpc.town.pathFilter()` in prose, not in a real call. **Caught by this fix round after the
  task's own report claimed no other Known-gaps bullet's claims were falsified by the task's work —
  they were: this bullet, and its sibling below, both still said "two." The unit of staleness is a
  CLAIM, not a file (item 14), and checking by file (which files did this task's diff touch) is
  exactly the failure mode that let it through.** **The figures that used to sit here — "28 files
  contain the raw substring at HEAD, 26 after stripping" — were anchored to no commit at all, and had
  drifted by two waves; re-measured in wave 3, Tasks 3+4's fix round and anchored the way item 11
  requires.** At `8c1b5e2` (this round's parent) the walk over non-test files under
  `packages/web/src` finds **35** containing the literal `.pathFilter()` and **33** after stripping
  comments; this round adds five more writers (`AgendaItemDetailPanel.tsx`, `AttendancePanel.tsx`,
  `AgendaSection.tsx`, `InlineItemForm.tsx`, `routes/meetings.$meetingId.review.tsx`), taking those to
  **40** and **38**; the whole-branch fix round adds a sixth, `routes/meetings.$meetingId.minutes.tsx`
  (see its own Known-gaps bullet below), taking them to **41** and **39**. Phase E wave 4 Task 0 then
  adds `routes/boards.$boardId.tsx`'s comment-only mention (no real writer), taking the raw count to
  **42** while the comment-stripped count stays **39** — verified at `8cbf749` (Task 0's own
  close-out commit, this fix round's parent):

  ```
  $ grep -rl "\.pathFilter()" packages/web/src | grep -v __tests__ | grep -v '\.test\.' | wc -l
  42
  ```

  The comment-stripped figure has no equivalent one-line grep (stripping `/* */` and `//` first is
  what makes it differ from the raw count at all) — reproduce it by running
  `pathfilter-pin-coverage.test.ts`'s own `stripComments` over the same file list, exactly as the
  check itself does; walked that way at `8cbf749` it answers **39**, unchanged from the whole-branch
  round's own last figure, because the one new mention this task added is comment-only.
  **Re-measured at `24bfcd4` (wave 4, Task 3): raw 44, stripped 41.** The two new comment-stripped
  writers are `components/meetings/ExhibitUploader.tsx` and `components/meetings/ExhibitRow.tsx`,
  both of which gained `trpc.exhibit.pathFilter()` when the agenda builder's exhibit read moved;
  the extra raw-only file is `components/meetings/agenda-types.ts`, whose header names the
  `RouterOutputs`-derived types in prose. Zero violations — the check passes at that commit, so the
  five writer files this task added or changed each have at least one test importing them and
  asserting an invalidation.
  **Re-measured at `59d8f91` (wave 5, Task 4): raw 53.** Eight more non-test files call
  `pathFilter()` than at `cd10b54`, and every one of the eight is a live-meeting writer that gained
  its first call when this task moved the live screen's nine raw Supabase reads onto tRPC (eleven procedures) — `MotionPanel.tsx`,
  `MotionCaptureDialog.tsx`, `VotePanel.tsx`, `RecusalDialog.tsx`, `GuestSpeakerEntry.tsx`,
  `ExitExecutiveSessionDialog.tsx`, plus `hooks/useLiveMeetingEvents.ts` (the SSE topic mapping,
  which is a writer in the sense that matters here: another device's write arriving) and
  `hooks/useQuorumCheck.ts`. Reproduce with the same command:
  `grep -rl "\.pathFilter()" packages/web/src | grep -v __tests__ | grep -v '\.test\.' | wc -l`.

  **Re-measured at `01ff3ab` (wave 5, Task 5): raw 53, unchanged — and the FILE count is the wrong
  unit for what this task did.** Every one of the eight files above was already counted; what grew
  is the number of CALLS inside them, which is the unit the deletion sweep works in and the unit
  item 8's per-file credit bleed is about:

  ```
  $ grep -rn "invalidateQueries(trpc\..*\.pathFilter())" packages/web/src \
      | grep -v __tests__ | grep -v '\.test\.' | wc -l
  88     # at 01ff3ab; one is a doc-comment false positive (test/trpc.ts), so 87 real calls
  ```

  Twenty-eight of those are this task's, across nine files, and all 28 were swept by deletion —
  **28 sites, 28 RED**, each naming a test, each restored from a copy. The sweep was run in two
  passes, one per commit, scoped to the touched directory rather than the whole web suite (~10s a
  site rather than ~12s), which is what makes it affordable per-task rather than per-wave.

  **Re-measured at `cd10b54` (wave 4, Task 4): raw 45, stripped 41 — and the gap is now FOUR files,
  not three.** The single new raw match is `routes/templates.tsx`, and it is comment-only: that
  file's new header explains that the four template writers' existing `trpc.agendaTemplate.pathFilter()`
  calls now reach this screen's key, in prose, while the screen itself writes nothing and calls no
  `pathFilter()`. So the roster of comment-only false positives is `routes/people.tsx`,
  `test/trpc.ts`, `routes/boards.$boardId.tsx` and now `routes/templates.tsx`. The stripped count
  does not move: Task 4's one genuinely new call is `trpc.agendaItem.pathFilter()` inside
  `components/meetings/CreateMeetingDialog.tsx`, a file already counted for its
  `trpc.meeting.pathFilter()` call — which is exactly the per-file credit bleed item 8 describes, so
  that task swept all three of that file's `invalidateQueries` lines by deletion rather than
  trusting the check: each turned exactly one named test red, and each was restored byte-identical.
  Task 4 also added a comment-only false positive to item 11's OTHER grep: `CreateMeetingDialog.tsx`'s
  new header cites `lib/supabase.ts` in prose while importing nothing from it, so
  `grep -rl "lib/supabase\|useSupabase"` counts 34 non-test files where 33 really reach the client.
  The gap between the pair now accounts for FOUR files, not three — `routes/people.tsx`,
  `test/trpc.ts`, `routes/boards.$boardId.tsx` and, as of `cd10b54` (wave 4, Task 4),
  `routes/templates.tsx` — this is the durable claim here, and it is a claim about which FILES make
  up the gap, not a number that stays put; quote the check's own
  `findUnpinnedWriters(SRC_DIR).writerCount` (and, for the raw/stripped gap specifically, re-run the
  comment-stripping walk described above) rather than trust any of these numbers to still be current.
  Validated against `git archive` snapshots of three real commits,
  not assumed: HEAD (26 writers, 0 violations), `3b22df8` (16 writers, 3 violations —
  `AddMemberDialog.tsx`, `MemberArchiveDialog.tsx`, `MemberTransitionDialog.tsx`), `081a27e` (25
  writers, 1 violation — `MemberRoster.tsx`) — all three matching this wave's own named findings by
  file and by count, the same discipline `cache-key-parity.test.ts`'s own history section uses.
  **Still bounded exactly as originally scoped**, and the boundary is worth restating precisely: a
  test that imports the writer and asserts `isInvalidated`/`countFor(` ANYWHERE in the file passes,
  even for a totally unrelated procedure — this reaches item 8's "a writer is tested at all", not the
  harder claim "the RIGHT procedure is tested". See the next bullet for why that harder claim is not
  worth chasing with a static check, and what to do instead.

- **The per-mutation half — "is the RIGHT procedure being pinned, not just A procedure" — is not
  statically mechanisable, and this wave's review tried before concluding that.** Task 3's real
  failure (three of nine invalidations shipped unpinned, INSIDE files that already had other pins —
  so a whole-file "does this file call `pathFilter()` and does some test in it assert an
  invalidation" check would have called those files fine) is exactly the shape the check above
  cannot see: the file-level pin exists, it is just pinning a different mutation than the one that
  shipped broken. A prototype requiring a test to name the SPECIFIC procedure it is asserting on
  (e.g. matching `stub.countFor("board.detail")`'s string literal against the particular
  `pathFilter()` call's router) caught **nothing** beyond what the coarser check above already
  catches, because `installTRPCFetchStub`'s handler map already keys on every real procedure path —
  a test asserting the wrong procedure name would not compile in the first place (the same shape
  item 8's own "`board.statz`" mutation example demonstrates), so there is no "names the wrong
  procedure and passes" failure mode left for a stricter static check to add value against. What
  actually catches a missing invalidation on a specific mutation, proven by Task 3's own fix round,
  is a **scripted deletion sweep** run as a close-out step, not a new assertion shape: comment out
  each `pathFilter()` call one at a time, run the web suite, confirm something goes red, restore. The
  file list:

  ```
  $ grep -rl "\.pathFilter()" packages/web/src | grep -v __tests__ | grep -v '\.test\.' | wc -l
  35   # at 8c1b5e2, this round's parent
  40   # after wave 3 Tasks 3+4's fix round adds five writer files
  ```

  (minus the two comment-only false positives the pin-coverage check's own comment-stripping already
  excludes at those two SHAs — `routes/people.tsx` and `test/trpc.ts`. **A third joined as of Phase E
  wave 4, Task 0's first commit, `f3a4afd`: `routes/boards.$boardId.tsx`. It postdates both SHAs this
  bullet's own 35/40 figures are anchored to, so those two numbers are unaffected by it — but a
  reader stopping at this parenthetical without checking the date would come away believing "two" is
  still the current count, which is exactly the drift the sibling bullet above was just corrected
  for. See that bullet for the current (raw 42 / stripped 39, at `8cbf749`) figures and all three
  names.**) **This bullet used to say "`~21` sites at HEAD"
  with no SHA attached** — off by fourteen against its own grep by the time it was re-run, which is
  precisely the drift item 11's "quote the grep, not the number" rule exists to prevent, in the
  document that states the rule. Re-run it; do not trust either figure above either.
  A site is one `pathFilter()` CALL, not one file, and several files now carry two or more.
  At roughly 10 seconds per site that is well under ten minutes for the whole tree — cheap enough
  to run as a matter of course before closing out a task that touched cache invalidation, and it is
  the only thing in this document that has actually caught a missing-but-plausible-looking pin.

  **Run over the WHOLE tree for the first time in wave 3's whole-branch fix round — not just the
  commit under review — and the estimate above held: 66 sites, ~12s each, about 13 minutes
  unattended.** The site list, and what it cost, quoted rather than summarised:

  ```
  $ grep -rn "invalidateQueries(trpc\..*\.pathFilter())" packages/web/src \
      | grep -v __tests__ | grep -v '\.test\.' | wc -l
  66     # at 0e920fa, before this round; one is a doc-comment false positive
         # (test/trpc.ts), so 65 real calls
  ```

  Result: **63 RED, 2 GREEN.** Both greens were among the eighteen calls the round under review had
  just added (see item 8's credit-bleed paragraph); **all 47 pre-existing calls turned a named test
  red.** That is the answer to the "not audited against every real writer" caveat this bullet's
  sibling used to carry: the pre-existing tree was clean, and the hole's only occupants were new. It
  is also the reason to keep running it per-task rather than declaring the tree audited — a sweep is
  a statement about one commit, and the two greens here were three days old.

  Mechanising the sweep is worth the ten minutes it takes to write: comment the line with `perl -i`
  keyed on the line number (so no other line moves), run the suite, `git checkout --` the file,
  record. `git checkout --` as the restore step means the sweep needs a CLEAN working tree — run it
  BEFORE the round's own edits, or back the file up by hand for a site you are actively changing.
  **Wave 4, Task 3 ran it the second way and it is the better default: `cp` the file aside and `cp`
  it back.** That task's whole diff was uncommitted while the sweep ran (every one of its twelve
  sites was a line it had just written), and `git checkout --` would have destroyed it — a hazard
  this bullet already named and an implementer earlier in the same wave hit for real. Its result:
  **12 sites, 12 RED, each naming a specific test.** Scoping the per-site run to the touched
  directories rather than the whole web suite took it from ~12s a site to ~7s, which is what makes
  running it per-task rather than per-wave affordable.

- **Re-checked in the wave's final whole-branch review (current as of `9e87b7b`) — four of the
  five bullets that used to sit here were stale, three of them CLOSED and described as open. This
  is exactly the drift item 14 above (the standing close-out step) exists to catch, and the fact
  that four slipped through at once is why that step got added.**
- ~~`boards.$boardId.tsx`: ... town-settings half is still open — `town.detail` shipped in Task 1
  but this file has not been migrated onto it (real work: retyping two components' props,
  re-checking the effective-settings mapping) ...~~ — **closed in Phase E wave 4, Task 0.** The
  agenda-template-count half was already closed (see the struck-through text above, kept for the
  record of item 11's hole it documents). The town read now goes through
  `useQuery({ ...trpc.town.detail.queryOptions(), enabled: !!townId })` — the same shape
  `boards.tsx`/`settings.town.tsx`/`settings.minutes-workflow.tsx`/`home.tsx` already use — and the
  `as unknown as RouterOutputs["town"]["detail"]` cast on `EditBoardDialog`'s `town` prop is gone
  now that `town` is the procedure's own real output (conventions item 10). No writer invalidation
  change was needed: every writer of the legacy `queryKeys.towns.detail(townId)` key already carried
  `trpc.town.pathFilter()` (`towns: "town"` has been in `cache-key-parity.test.ts`'s `MIGRATED` map
  since before this task), so this was a pure read-side wiring change. The file's own
  `TODO(phase-e-wave-2)` marker is gone.
- **`boards.$boardId.templates.$templateId.edit.tsx`'s own Known-gaps entry — promised by item 11
  above ("a marker this same review round added; see its Known-gaps entry below") but never actually
  written. Recorded here, and closed in the same breath, rather than left as a second dangling
  reference for a future reader to trip over.** This route's `templateRow` read and its save write
  bypassed `agendaTemplate.detail`/`agendaTemplate.update` entirely, staying on raw Supabase with no
  admin gate on the write (the save called `.update(...)` directly, with no
  `assertCanUpdateAgendaTemplate` check at all — the same non-admin-can-write shape Task 3 closed for
  `DeleteTemplateDialog.tsx`, still open here as of wave 3). **Closed in Phase E wave 4, Task 0**: both
  now go through the named procedures, `agendaTemplate.update` carrying
  `requireActor(assertCanUpdateAgendaTemplate)` (already shipped and already tested with a FORBIDDEN
  refusal and a reorder pin — no new API test was needed). `queryKeys.agendaTemplates.detail(templateId)`
  had exactly one reader and one writer in the whole tree, both in this file, so its invalidation was
  dropped outright rather than kept as a legacy line (item 7: the legacy line stays only while another
  reader exists); `queryKeys.agendaTemplates.byBoard(boardId)` stays, since `CreateTemplateDialog.tsx`,
  `DeleteTemplateDialog.tsx` and `boards.$boardId.templates.tsx` still read it. The route also gained a
  loading/error (`role="alert"`) pair and a `clientLoader` prime it did not have before, matching
  conventions items 5 and 12 for a screen that now has a real tRPC read to fail — it did not have one
  before, so there was nothing item 5 applied to.
- ~~`home.tsx` ... The board picker still needs its own procedure (an archived-filtered
  `board.listActive` or an `activeOnly` argument on `board.list`), not a reuse of the existing
  one.~~ — **Wrong as of Task 4, not just stale wording: `board.listActive` shipped there, doing
  exactly the archived-filtering job this bullet said did not exist yet, and Task 5 wired it into
  `StaffAccountFlow.tsx`'s identical picker gap (see the next bullet) in the very same task that
  last touched this sentence.** `home.tsx` itself was rewritten by this wave's own final commit
  (`9e87b7b`) — two commits after `board.listActive` shipped, one after `StaffAccountFlow` started
  using it for the identical gap — and its comment still claimed no such procedure existed; the rot
  here was being actively refreshed, not merely left alone. Corrected directly in `home.tsx` and its
  marker in this same round: `board.listActive` exists and is not a blind swap, because its ordering
  (governing board first, then alphabetical — see its own doc comment) differs from this picker's
  plain `.order("name")`, a real behavior difference whoever migrates this file next needs to check,
  not a missing procedure. ~~`meetingRows`/`minutesDocs` still have no router at all
  (`meeting`/`minutesDocument`) and stay open exactly as before.~~ — **`meetingRows`'s half closed in
  wave 3, Task 0/1**: a `meeting` router now exists (`packages/api/src/trpc/routers/meeting.ts`,
  Task 1) and `home.tsx`'s own marker was retagged to say so (Task 0) — the screen itself is not
  wired onto it yet (that is Task 2 territory and explicitly out of this wave's Task 1 scope), only
  the marker's claim changed. ~~`minutesDocs` still has no router at all and stays open~~ —
  **"no router at all" is false as of wave 3, Task 3** (`0643553`), which created
  `packages/api/src/trpc/routers/minutes-document.ts` and wired `minutesDocument` into `router.ts`.
  Corrected in this wave's Tasks 3+4 fix round; the sweep that should have caught it searched for
  bullets naming its own FILE rather than bullets whose CLAIM its work falsified — see item 14's
  lens, sharpened in the same round for exactly this. What is still open here is narrower and
  unchanged: that router carries `byMeeting` only, and `home.tsx` needs `pendingByTown`, which does
  not exist. The wave-6 scoping stands (that wave owns `minutes.tsx`/`review.tsx` per this wave's own
  plan), and `home.tsx`'s marker —
  `TODO(phase-e-wave-6): minutesDocument.pendingByTown, board.listActive` — is already worded
  correctly, naming the missing PROCEDURE rather than a missing router.
- ~~`ProgressChecklist.tsx` (Task 5) ... Its third, `memberCount` ... stays on Supabase ... Marked
  `// TODO(phase-e-wave-2): boardMember.countByTown (or equivalent)`.~~ — **closed in Task 3.**
  `boardMember.memberCount` (the relocated procedure — see `board-member.ts`'s own header, "Task 1,
  wave 2") is what `ProgressChecklist.tsx` reads today, in its "board members added" progress row's
  `useQuery`, and the file carries no `TODO(phase-e-wave-2)` marker any more. This bullet described
  a gap Task 3 had already closed by the time it was written.
- ~~The wave inherited one existing, unrelated staleness ... `StaffAccountFlow.tsx`'s ...
  marker ... Left for whichever wave touches that file next.~~ — **closed in Task 3.**
  `StaffAccountFlow.tsx` was in Task 3's own file list (`081a27e`, `f80a074`) and now reads
  `trpc.board.listActive.queryOptions()` in its board-picker `useQuery`, with no
  `TODO(phase-e-wave-2)` marker left. "Left for whichever wave touches that file next" was true when
  Task 4 wrote it and false one task later — the exact shape of drift the standing close-out step
  (item 14) exists to catch before it reaches a fifth or sixth wave.
- **Named wave-2 item: `SetPortalAddressModal` has exactly one door, and it disappears.**
  `ProgressChecklist`'s "portal-subdomain" row (`onSetPortalAddressClick`) is the ONLY UI path to
  `SetPortalAddressModal` anywhere in the product. Once every checklist item is complete — not
  hypothetically; this is the intended end state of onboarding — `ProgressChecklist` stops rendering
  the row list at all (see the next bullet) and nothing else opens that modal, so an administrator
  who wants to CHANGE an already-set subdomain later has no path to do it. `RetentionPolicyModal` has
  the identical one-door shape and it is fine there, because retention acknowledgment is genuinely
  one-time; a portal subdomain is not — the product may need to rename a town, correct a typo, or
  free up a name. Reviewer's recommendation, to save whoever picks this up from re-deriving it: the
  right home is a permanent field in `settings.town.tsx`'s "Your Town" `SettingsSection` (next to
  town name/state/municipality — see that section's existing `summary`/`editor` shape), not another
  onboarding-checklist row — an administrator looking to rename their portal address would look in
  town settings, not in a setup checklist they already finished. Not built in Task 5: out of that
  task's two named files (`routes/home.tsx`, `components/dashboard/ProgressChecklist.tsx`), and
  `settings.town.tsx` is a third file with its own accordion sections this task did not otherwise
  touch beyond mounting the modal itself.
- **`ProgressChecklist`'s "all complete" state is a swap, not a disappearance — precise mechanism,
  since a wave-5 report first stated this imprecisely and a reviewer corrected it.** When
  `completedCount === items.length`, the component does not render nothing: it renders a _different_
  card ("Setup complete!", `PartyPopper` icon, two lines of static text) in place of the checklist
  rows. The user-visible effect is the same either way — the "portal-subdomain" row, and every other
  row, stops being reachable — but "the card hides" and "the card is replaced by a different card"
  are different claims, and only the second is what the component's own `if (allComplete) { return
<Card>...</Card>; }` branch actually does.
- **Both doors from staff to board_member dead-end at `RoleConflictDialog`.** Wave 2, Task 3 shipped
  `AddMemberDialog`'s server-side mutual-exclusivity check in `boardMember.addBoardMember`
  (`packages/api/src/trpc/routers/board-member.ts`), and a review round of that same task found the
  archived-account-reuse defect immediately upstream of it (sequenced here for exactly that reason —
  both are the same underlying question: what does an EXISTING `user_account` row mean when a new
  write wants to seat its person as something else). `RoleConflictDialog.tsx`'s `archiveAccount`
  mutation only sets `archived_at` on the conflicting account; it does not delete the row, and
  `user_account_person_id_key` is unique on `person_id` alone, unfiltered by `archived_at`. So after
  an admin resolves a staff→board_member conflict through that dialog, the row conflicting a moment
  ago still exists with `role = 'staff'` — and `addBoardMember`'s mutual-exclusivity check (correctly)
  refuses it again, every time, with no way through. An administrator correcting a mis-assigned role
  under Maine 30-A M.R.S.A. §2605 has nowhere to go today through THIS door.

  **Corrected in Task 4, wave 2 — the sentence above about a second, identical door is wrong; the rest
  of this bullet is not.** This paragraph originally also claimed "the identical trap exists in
  `MemberTransitionDialog.tsx`'s `to_board_member` transition, which routes through the same
  `RoleConflictDialog`." Checked directly: that transition has no UI path at all — `MemberRoster.tsx`
  is the only caller of `MemberTransitionDialog`, always with `member.role: "board_member"`, and the
  dialog's own `RadioGroup` never renders a "convert to board_member" option (dead at `081a27e`,
  before this task, too — not a regression this task introduced). `handleTransitionSelect` and the
  mutual-exclusivity `useMemo` both still branch on `"to_board_member"`, so the TYPE and the dead
  branches exist, but nothing in the component ever sets `transition` to that value. There was never a
  second live door here to dead-end. **This does NOT close the bullet.** The `AddMemberDialog` door —
  `boardMember.addBoardMember`'s mutual-exclusivity check (the `checkRoleMutualExclusivity` call at
  the top of the `if (existing)` branch, which runs BEFORE that branch's reactivation logic) — still
  refuses every time, exactly as the rest of this bullet, including its last paragraph's fix-shape
  citation, already says. One of the two doors described here was never real; the other is still
  shut.

  The review confirmed `RoleConflictDialog`'s own refusal is correct and should NOT change: the old,
  pre-migration code hit this identical case as an uncaught `23505` with no `onError` and no toast at
  all — strictly worse — and the unique constraint really is unconditional, so refusing is the honest
  answer for a write that has not decided what an archived row means. Inventing an un-archive policy
  inside a port would be a design decision smuggled into a migration, which is exactly the failure
  mode conventions item 1's "the query you are replacing is a specification" exists to prevent.

  The fix shape already exists in this codebase and should not be re-derived: `MemberTransitionDialog
.tsx`'s `convertToStaff` mutation handles the MIRROR direction (board_member → staff) correctly
  already — when the person already has an account, it `UPDATE`s that row in place
  (`role: 'staff', archived_at: null, ...`) rather than archiving it and inserting a fresh one.
  `addBoardMember`'s own reuse branch was fixed the same way in the same review round (`archived_at =
NULL` on reuse, unconditionally). Whichever wave next touches `RoleConflictDialog` or the
  board_member-seating path should apply the identical "update in place" shape to the direction that
  still dead-ends, rather than treating this as an open design question — it is not; only the wiring
  is missing.

- **A task dispatch's own "measured scope" can be wrong — verify against the file, or the plan's own
  table, before trusting it (Task 4).** A dispatch summarizing this task claimed `MemberArchiveDialog.tsx`
  was "already fully migrated, 0 supabase calls" and that only 2 raw inserts remained in
  `MemberTransitionDialog.tsx`. Both were checked directly against the files (`grep -n '\.from('`,
  accounting for a `supabase\n  .from(...)` line break the naive `grep "supabase\."` the dispatch
  presumably used would miss) and were wrong: `MemberArchiveDialog.tsx` still had all 3 of its original
  sites (1 read, 2 writes, both inside one `mutationFn`) — only its writer-invalidation lines had been
  added, not its data layer; `MemberTransitionDialog.tsx` had all 7 (2 reads, 5 writes), exactly matching
  the number the MASTER PLAN's own "measured scope" table already recorded at commit `a165049` — a
  number that document had been carrying correctly the whole time. The plan document itself was the
  authority to check against, and was right; the dispatch's own restatement of it was not. Re-run the
  grep, or re-read the plan's own table, before accepting a summary's scope claim — the same "quote the
  grep, not the number" discipline item 11 already states for marker counts applies just as much to a
  file's own remaining-sites count.
- **Recompute a client's destructive-option request server-side; do not trust the toggle
  (Task 4).** `MemberArchiveDialog`'s "also archive the user account" switch is disabled client-side
  when the person holds another active board seat — but a caller bypassing that UI could still send
  `archiveAccount: true` for a person who, by the time the mutation runs, holds one. `archiveMembership`
  answers this the way `addBoardMember`'s mutual-exclusivity check already answers a stronger version of
  the same question ("check the ACTUAL database state, not what the client believes it to be"): it
  recomputes `otherActiveCount` in the same transaction and silently declines to archive the account if
  the answer disagrees with what the client assumed, rather than trusting the boolean or throwing on a
  stale value. Silent decline, not a refusal, because this is a race on informational state the client
  read moments earlier, not an authorization boundary — the caller is still allowed to archive the seat;
  only the SECOND effect (archiving the account) is the one whose precondition gets re-checked. Contrast
  with an FK from client input (item 3), which is always refused (`NOT_FOUND`) rather than silently
  adjusted, because there the caller has no legitimate reading of "the row doesn't exist right now" to
  race against — the two are different hazards and warrant different answers, not the same guard reused
  twice.
- ~~**`AddPersonDialog.tsx`'s `invitation.insert` and `people.tsx`'s `boardMember.listByTown` markers
  are still open** ... Both markers stay exactly as they were.~~ — **both closed in Phase E wave 4,
  Task 0**, and this bullet's own diagnosis of what was missing turned out to be exactly right, which
  is why it is worth recording rather than only striking through. `boardMember.listByTown` is a new
  procedure (`board-member.ts`) answering precisely the town-wide `board_member` JOIN `board` grouped
  by person this bullet said did not exist; no permission guard, for the same tenancy-only reason
  `board.ts`'s own reads carry none (`board_member_tenant_isolation` is a plain `town_id`-only RLS
  policy). No writer invalidation change was needed to add it: `members: "boardMember"` has been in
  `cache-key-parity.test.ts`'s `MIGRATED` map since wave 2, so every writer that already calls
  `trpc.boardMember.pathFilter()` (`AddMemberDialog`, `MemberArchiveDialog`, `MemberTransitionDialog`,
  `RoleConflictDialog`, `EditGovTitleDialog`, `ArchiveBoardDialog`, `MemberRoster`) reaches the new
  procedure automatically, since `pathFilter()` matches by router prefix. `invitation.insert` is a new
  router (`invitation.ts`) — `AddPersonDialog` genuinely had "no seat to hang an invitation off of",
  exactly as this bullet said, so `board-member.ts`'s private `insertInvitation` helper stayed private
  and a new procedure was built instead, reusing `assertCanInsertUserAccount` (the same rule
  `person.insertStaffAccount`/`boardMember.addStaffMember` already use) rather than inventing a new
  rule — see that router's own header for the full reasoning, including the two FK checks
  (`assertPersonExists` plus a new `assertAccountBelongsToPerson`, which closes both the existence
  hazard AND a privilege-escalation shape a bare existence check would miss: pairing a real person with
  a real account that belongs to someone else) and why the token is now `gen_random_uuid()`, generated
  in the database, rather than the `crypto.randomUUID()` this dialog used to mint in the browser.
- ~~`home.tsx`'s `meeting.byTown`/`minutesDocument.pendingByTown` marker could not be responsibly
  re-labeled to a specific wave number in Task 4.~~ ... Left as `TODO(phase-e-wave-2)` — mis-scoped
  but honestly so — for whoever writes the wave 3 plan to retag with an actual number.~~ — **the wave
  3 plan this bullet was waiting for now exists, and wave 3's own Task 0 did the retag it asked for.**
  `home.tsx`'s marker is now `TODO(phase-e-wave-6)`, naming only `minutesDocument.pendingByTown` and
  the still-unwired `board.listActive` — `meeting.byTown` dropped off the list because wave 3's Task 1
  shipped it for real, not because of a re-scoping guess. `minutesDocument.pendingByTown` is tagged
  `wave-6` on the same basis this wave's own plan already states elsewhere (its "Out of scope" note:
  "`minutes.tsx` and `review.tsx` are wave 6"), not a fresh guess — the same table this bullet's
  original version was checking against, now checkable because it exists.
- ~~**Wave 3, Task 3: three new one-procedure routers (`agendaItem`, `minutesDocument`,
  `meetingAttendance`) exist and back `meetings.$meetingId.tsx`'s shell, but are deliberately NOT in
  `cache-key-parity.test.ts`'s `MIGRATED` map yet — a real, load-bearing staleness gap, not an
  oversight.** ... Whichever wave next migrates the screen that owns each writer inherits closing
  this.~~ — **closed in wave 3, Tasks 3+4's fix round, and the deferral was wrong on the merits, not
  merely deferred too long.** All three entries are in the map now (`agendaItems: "agendaItem"`,
  `minutesDocuments: "minutesDocument"`, `attendance: "meetingAttendance"`). The bullet's own
  measurement held up exactly — 11 (namespace, file) pairs across 8 unique files, 6 `agendaItems` / 2
  `minutesDocuments` / 3 `attendance`, in `AgendaItemDetailPanel.tsx`, `AgendaSection.tsx`,
  `InlineItemForm.tsx`, `MeetingStartFlow.tsx`, `AttendancePanel.tsx`,
  `meetings.$meetingId.agenda.tsx`, `meetings.$meetingId.live.tsx` and
  `meetings.$meetingId.review.tsx` — and so did "`persons.detail` has zero writers." What the bullet
  got wrong was calling the cost "bounded, not silent-forever" and treating that as a reason to wait:
  a reviewer reproduced the regression by execution, not argument. At the parent commit `1b1d635` the
  shell read `queryKeys.agendaItems.byMeeting(meetingId)` — the same expression every writer
  invalidates, character for character — and `Query.isStaleByTime()` short-circuits on
  `state.isInvalidated` before consulting `staleTime`, so the refetch happened on return to the shell
  regardless of the 60s window. After Task 3 the shell's key was
  `[["agendaItem","countByMeeting"],…]`, nothing invalidated it, and adding two agenda items then
  navigating back to the meeting detail read "3 items" for up to a minute. Same for the minutes status
  pill and the attendance count. **The alternative to a partial entry is a COMPLETE entry** — all
  eleven fixed on their merits in one commit, ~~each with a pin test verified by deletion (item 8)~~,
  the
  legacy `queryKeys.*` lines all left in place because `SourceDataPanel.tsx`, `useQuorumCheck.ts` and
  reads inside `live.tsx`/`review.tsx`/`agenda.tsx` still consume them. That is what wave 3 Task 2 did
  for `meetings` one commit earlier and what `agendaTemplates` records two paragraphs into
  `cache-key-parity.test.ts`'s own header; a task's file list has never exempted a writer from item 7,
  and this bullet was the third time in three waves that reasoning was tried.

  **Two corrections from the whole-branch review, both to this bullet's own arithmetic and its own
  claim about pins.** First, "each with a pin test verified by deletion" was **false for two of the
  calls**, and this is the sentence a reader would have trusted instead of re-running the sweep. The
  review swept all eighteen added calls and found `meetings.$meetingId.agenda.tsx`'s section-REORDER
  handler and `meetings.$meetingId.live.tsx`'s `agenda_item` Realtime handler both turn NOTHING red —
  each riding the per-test-FILE credit-bleed item 8 describes, in a file that already had a genuine
  pin for a DIFFERENT call. Same failure shape as Task 3's original defect, one layer down. Both are
  pinned now, in `meetings.$meetingId.agenda.test.tsx` ("...when sections are reordered — the OTHER
  call site") and `meetings.$meetingId.live.test.tsx` ("...from the agenda_item Realtime handler"),
  each verified by commenting the `pathFilter()` line, watching that named test go red, and restoring
  byte-identical. Second, that commit's message said the eleven pairs were "fixed on their merits at
  **13** call sites"; the figure does not reproduce, and the message's OWN per-file bullet list sums
  to 18:

  ```
  $ git diff 8c1b5e2..0e920fa -- packages/web/src | grep -c "^+.*invalidateQueries(trpc\..*pathFilter())"
  18
  ```

  Item 11's rule is quote the grep, not the number, and it applies to a commit message exactly as
  much as to this document — a wrong count in a message is what a later reader treats as the roster
  to check against.

- **`routes/meetings.$meetingId.minutes.tsx` had the same item-7 gap for one commit longer, and the
  mechanical check could not see it — two `queryKeys` namespaces cover one table.** The file writes
  `minutes_document.status` at six sites (submit, approve, publish, return for amendments, unpublish,
  regenerate), all funnelled through one `invalidateMinutes()` helper, and that helper invalidated
  only `queryKeys.minutes.byMeeting(meetingId)`. The shell now reads that status through
  `trpc.minutesDocument.byMeeting` and renders it as the pill, so publishing minutes and returning to
  the meeting detail showed a stale pill for the full 60s `staleTime` — the identical regression the
  bullet above closed for eight other files. `cache-key-parity.test.ts` missed it because this writer
  uses the **`minutes`** namespace and the `MIGRATED` map only carried **`minutesDocuments`**;
  `queryKeys.minutes.byMeeting` and `queryKeys.minutesDocuments.byMeeting` are different keys over the
  same `minutes_document` row, and neither invalidates the other. **Closed in the whole-branch fix
  round, and the "it is a wave-6 file" reasoning was declined for the fourth time in four waves** — a
  reviewer flagged it as informational on exactly that basis, and the round one commit earlier had
  already applied the opposite reasoning to eight other files. `minutes: "minutesDocument"` is in
  `MIGRATED` now; adding it surfaced exactly one violation (that helper), fixed in the same commit,
  with a real pin (`meetings.$meetingId.minutes.test.tsx`) verified by deletion. `home.tsx`'s
  `queryKeys.minutes.byMeeting("__home_pending__")` is a `useQuery` key, not an `invalidateQueries`
  call, so the check does not reach it. The legacy line stays — this screen's own `minutesDoc` read is
  still raw Supabase on that key. What remains open is the file itself, now carrying a marker that
  says so: `TODO(phase-e-wave-6): minutesDocument.detail / the minutes status writes` — the
  `minutesDocument` router has `byMeeting` only, and no procedure exists for any of the six
  transitions.

- **Wave 4, Task 2's own open items, named rather than left silent.** Four, all inherited by Task 3
  or later, none of them a defect this task introduced (fix round 1 corrected the scope of #2 and
  extended #3 from rule 15 to its exact twin in rule 14 — both were caught by review, not by this
  task's own first pass):
  1. ~~**Nothing calls `meeting.publishAgenda`, `exhibit.link` or `exhibit.byMeeting` yet.** … **The
     A5 hole and the unauthorized link-insert are therefore still OPEN in the running product**, and
     will be until Task 3 wires them.~~ — **closed in Task 3, and the careful wording above is
     exactly what made the claim checkable.** All three procedures have real callers now
     (`PublishAgendaDialog.tsx`, `ExhibitUploader.tsx`,
     `routes/meetings.$meetingId.agenda.tsx`), both raw writes are GONE rather than merely bypassed,
     and both files' `TODO(phase-e-wave-4)` markers are discharged (item 11's count above,
     14 → 12). The evidence a reader should demand for "a hole is closed" is those two halves
     together — the procedure is called AND the raw write is deleted — because wave 3 claimed the
     first alone and had to correct itself.
  2. ~~**`agendaItem.byMeeting`'s `exhibit_count` is not visibility-filtered and `exhibit.byMeeting`
     is.** … the honest fix is for the screen to count the rows it actually received.~~ — **closed
     in Task 3, by REMOVING the column rather than by leaving it unrendered.** The honest fix named
     here was half of it: the screen does count the rows it received. The other half is that an
     unfiltered `count(*)` still DISCLOSES THE CARDINALITY of exactly the attachments rule 14 hides,
     so leaving the column in the API surface would have left a smaller version of the same leak for
     any future consumer to pick up. `grep -rn 'exhibit_count' packages/api/src packages/web/src`
     answers **9 lines, not empty** (corrected in the wave 4 fix round, after review reproduced the
     command verbatim) — every hit is a comment or test assertion documenting the column's absence,
     none a source line that reads or writes it: this doc comment's own two lines quoting the
     command (`exhibit.ts:172,180`), `agenda-item.ts:354`'s twin doc comment (re-derived here; it had
     drifted to `:316`), `agenda-item.test.ts`'s
     two comments plus its two `not.toHaveProperty("exhibit_count")` assertions
     (`agenda-item.test.ts:285,290,319,320`), and `meetings.$meetingId.agenda.tsx:55`'s comment with
     its test's echo (`meetings.$meetingId.agenda.test.tsx:330`, re-derived here; it had drifted to
     `:326`). The substantive claim — no code
     path produces or consumes the column — holds; only the quoted grep result was wrong, the exact
     comment-vs-code false positive this document warns about elsewhere. **The general lesson for a
     wave that finds a filtered read and an unfiltered count over the same rows: the count is part of
     the disclosure, not a rendering detail.**
  3. **Rule 15's board-member branch ignores the board — and rule 14's `board_only` branch has the
     exact same hole** (see item 2's "Wave 4, Task 2" section for the full statement). `isBoardMember`
     is a town-level fact in both rules, so `exhibit.link` lets any board member attach material to
     ANY board's agenda item, and `exhibit.byMeeting` lets any board member read ANY board's
     `board_only` exhibit titles. Both are pinned as PASSING tests in `exhibit.test.ts` so narrowing
     either is a deliberate change with a failing test to greet it; the same is true at the D1e
     upload endpoint (the write) and download endpoint (the bytes), where it has been true since
     Stage 1/D1e. **This is an OWNER DECISION, not an open question — record it here so it is not
     re-raised.** The implementer's own judgement (see fix round 1) was that this reads as a latent
     defect, not an intent: `board_only`'s own naming and refusal message imply per-board scoping,
     and a read-exposure hole is a materially different risk from rule 15's write-side one. The
     owner was asked and decided (2026-09-10): **leave rule 14's town-wide `board_only` visibility
     AS-IS for now.** Do not narrow it in wave 5, wave 6, or later without a fresh decision — the two
     passing tests above are the tripwire for that decision changing, not evidence of a bug nobody
     has weighed in on. Two separate agents (this task's implementer and the whole-branch closer)
     independently flagged this as worth a decision in the same wave, which is itself evidence a
     bullet stating only "open" invites re-litigation — stating the decision, not just the fact
     pattern, is what stops a third.
  4. ~~**The read's tightening is bigger than "admin_only" alone (fix round 1 correction).** …
     once Task 3 wires this read into the agenda builder the visible change is materially larger than
     the original statement implied.~~ — **shipped in Task 3, and the prediction held.** The A2-only
     clerk who is not a board member now sees NEITHER tier on the agenda builder. What Task 3 had to
     add on top of the correct diagnosis is the DEGRADATION story, which no procedure could supply:
     the screen must not merely show fewer exhibits, it must show a count that agrees with the list,
     or a restricted clerk reads "3 exhibits" above an empty list and files a bug. That is why item 2
     above (the `exhibit_count` removal) and this one closed in the same commit — they are the same
     requirement seen from the two ends. Pinned by `meetings.$meetingId.agenda.test.tsx`'s "degrades
     to zero exhibits, not to a broken screen, when rule 14 hides them all".

  Two things this task checked and found already correct, so a later wave does not re-open them:
  the exhibit DELETE (rule 16, A3-only, at the D1e endpoint, reached by `ExhibitRow.tsx` for BOTH
  file and URL exhibits) and the portal's `board_only` exclusion (`routes/portal.ts` filters with
  `portalVisibleExhibits`, and `exhibit.link` writes the very column that filter reads, so no row it
  can create bypasses it).

- **Wave 4, Task 3's own open items.** Three, none of them a defect this task introduced, and the
  first two are scoping rather than gaps:
  1. ~~**`agendaItem.instantiateFromTemplate` still has no caller.** Task 1 shipped it for
     `CreateMeetingDialog.tsx`'s `instantiateAgendaFromTemplate` helper, which is **Task 4**'s file
     and carries its own `TODO(phase-e-wave-4)` marker naming it. Task 3's file list is the agenda
     BUILDER, and that screen never instantiates a template.~~ — **closed in Task 4**, and with the
     two halves of evidence item 1 of Task 2's own list says to demand: the procedure has a real
     caller (`CreateMeetingDialog.tsx`'s `instantiateMutation`) AND the raw write is gone rather
     than bypassed — `packages/web/src/lib/meeting-helpers.ts` is DELETED, this dialog having been
     its only caller.
  2. ~~**`agendaItem.setOperatorNotes` and `markComplete` still have no caller**, as Task 1 said —
     `AgendaItemDetailPanel.tsx` is reached only from `routes/meetings.$meetingId.live.tsx`, wave 5's
     file. Wave 5 also inherits Task 1's undecided A2-versus-M1 question for those two.~~ —
     **both halves closed, in different tasks.** The A2-versus-M1 question was answered in wave 5,
     Task 2 (A2 OR M1, live-run columns only, `requireBoardActor(assertCanUpdateAgendaItemProgress)`),
     and wave 5, Task 4 wired both procedures into `AgendaItemDetailPanel.tsx` with the two halves of
     evidence this list's own item 1 says to demand: the procedures have a real caller AND the raw
     Supabase writes are gone rather than bypassed (that file no longer imports `useSupabase` at all).
     Both were unauthorized before — `agenda_item_tenant_isolation` is tenancy-only — so FORBIDDEN
     became newly reachable and each write now renders an inline `role="alert"` refusal beside its own
     control, pinned per item 13.
  3. **The legacy `queryKeys.exhibits.*` lines stay**, per item 7's "the legacy line goes when the
     last legacy reader does": `routes/meetings.$meetingId.review.tsx` still reads
     `[...queryKeys.exhibits.byMeeting(meetingId), townId]` on raw Supabase, and that file is wave
     6's. The four writers now carry both the legacy key and `trpc.exhibit.pathFilter()`.

- **Wave 4, Task 4 — a client flow that spans TWO guarded procedures, which item 2 does not cover
  and waves 5 and 6 both inherit.** Every write this document discusses is one procedure with one
  guard. `CreateMeetingDialog`'s "create from template" is two: `meeting.insert` (A1,
  `create_meeting`) then `agendaItem.instantiateFromTemplate` (A2, `edit_agenda`), and the second
  runs after the first has committed. Three things follow that a wave-5 author writing a
  multi-step live-meeting flow should not re-derive:
  - **Do not fold them to get atomicity.** One procedure spanning two codes needs a rule that does
    not exist in `rules.ts`, and inventing one silently answers a product question: a clerk holding
    A1 and not A2 can schedule a meeting today, and a folded procedure either refuses them outright
    or drops the agenda without saying so. Conventions item 1's "the query you are replacing is a
    specification" covers the authorization shape as much as the columns.
  - **A refusal on the SECOND call is a different message from a refusal on the first, and
    `refusalMessage` fits only the first.** Both of that helper's sentences say the action did not
    happen; after step one commits, half of it did. The honest message names what exists ("The
    meeting was created, but …").
  - **The footer is part of the refusal.** Leaving the primary button armed after a partial success
    invites a DUPLICATE of step one — a second meeting, from a button the user has every reason to
    press again. `CreateMeetingDialog` swaps "Create Meeting" for "Open agenda" in exactly that
    state. This is the same family as the `AlertDialog` `aria-hidden` finding above (a refusal
    rendered where it cannot be acted on), one layer further out: there the message was invisible,
    here the message is visible and the only offered ACTION is wrong.

  Worth recording because the pre-migration code had all three wrong at once, and only one of them
  was a transport bug: the raw helper's throw was caught by a single `try` wrapping both steps, so
  a failed agenda write was reported as "Couldn't create this meeting" — while the meeting existed.

  And one claim this task probed and found does NOT reproduce, recorded so a later wave does not
  spend a round on the same phantom: **`agenda-item.ts`'s `scheduled_date::text` comment said the
  cast was "load-bearing, not decorative: postgres.js parses a `date` column into a JS Date."** That
  is true of a bare `postgres()` client and false of `tx.execute(sql…)` — `drizzle-orm/postgres-js`
  installs identity parsers, so `date` and `timestamptz` both come back as raw text. Task 3 started
  by "fixing" three uncast `scheduled_date` reads in `meeting.ts`/`board.ts` on that comment's
  authority, probed the two clients side by side, found the declared `string` had been accurate all
  along, and reverted the churn. Both comments now carry the probe. **The generalisable bit: a
  comment asserting driver behaviour is checkable in about ninety seconds, and "the codebase already
  says so" is the reason nobody had.**

- **Wave 5, Task 3 — `adjournment.adjourned_by` is a misattribution, not a blank field, and wave 6
  should read the fix here before touching either minutes file.** The adjournment writes
  `adjourned_by` as a `person.id` — `live.tsx` sent `currentUser?.personId` until wave 5, Task 5
  moved the write into `meeting.ts`'s `performAdjournment`, which writes `ctx.tenant.personId`: the
  same value, from a source the client cannot choose, and the same defect. `services/minutes-assembler.ts`'s
  `buildAdjournment` resolves it with `memberName(...)`, whose lookup is a `board_member.id` map, so
  it always resolves to `null`. The first report of this (Task 3's own fix round) said the generated
  minutes have "no adjourner" — that does NOT reproduce. `minutes-formatters.ts:629-636`'s
  `formatAdjournmentText` treats a null `adjourned_by` as "not recorded" and falls back to
  `attendance.presiding_officer`, which IS populated. So the field is never blank: when the clerk
  adjourns and the chair presides, the generated legal record silently states the chair adjourned
  the meeting, and nothing anywhere flags it as wrong. `adjourned_by_name` (the presiding officer's
  name, a different person from `adjourned_by` whenever the clerk is not the chair) is written and
  read by nothing — the formatter independently recomputes the same value as its own fallback
  instead. Not fixed here on purpose: it is a legal-record semantics change, its only readers are
  the assembler and the formatter, and both are wave 6's files. The one-sentence pointer lives beside
  the `memberName(adjData.adjourned_by)` call in `minutes-assembler.ts`; the full account is in
  `meeting.ts`'s `adjourn` doc comment. Two of the assembler's own tests exercise a fixture rather
  than the real path (`minutes-generation.test.ts:151, 947, 1474` — two pass `adjourned_by: null`,
  one passes a pre-resolved `"Alice Johnson"`), so nothing in this codebase's test suite currently
  pins this bug or its fix.

- **Wave 5, Task 4's own open items.** Four, none of them a defect this task
  introduced:
  1. ~~**`routes/meetings.$meetingId.live.tsx`'s writes are all still raw
     Supabase** — the adjournment handler, `navigateToItem`, and the three
     reactive effects (`executive_session` ×3, `minutes_document`,
     `notification_event`). Task 5 owns them, and the procedures already exist
     and are tested: `meeting.adjourn`, `meeting.navigateToAgendaItem`, the
     five `executiveSession.*` writes. The file's marker names them. The
     `meeting` write still has no authorization check of any kind, exactly as
     that marker has said since wave 3.~~ — **closed in wave 5, Task 5**, and
     the reactive-write count in the strikethrough is one short: it is FIVE
     reactive writes across FOUR triggers, the adjourn-on-motion effect having
     been filed under `handleMeetingEnd` because one handler served a button
     too. Verified at `670d9df`: the file's only remaining mention of
     `useSupabase` is a struck-through line in its own header comment.
  2. ~~**`ConnectionStatusBar` is still on a Supabase Realtime heartbeat
     channel**, and this screen still renders it. It is wave 5, Task 6's ...
     whatever that bar becomes must not render it as a disruption.~~ —
     **closed in wave 5, Task 6.** The component is two components now, on two
     sources, neither Supabase: an `onlineManager` pill in the app shell and a
     `LiveStreamStatusBar` fed by `useLiveMeetingEvents`'s return value (which
     is no longer `void`). The five-minute warning this bullet ended on was
     the right one and is answered by a grace window, pinned by a named test —
     see "The app-global transport surface (wave 5, Task 6)" under item 2.
  3. ~~**`AttendancePanel.tsx` and `MeetingStartFlow.tsx` write
     `is_recording_secretary: 0` / `: 1` to a `boolean` column.** Found while
     retyping their props onto `RouterOutputs` (the hand-written interfaces
     said `number`; the column is `boolean`, and the procedure says so). The
     PROP types are fixed; the two integer literals in those files' raw insert
     and update payloads are not, because they are Task 5's writes and
     `meeting_attendance.setRollCall`/`setStatus` already take the column
     correctly. Named here so whoever wires those two does not read the
     literals as intentional.~~ — **closed in wave 5, Task 5**, with the raw
     writes those literals sat in. Both files mention the literal only in
     doc-comment prose now. The SHAPE survives elsewhere and is wave 6's, so
     it is named rather than declared gone:
     `lib/meeting/buildStructuredMeetingRecord.ts` still declares
     `is_recording_secretary: number` and compares `=== 1`, and
     `routes/meetings.$meetingId.review.tsx` still normalises `=== true ||
(… as number) === 1` — both on raw Supabase, both wave-6 files.
  4. ~~**The SSE path has no end-to-end test through the WEB client** ... the
     ROUTING half is not ... Cheapest real coverage is a manual check against a
     running dev server, which is wave 5, Task 6 or 7 territory.~~ —
     **already false when this bullet shipped, and it survived one close-out
     before Task 6 re-read it.** The reviewer who struck the "unautomatable"
     claim wrote the test in the same round: `lib/__tests__/trpc.test.ts`'s
     "the link split" pins the ROUTING half in jsdom by faking
     `globalThis.EventSource`, in both directions, and this document's own
     "The client half of one stream" section already narrates it ("the split
     is PINNED, in jsdom, in about forty lines"). Two paragraphs of one
     document disagreeing about the same test is exactly the drift item 14
     exists to catch; the bullet was never updated because item 14's sweep
     re-checks Known-gaps bullets against HEAD, and HEAD had not changed —
     what had changed was another section of this file. **Re-check a bullet
     against the rest of this document as well as against the code.** What
     genuinely remains untested end-to-end is narrower than the bullet
     claimed: no test drives a real `EventSource` against a real server from
     the web package, so a browser-only transport fault would still present as
     "the live meeting never updates".

- **Wave 5, Task 6's own open items.** Four, none of them a defect this task
  introduced:
  1. **`getMutationErrorMessage` still has zero production call sites, and
     three of the five categories still have no reader.** The taxonomy was
     rewritten against `TRPCClientError` and rehomed into `lib/trpc.ts`, and
     `refusalMessage` reads it — but only its `permission` and `network`
     branches. `validation`, `conflict` and `unknown` are exercised by tests
     and by nothing else, because wiring them would change user-visible copy at
     24 files' worth of call sites, which is a UX decision a transport task has
     no mandate to make. `errorMessage`'s CONFLICT-verbatim behaviour is the
     obvious candidate to fold in next, and it is deliberately not folded in
     here.
  2. **An offline device pauses its mutations SILENTLY at the form.** The app
     shell now says "Offline", which is the app-global fact; what it does not
     say is that the Save the user just pressed is queued rather than failed.
     TanStack Query's `networkMode: "online"` default leaves such a mutation
     `isPaused` with no error and no success, so the button's own spinner is
     the only local signal and it never resolves. Nothing in this repo renders
     `isPaused`. Named because the fix is per-form, not global, and a reader of
     the pill will reasonably assume it was covered.
  3. **`layouts/AppShell.tsx`'s `useLiveMeetingId` is still a raw Supabase
     read**, now carrying a `TODO(phase-e-wave-6)` marker it did not have
     through four waves. `meeting.byTown` is not a drop-in — it selects no
     `started_at`, which is that query's ordering column, and it returns every
     non-cancelled meeting where this needs the single most recently started
     `open`/`in_progress` one.
  4. ~~**The banner has never been seen in a browser.** Its states are pinned by
     jsdom tests and its INPUT — the transport's own `status` — is driven by a
     mock, so what is untested is the same seam bullet 4 above narrows to: a
     real `EventSource` dropping and resuming against a real server. In
     particular, nobody has watched the five-minute deadline pass with the
     banner on screen. The grace window is the part of this task most worth one
     manual look, and it did not get one.~~ — **closed in wave 5, Task 7**, and
     the look was worth having: the grace window behaves exactly as designed and
     the look found three defects nothing in the suite could have. See "Wave 5,
     Task 7 — the browser check" below.

- **Wave 5, Task 7 — the browser check. Three defects that no test in this repo
  could have found, because all three live in a seam the suite does not span.**
  The wave's own Task 6 bullet called the grace window "the part of this task
  most worth one manual look"; the look was taken against the real stack (a real
  Chromium, the Vite dev server, the Fastify API, local Postgres), with
  `SSE_MAX_STREAM_DURATION_MS` temporarily lowered to 20s and restored
  byte-identical afterwards (`git diff` empty at `670d9df`). What it found, in
  the order it blocked:
  1. **`bindTenantAccess`'s reentrancy guard false-positives on any tRPC HTTP
     BATCH, which is every screen that issues two or more queries at once.**
     `context.ts`'s `inTransaction` flag is per REQUEST, and `httpBatchLink`
     puts N procedure calls on ONE request sharing ONE context; tRPC resolves
     them concurrently, so the second `ctx.withTenant()` sees the first's flag
     still set and throws `INTERNAL_SERVER_ERROR`. Reproduced with two curls
     and no browser at all — a batch of two reads returns the first and refuses
     the second:

     ```
     $ curl -b cookies 'localhost:3001/api/trpc/board.list,town.detail?batch=1&input=%7B%7D'
     [{"result":{"data":[…]}},{"error":{"message":"ctx.withTenant() called while a
       transaction from an EARLIER, still-open ctx.withTenant() call on this same
       request has not finished. …"}}]
     ```

     The live meeting screen's own loader batches five
     (`agendaItem.byMeeting,meetingAttendance.byMeeting,motion.byMeeting,board.detail,boardMember.roster`)
     and got four refusals and a `207 Multi-Status`; the screen renders blank.
     **This is not a wave-5 regression** — the guard predates the wave (Stage 1,
     Task D1) and the flag has been per-request since. It is invisible to the
     suite because every router test drives ONE procedure through
     `createCaller`, never two concurrently on one context, and the web suite
     stubs the transport (item 8) so it never builds a batch at all. The
     hazard the guard exists for is NESTING — `withTenant` called from inside
     another's callback — which is a dynamic-extent property, not a per-request
     one; two concurrent `db.transaction()` calls take two pooled connections
     and cannot deadlock each other. `0d91a05` already narrowed this guard once
     for a different false positive (`ctx.actor()` on a warm memo); this is the
     second, and the fix has to distinguish "nested" from "concurrent on the
     same request" rather than narrow the condition again. Until it is fixed,
     no migrated screen works in a browser, and **the remaining observations
     below were only reachable by temporarily setting `maxItems: 1` on the
     client's `httpBatchLink`** — disclosed rather than quietly worked around,
     and restored byte-identical. **FIXED in the same task's fix round**, by
     scope rather than by condition: the marker now lives in an
     `AsyncLocalStorage` established around the raw `withTenant` call, so it
     covers that call's dynamic extent and not the request. `maxItems: 1` was
     not shipped and is not needed.

  2. **The SSE resume catch-up never runs on a QUIET stream, so a write made
     during the routine reconnect is lost silently and permanently.**
     `routers/realtime.ts` gates its catch-up on `resuming = input.lastEventId != null`
     and its comment states the intent correctly ("a reconnect means there was
     a window with no connection … marking every topic stale is the only
     correct answer"). But a browser `EventSource` sends `Last-Event-ID` only
     after it has received at least one `id:` frame, and neither
     `event: connected` nor `event: ping` carries one. So a stream that has
     been connected quietly — a meeting in recess, which is most of a meeting —
     reconnects at the deadline as a FRESH subscribe, and anything published in
     the gap is gone. Measured three ways: the gap is **3000 ms**, every time
     (`3000, 3002, 3002, 3003` across four deadlines — the `EventSource`
     default retry, since the server sends no `retry:` field); a second tab's
     write fired inside that gap never reached the first tab in 45 s, with
     **zero** refetches; and the same write fired with the stream UP reached it
     in **225 ms**, refetching `meetingAttendance.byMeeting` and nothing else.
     The gating is provable without a browser:

     ```
     $ curl -N …/realtime.onMeetingChange?input=…            # no Last-Event-ID
     event: connected / event: ping            — no catch-up
     $ curl -N -H 'Last-Event-ID: 3' …                        # resuming
     event: connected / 8 frames, ids 4..11, one per LIVE_MEETING_TOPICS entry
     ```

     Once the client HAS an id, resume works exactly as designed: a write made
     in the gap was picked up on reconnect, with all nine live-meeting readers
     refetching 3.0 s later. So the defect is narrow and nasty — it is
     precisely the quiet meeting that loses the write. The cheapest fixes are
     to give the keep-alive an id, or to treat "the client asked for a stream
     it has been on before" some other way than `lastEventId != null`.
     `useLiveMeetingEvents.ts`'s header claim — "`onData` fires the moment the
     resumed stream delivers its catch-up topics" — is true only under that
     condition, and does not say so.

     **FIXED in the same task's fix round**, by the first of those two shapes
     rather than the second: the procedure yields one `tracked()` handshake
     event (`topic: null`) at the top of every connection, so the client has a
     resume token within milliseconds whether or not the meeting ever speaks,
     and the `lastEventId != null` gate — which is the right question — becomes
     answerable. The keep-alive was NOT the place for it: tRPC's producer emits
     `event: ping` with no id and no hook to add one, and a ping-borne id would
     make the first resume possible only after the first ping (15 s). The gate
     is kept rather than replaced because dropping it would resync all of the
     live screen's reads immediately after its own first fetch, on every mount.
     Both header claims now state the condition. Pinned by
     `packages/api/src/trpc/__tests__/sse-resume.test.ts` at the frame level —
     `createCaller` never serialises an `id:`, so nothing at the router level
     could have caught this.

  3. **Killing the API does NOT break the browser's stream in the development
     topology, so the amber banner cannot be demonstrated that way.** With the
     API dead and confirmed dead, the banner stayed **silent for the full 30 s**
     and the client made no reconnect attempt at all: Vite's dev proxy holds the
     downstream socket open after the upstream dies. Isolated with two
     simultaneous curls and the API then killed — `DIRECT TO API: ended`,
     `THROUGH VITE PROXY: still connected`. Recorded because any future
     instruction of the form "kill the API and watch the banner" is unrunnable
     as written against `pnpm dev`, and because it is worth confirming that
     `infrastructure/nginx/nginx.conf`'s `/api/trpc/` block does not do the same
     thing in production — an intermediary that holds a dead stream open is
     precisely the silent-stale-screen failure the banner exists to catch.

  What the check CONFIRMED, and this is the part the wave asked for:
  - **(a) The routine bounce is silent, watched rather than asserted.** Seven
    server-forced reconnects at 23 s intervals (a 20 s deadline plus the 3.0 s
    retry) over 142 s with the banner on screen, and **zero** banner
    appearances — measured with a `MutationObserver`, not a timer, so a
    throttled background tab could not hide one. Screenshot taken within 3 s of
    a reconnect shows the meeting header flush against the top of the content
    region, with no amber band. The design's premise holds in a real browser.
  - **(b) A second tab's write lands, and lands narrowly.** 225 ms from click to
    the first tab's quorum badge changing, and the only refetch the first tab
    made was `meetingAttendance.byMeeting` — the topic → `pathFilter()` mapping
    is doing exactly what item 7 asks and nothing wider. (During the gap, see
    finding 2.)
  - **(c) The banner goes amber when the stream actually breaks, after exactly
    the grace window and not before.** Dropping the browser's connectivity while
    a stream was up produced amber at **t+25 s** — the 20 s deadline the stream
    was already riding, then the 5 s grace, then the banner — and it cleared
    within **1 s** of connectivity returning. It never reaches red: `stopped`
    needs a `TRPCError` or an `event: return`, and a server that is merely gone
    produces neither, so the client retries every 3.0 s indefinitely and the
    honest state stays "reconnecting". That is defensible, but it means **there
    is no elapsed time after which the banner tells an operator to reload**, and
    a wave-6 reader should decide whether that is the intended ceiling.

  **Decided at wave 6, Task 0, rather than left for a "wave-6 reader" a second
  time.** Re-checked against HEAD: `useLiveMeetingEvents.ts`'s `stopped` state
  is still reachable only from a real `TRPCError` or `event: return` (line
  384's `setStatus("stopped")` and its own doc comment, "`"idle"` is also
  `"stopped"`, and is not reachable today"), and nothing in the file adds a
  time-based ceiling on top of that. **This outlives Phase E.** Giving
  "reconnecting" a terminal timeout is a retry/backoff policy decision — how
  long is long enough, whether it should differ for a public portal kiosk
  versus a clerk's laptop, whether the server should start sending
  `EventSource`'s `retry:` field at all (`routers/realtime.ts`'s header already
  declines to, for reasons orthogonal to this) — and none of wave 6's seven
  tasks (`minutesDocument`, `futureItem`/`meeting.liveByTown`, the minutes and
  review screens, the ten strays, the deletion, close-out) touches the live
  transport at all. Recording the decision here, rather than repeating "a
  wave-6 reader should decide" a second time with no wave-6 task positioned to
  decide it, is what stops this from becoming a third wave's carry-over by
  default. **Also recorded in `docs/backlog.md` (item 3)**, because this
  document is scoped to Phase E's own lifecycle and nothing reads it once the
  phase ends.

- **Wave 5, Task 7 — `supabase/seed.sql`'s ids are not RFC-valid UUIDs, so the
  seeded database cannot be used to exercise ANY migrated screen.** The
  placeholders (`bbbb1111-bbbb-bbbb-bbbb-bbbbbbbbbbbb`,
  `dddd1111-dddd-…`, `11111111-1111-1111-1111-111111111111`, `aaaa1111-…`) have
  a version nibble outside 1–8 or a variant nibble outside 8–b, and every
  procedure in this phase validates its ids with `z.string().uuid()`, which
  Zod 4 enforces to the RFC. `meeting.detail` answers `400 Bad Request`,
  `Invalid UUID`, for the seeded meeting. Only `town` (`a1b2c3d4-…-7890-abcd-…`,
  a valid v7) survives. This is why the browser check had to build its own
  fixture with `gen_random_uuid()`. Nothing is broken in production — the seed
  is a development artefact — but "run the app against the seed" has been
  impossible since the first `z.string().uuid()` landed, and nobody had tried.
  **FIXED in Task 7's fix round**: all 27 offending ids gained a `4` and an `8`
  in the two positions that matter (`bbbb1111-bbbb-4bbb-8bbb-bbbbbbbbbbbb`),
  which keeps them mnemonic and keeps them distinct, and `seed.sql`'s header now
  says why so the shape is not reintroduced. Verified by rebuilding a scratch
  database with `scripts/build-db-from-repo.sh` (27 tables, 27 enabled, 27
  forced) and by running every id in the file through the repo's own
  `z.string().uuid()`: 27 total, 0 invalid.

  **Not fixed, and a different job: the five shipped `permission_template` ids
  have the same defect and live in a MIGRATION.** `aaaa0001-0000-0000-0000-000000000000`
  through `aaaa0005-…` (`packages/api/drizzle/0000_baseline.sql`, and the
  historical `supabase/migrations/20260308000026_seed_permission_templates.sql`)
  have a version nibble of `0` and a variant nibble of `0`. Those rows exist in
  every database the repo has ever built, so changing the literal is a data
  migration with a foreign-key rewrite behind it, not an edit. It matters only
  where a template id reaches a `z.uuid()` procedure — wave 6 should check the
  template pickers before assuming it does not.

- **CORRECTED in wave 6, Task 0's fix round: the bullet originally recorded here claimed
  `SourceDataPanel.tsx` was missing from every wave-6 task's file list. That was false — it
  is on Task 3's list.** The wave-6 plan's own Task 3 section names it directly, eight lines
  from where the original bullet quoted Task 5: "**Files:** `routes/meetings.$meetingId.minutes.tsx`,
  `components/minutes/SourceDataPanel.tsx`, and whatever `MinutesEditor` needs," and the next
  line: "`SourceDataPanel`'s five reads all map to procedures that already exist; it is imported
  by `MinutesEditor`, which `minutes.tsx` renders." The original pass read Task 5's file list in
  isolation, noticed `SourceDataPanel.tsx` was absent from it, and concluded no task named the
  file — without searching the rest of the plan for the filename first. It should have.

  **The actual defect is narrower, and it belongs to the plan, not the code: Task 5's own
  heading said "The ten strays" while its file list names twelve** —
  `home.tsx`, `meetings.tsx`, `AppShell.tsx`, `CommandPalette.tsx`,
  `MeetingSubnavHeader.tsx`, `EditBoardDialog.tsx`, `ArchiveBoardDialog.tsx`,
  `MinutesWorkflowEditor.tsx`, `NoticeTemplateEditor.tsx`,
  `boards.$boardId.templates.$templateId.edit.tsx`, `AddPersonDialog.tsx`,
  `EditPersonDialog.tsx`. **FIXED** in the plan itself: the heading now reads "The twelve
  strays." With that correction, every one of item 11's seven newly-named unmarked files is
  accounted for on some wave-6 task's list — six of them by Task 5, and the seventh,
  `SourceDataPanel.tsx`, by Task 3. Task 6's deletion step (`lib/supabase.ts`/
  `hooks/useSupabase.ts` deleted, build fails on any straggler) remains the backstop it was always
  meant to be, not a missing-file catcher — no file needs to be added to any task's list.

---

## What wave 6 inherits from wave 5

Written at the wave's close-out (Task 7) so that the next wave's first task reads
one list rather than reconstructing it from seven task reports.

### Carried forward, in priority order

1. ~~**The batch reentrancy false positive (Task 7 finding 1).**~~ **FIXED in
   wave 5, Task 7's fix round — it did not survive to wave 6.** The owner asked
   for it before merge. `bindTenantAccess` now holds its reentrancy marker in
   an `AsyncLocalStorage` established around the raw `withTenant` call, so the
   marker lasts for a call's DYNAMIC EXTENT instead of for the request: a
   genuinely nested call still fails fast, and the concurrent siblings of a
   batch each open their own transaction. See item 2's "RESCOPED in wave 5,
   Task 7's fix round" paragraph. The test that did not exist in any package
   now does — `packages/api/src/trpc/__tests__/http-batch.test.ts` drives a
   real batched GET against a real Fastify server and asserts one context
   served all three procedures and that their transactions genuinely
   overlapped; `__tests__/context.test.ts` carries the function-level version.
   Both verified by restoring the per-request boolean and watching four tests
   go red.
2. **The two preserved minutes-surface defects, which are one job.** Wave 5,
   Task 5 said so and it is worth repeating at the top level, because they have
   the same two readers and the same class — a live defect in what a generated
   legal record SAYS. `adjournment.adjourned_by` is written as a `person.id` and
   read as a `board_member.id`, so the formatter's null-fallback makes the
   generated minutes state that **the presiding officer adjourned the meeting**
   whenever the clerk did; and `live.tsx`'s minutes re-render posts the LIVE
   meeting's id rather than the earlier meeting whose minutes were approved, so
   the request 404s into a swallowed `.catch(() => {})` and **the DRAFT
   watermark is never removed**. **Correction, single fix wave after wave 5's
   review:** the MISATTRIBUTION is not pinned by any test today, but its write
   SHAPE is — `meeting.test.ts:1997` asserts `adjourned_by: operator.personId`
   inside `expect(meeting?.adjournment).toMatchObject({...})`. That is a
   deliberate tripwire, not proof the shape is correct: a fix that changes what
   `adjourned_by` receives (a `board_member.id`, say, to match what the
   formatter's lookup expects) will turn this assertion red on its own, which
   is exactly the "found me" a wave-6 implementer should want from this test
   rather than a silent pass either way. The second defect (the DRAFT
   watermark) genuinely has no pin of any kind today.
3. ~~**The quiet-stream resume gap (Task 7 finding 2).**~~ **FIXED in wave 5,
   Task 7's fix round**, alongside the batch defect and for the same reason —
   the owner asked for both before merge. `realtime.onMeetingChange` now yields
   one `tracked()` handshake event (`topic: null`) at the top of EVERY
   connection, so a browser always has a `Last-Event-ID` to echo back and the
   `resuming` gate is answerable by a stream that has delivered nothing. The
   client ignores a `null` topic. Pinned at the frame level by
   `packages/api/src/trpc/__tests__/sse-resume.test.ts` — real Fastify, real
   `appRouter`, raw SSE bytes, the real `Last-Event-ID` header path — because
   `createCaller` hands back envelopes and never serialises an `id:`, so the
   router test could not have failed. Deleting the handshake turns seven tests
   red across three files. **The server still sends no `retry:` field**, by
   decision rather than omission; the reasoning is in `routers/realtime.ts`'s
   header, and it hands the question to whoever answers the banner's missing
   terminal state, since `EventSource`'s fixed, no-backoff `retry:` cannot
   express a retry policy anyway.
4. **`AppShell.tsx`'s `useLiveMeetingId`** — the last raw Supabase read in the
   shell, now carrying its first marker. `meeting.byTown` is not a drop-in: it
   selects no `started_at`, which is the ordering column, and returns every
   non-cancelled meeting where this needs the single most recently started one.
5. **`getMutationErrorMessage` has zero production call sites**, and three of
   its five categories (`validation`, `conflict`, `unknown`) have no reader at
   all. Wiring them is a UX decision about copy at 24 files' worth of call
   sites, which is why the transport task did not make it. `errorMessage`'s
   CONFLICT-verbatim behaviour is the obvious first fold-in. **Decided at wave
   6, Task 0, re-verified against HEAD rather than carried forward unchanged a
   second wave** (`git grep -n "getMutationErrorMessage" -- packages/web/src`
   still answers only the definition, its own doc comment and
   `trpc.test.ts` — zero production callers): **this outlives Phase E.** None
   of wave 6's seven tasks (the `minutesDocument`/`futureItem`/`meeting.liveByTown`
   reads, the minutes and review screens, the ten strays, or the deletion)
   touch mutation error copy, and picking which of `validation`/`conflict`/`unknown`
   gets its own wording at which of the 24 call sites is a product decision
   about USER-FACING TEXT, not a migration-completeness question this phase's
   definition of done (`lib/supabase.ts` deleted) turns on. Recording it here,
   explicitly out of scope, is what stops a third wave from inheriting it
   silently — the alternative is exactly the drift item 14 exists to catch,
   just aimed at a decision instead of a claim. **Also recorded in
   `docs/backlog.md` (item 1)**, because this document is scoped to Phase E's
   own lifecycle and nothing reads it once the phase ends.
6. **An offline device pauses its mutations silently at the form.** The shell's
   pill states the app-global fact; nothing anywhere renders `isPaused`, so the
   Save the user just pressed shows a spinner that never resolves. The fix is
   per-form, not global — which is why a reader of the pill will wrongly assume
   it was covered. **Decided at wave 6, Task 0, re-verified against HEAD**
   (`git grep -n "isPaused" -- packages/web/src` answers **nothing at all** —
   not a production reader, not a test, not a comment): **this also outlives
   Phase E.** Closing it well means a per-form design for "queued, not failed"
   — a different affordance from the error and loading states item 5 of THIS
   document already requires, not a variant of them — and no wave 6 task
   proposes one. Wave 6 adds more mutations behind more forms (the minutes and
   review screens, the ten strays' writes), each of which inherits this gap
   unchanged; none of them is positioned to invent the pattern the other ~70
   already-migrated forms would also need. Recorded as a standing product gap
   for whichever initiative owns offline UX after Phase E, not reopened as a
   wave-6 task. **Also recorded in `docs/backlog.md` (item 2)**, because this
   document is scoped to Phase E's own lifecycle and nothing reads it once the
   phase ends.

### For the merge notes: a production bug this wave fixed incidentally

Two clerks pressing "Record Vote" at the same moment could collide on
`vote_record_unique_per_motion`, and because the old client-side path was
untransacted, the loser could leave a **partial vote roll** — some members'
votes written, the rest abandoned, on a record that is the legal minute of the
vote. `voteRecord.recordForMotion` is one transaction that clears and rewrites
the roll and computes the outcome inside it, so the collision now aborts the
whole attempt and the loser is told, instead of half-writing. Not the reason the
procedure was built, and worth saying out loud in the merge notes because
nothing in the diff looks like a bug fix.

### What the transport taught that the ADR could not have known

`docs/advisory-resolutions/5.1-realtime-transport.md` is thorough and its
measurements hold. Four things are true of the SSE transport that it had no way
to record, because three of them are about the CLIENT half and the fourth is
about the development topology:

- **The reconnect is not free of application meaning.** The ADR verified that
  the client resumes with `Last-Event-ID` against a real process kill. What that
  cannot show is the case where the client HAS no `Last-Event-ID` because the
  stream delivered nothing — which is the normal state of a meeting in recess,
  and which turned "resume" into "fresh subscribe" with a 3.0 s hole in it.
  **The ADR's spike emitted `tracked()` events continuously, so its stream was
  never quiet and the question never arose** — which is how a genuinely verified
  property came to be verified and still wrong. A resume protocol has to answer
  what "I have been here before" means for a client that has received nothing.
  Answered in Task 7's fix round: the server emits an id-bearing handshake on
  every connection, so there is always something for the client to say.
- **The number that matters to an operator is the GAP, not the deadline.** The
  ADR sets `SSE_MAX_STREAM_DURATION_MS` from an authorization-staleness
  argument, which is right. But the observable consequence is a 3000 ms window,
  twelve times an hour, in which this client is not listening — a figure that
  comes from `EventSource`'s default retry, not from anything in this codebase,
  and that the server can change any time it likes by sending a `retry:` field.
  Nothing currently does, and Task 7's fix round decided to keep it that way —
  see `routers/realtime.ts`'s "Why this stream sends no `retry:` field". In
  short: with the handshake in place that window is no longer LOSSY, only
  latent; `EventSource` applies `retry:` as a fixed interval with no backoff and
  no ceiling, so one number is both "how fast a healthy stream returns" and "how
  hard every client hammers a dead server"; and tRPC's producer emits no such
  frame and offers no option for one (verified in its bundled
  `sseStreamProducer`, which writes only `event:`/`data:`/`id:`/comment).
- **"Connecting" and "broken" are indistinguishable to the client, forever.** A
  server that is simply gone produces no `TRPCError` and no `event: return`, so
  `useSubscription` never leaves `connecting` and the banner never leaves amber.
  The three-state vocabulary is honest but has no terminal state for the most
  likely real outage, and no elapsed time at which it tells an operator to
  reload. **Decided at wave 6, Task 0** (see the "Wave 5, Task 7 — the browser
  check" finding (c) above for the full reasoning): this outlives Phase E — no
  wave 6 task touches the live transport, and a timeout ceiling is a
  retry/backoff policy decision, not a migration-completeness one. **Also
  recorded in `docs/backlog.md` (item 3)**, because this document is scoped to
  Phase E's own lifecycle and nothing reads it once the phase ends.
- **An intermediary can keep a dead stream looking alive.** Measured: with the
  API killed, a stream direct to it ends at once and a stream through the Vite
  dev proxy stays open indefinitely. Whatever sits between the browser and the
  API is part of this transport's failure model, and the ADR — which tested
  through real nginx, and correctly — does not say that the answer is a property
  of the proxy rather than of the protocol.

### What item 2 still does not say

Item 2 settles where a rule goes, which guard shape carries it, and that
board-scoped rules take a required `BoardScope`. Three things it does not
address, all of which wave 5 hit and worked around locally:

- **It is written one procedure at a time, and the client is not.** Wave 4, Task
  4 already named a flow spanning two guarded procedures; wave 5 found the
  transport-level version of the same gap — N procedures on ONE request, sharing
  ONE context, resolved CONCURRENTLY. Item 2 had nothing to say about what a
  context may hold that is not safe to share across the calls batched onto it,
  which is exactly the assumption `bindTenantAccess` got wrong. **Task 7's fix
  round added it** — see item 2's "a per-request unit of state is a design
  decision, not a default" — so this one is closed rather than carried forward.
- ~~It does not cover a SUBSCRIPTION's authorization lifetime as a rule, only as
  a comment. Neither is in item 2.~~ **False, re-checked in the single fix wave
  after wave 5's review — it IS in item 2**, in bold, inside item 2's own span:
  the "Subscriptions follow item 2's rule unchanged, plus one" subsection's
  "Authorization lifetime, stated rather than left implicit" paragraph states
  "Authorization is therefore evaluated when a stream opens and re-evaluated in
  full at every reconnect ... it is not re-evaluated between those points."
  `context.ts`'s header states the same thing (not the only place it lives, as
  this bullet used to claim) and `sse-bounds.test.ts` pins the bound. Fixed
  first among this wave's corrections, because as written it was a handoff to
  wave 6 inviting a duplicate of a rule item 2 already carries.
- **It says nothing about a write whose only client-supplied input is a
  `boardId` used solely to feed the guard.** Wave 5 threaded that prop into two
  components that had no `boardId` at all. The pattern is now everywhere in the
  live screen, the mismatch defence (`assertMatchesAuthorizedBoard`) is what
  makes it safe, and item 2 mentions the cost in passing without ever making the
  defence a required half of the pattern.
