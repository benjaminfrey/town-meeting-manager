#!/usr/bin/env python3
"""
Mutation-verify the authorization rules.

Stage 1, Task D1, Step 6. For each rule, delete the check — replace the guard's
body with an unconditional "allow" — run the authorization suite, and record
which tests noticed. A rule whose tests still pass with its check removed is
not protecting anything, however carefully it is written.

This project has repeatedly shipped tests that passed against reverted-to-broken
code, twice caught by the implementer rather than by review, so the evidence
below is generated rather than asserted. The script edits a working copy of
`src/trpc/authorization/rules.ts`, restores it byte-for-byte afterwards
(SHA-256 verified), and refuses to continue if the restore does not match.

The one failure this harness must never have is a MANUFACTURED kill: a mutation
that lands on the wrong region, breaks the file, reddens the suite, and is
recorded as proof that a rule is protected. So the body is located with the
TypeScript parser rather than by pattern, the mutated file must PARSE before
any test runs, and no declaration other than the mutated one may change. See
the block above `ANALYZER` for what each of those catches and what it does not.

Usage:  DATABASE_URL=... python3 scripts/mutate-authorization.py [--only NAME]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
API = HERE.parent
RULES = API / "src" / "trpc" / "authorization" / "rules.ts"

# rule id -> (function name, replacement body)
#
# "allow" bodies are chosen to be the *most plausible* wrong version of each
# guard: an empty body for an assert, `return true` for a predicate. That is
# what a guard looks like when someone deletes the condition but leaves the
# function, which is the realistic failure, not a syntax error.
ALLOW = "  /* MUTATED: check removed */"
TRUE = "  return true;"
# Rule 4b.user_account_update as it was BEFORE the column restriction: the
# faithful row-level restoration, which authorizes self-promotion to admin.
SELF_ROW_ONLY = (
    "  if (isAdmin(actor)) return;\n"
    "  if (actor.userAccountId !== null && subject.userAccountId === actor.userAccountId) return;\n"
    "  throw new AuthorizationError('refused');"
)

# ─── The board-scope mutants ──────────────────────────────────────────────
#
# A different KIND of mutant from the ones above. These do not remove a check;
# they remove the BOARD from one, leaving a guard that still refuses an account
# with no permission at all and still reads exactly like a working guard. That
# is what every one of these sixteen looked like before D1d, and it is a
# silent failure in both directions: an override that GRANTS is ignored, so a
# board-designated clerk is refused everywhere (the two `designated_boards`
# templates grant nothing else, so their accounts hold nothing at all), and an
# override that REVOKES is ignored too, so a barred clerk is ALLOWED.
#
# One per action family. A family's guards differ only in their message, so a
# test that notices the board being dropped from one would notice it in any of
# them; what a per-family mutant proves is that some test consults the override
# for that family's code at all.
DROP_BOARD_VOTE_INSERT = """  if (resolvePermission(actor, "M3")) return;

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

  throw new AuthorizationError("refused", { code: "M3" });"""

DROP_BOARD_MINUTES_SELECT = """  if (actor.kind !== "user") return false;
  if (ADOPTED_MINUTES_STATUSES.includes(row.status)) return true;
  return resolvePermission(actor, "R4");"""

DROP_BOARD_EXHIBIT_SELECT = """  switch (row.visibility) {
    case "public":
      return actor.kind === "user";
    case "board_only":
      return isAdmin(actor) || resolvePermission(actor, "A3") || isBoardMember(actor);
    case "admin_only":
      return isAdmin(actor) || resolvePermission(actor, "A3");
    default:
      return false;
  }"""

DROP_BOARD_EXHIBIT_INSERT = """  if (resolvePermission(actor, "A3") || isBoardMember(actor)) return;
  throw new AuthorizationError("refused", { code: "A3" });"""

MUTATIONS: list[tuple[str, str, str]] = [
    ("1", "assertCanInsertAgendaItem", ALLOW),
    ("2", "assertCanUpdateAgendaItem", ALLOW),
    ("3", "assertCanInsertMotion", ALLOW),
    ("4", "assertCanUpdateMotion", ALLOW),
    ("5", "assertCanInsertVoteRecord", ALLOW),
    ("6", "assertCanUpdateVoteRecord", ALLOW),
    ("7", "assertCanInsertMeetingAttendance", ALLOW),
    ("8", "assertCanUpdateMeetingAttendance", ALLOW),
    ("9", "canSelectMinutesDocument", TRUE),
    ("10", "assertCanInsertMinutesDocument", ALLOW),
    ("11", "assertCanUpdateMinutesDocument", ALLOW),
    ("12", "assertCanInsertMinutesSection", ALLOW),
    ("13", "assertCanUpdateMinutesSection", ALLOW),
    ("14", "canSelectExhibit", TRUE),
    ("15", "assertCanInsertExhibit", ALLOW),
    ("16", "assertCanUpdateExhibit", ALLOW),
    ("17", "assertCanSelectNotificationEvent", ALLOW),
    ("18", "canSelectNotificationDelivery", TRUE),
    ("19", "canSelectSubscriberPreference", TRUE),
    ("20", "assertCanInsertMeeting", ALLOW),
    ("21", "assertCanUpdateMeeting", ALLOW),
    # Phase B report §4b — the admin gates and the self-scoping rules.
    ("4b.town_update", "assertCanUpdateTown", ALLOW),
    ("4b.person_insert", "assertCanInsertPerson", ALLOW),
    ("4b.person_update", "assertCanUpdatePerson", ALLOW),
    ("4b.user_account_insert", "assertCanInsertUserAccount", ALLOW),
    ("4b.user_account_update", "assertCanUpdateUserAccount", ALLOW),
    ("4b.user_account_self_promotion", "assertCanUpdateUserAccount", SELF_ROW_ONLY),
    ("4b.board_insert", "assertCanInsertBoard", ALLOW),
    ("4b.board_update", "assertCanUpdateBoard", ALLOW),
    ("4b.board_member_insert", "assertCanInsertBoardMember", ALLOW),
    ("4b.board_member_update", "assertCanUpdateBoardMember", ALLOW),
    ("4b.agenda_template_insert", "assertCanInsertAgendaTemplate", ALLOW),
    ("4b.agenda_template_update", "assertCanUpdateAgendaTemplate", ALLOW),
    ("4b.agenda_template_delete", "assertCanDeleteAgendaTemplate", ALLOW),
    ("4b.permission_template_insert", "assertCanInsertPermissionTemplate", ALLOW),
    ("4b.permission_template_update", "assertCanUpdatePermissionTemplate", ALLOW),
    ("4b.permission_template_delete", "assertCanDeletePermissionTemplate", ALLOW),
    ("4b.notification_config_select", "assertCanSelectTownNotificationConfig", ALLOW),
    ("4b.notification_config_insert", "assertCanInsertTownNotificationConfig", ALLOW),
    ("4b.notification_config_update", "assertCanUpdateTownNotificationConfig", ALLOW),
    ("4b.notification_event_insert", "assertCanInsertNotificationEvent", ALLOW),
    ("4b.notification_delivery_insert", "assertCanInsertNotificationDelivery", ALLOW),
    ("4b.audit_log_select", "assertCanSelectAuditLog", ALLOW),
    ("4b.audit_log_insert", "assertCanInsertAuditLog", ALLOW),
    ("4b.subscriber_pref_insert", "assertCanInsertSubscriberPreference", ALLOW),
    ("4b.subscriber_pref_update", "assertCanUpdateSubscriberPreference", ALLOW),
    # The public portal's read rules. Once the portal runs inside a tenant
    # context these are the only thing between the public and a town's drafts,
    # so they are mutated alongside the rest.
    ("portal.minutes", "portalCanSelectMinutesDocument", TRUE),
    ("portal.exhibit", "portalCanSelectExhibit", TRUE),
    ("portal.meeting", "portalCanSelectMeeting", TRUE),
    ("portal.agenda", "portalCanSelectAgenda", TRUE),
    ("portal.board", "portalCanSelectBoard", TRUE),
    ("portal.board_member", "portalCanSelectBoardMember", TRUE),
    # D1d — the board argument removed, one per action family. See the
    # DROP_BOARD_* definitions above for why these are their own kind.
    (
        "board.A2",
        "assertCanInsertAgendaItem",
        '  assertPermission(actor, "A2", { action: "to add an agenda item" });',
    ),
    (
        "board.M3",
        "assertCanInsertMotion",
        '  assertPermission(actor, "M3", { action: "to record a motion" });',
    ),
    ("board.M3.vote_insert", "assertCanInsertVoteRecord", DROP_BOARD_VOTE_INSERT),
    (
        "board.M2",
        "assertCanInsertMeetingAttendance",
        '  assertPermission(actor, "M2", { action: "to record attendance" });',
    ),
    (
        "board.R1",
        "assertCanInsertMinutesDocument",
        '  assertPermission(actor, "R1", { action: "to create minutes" });',
    ),
    ("board.R4", "canSelectMinutesDocument", DROP_BOARD_MINUTES_SELECT),
    ("board.A3.select", "canSelectExhibit", DROP_BOARD_EXHIBIT_SELECT),
    ("board.A3.insert", "assertCanInsertExhibit", DROP_BOARD_EXHIBIT_INSERT),
]


# ─── Locating a body: the parser, not markers ─────────────────────────────
#
# Every earlier version of this located the body brace lexically, and every one
# of them was wrong on some shape:
#
#   v1  "the first `{` after the name"          → mutated a PARAMETER'S type
#       (`row: { status: MinutesStatus }`), producing seven mutants that
#       "survived" and were in fact one broken mutator.
#   v2  "the first `{` that ends its line"      → mutated a multi-line object
#       RETURN type, and ran past an empty body (`): void {}`) into the NEXT
#       function.
#   v3  v2 plus a `BODY_MARKERS` sniff, asking whether the selected region
#       contains `return`/`throw`/`assert`/`if `/… — which is a heuristic
#       checking a heuristic. Verified 2026-08-28: it lets BOTH of these
#       through, unrefused, mutating the return type and leaving the guard's
#       body intact:
#
#           export function f(a: string): {
#             returned: boolean;          ← contains the substring "return"
#           } { assertPermission(...); }
#
#           export function f(a: string): {
#             // true if the caller may read it     ← contains "if "
#             allowed: boolean;
#           } { assertPermission(...); }
#
#       Both are the codebase's own idiom: `returned`/`if ` in a doc comment.
#
# So the locator is now the TypeScript parser itself. `ts.createSourceFile`
# gives the FunctionDeclaration's `body` node, whose span is the body by
# definition — there is no shape it is "wrong on", because it is not guessing.
# `BODY_MARKERS` is deleted rather than kept as a second opinion: a marker list
# that can veto a correct AST answer can only make things worse.
#
# ─── About the `assert` marker, honestly ──────────────────────────────────
#
# The brief noted that the 20 delegating guards (`assertPermission(actor, …)`
# and nothing else) satisfied `BODY_MARKERS` only through the substring
# "assert", so renaming that helper would have dropped all 20 to zero mutants.
# Two corrections, both verified rather than assumed:
#
#   - It would NOT have been silent. `replace_body` raised `SystemExit` on a
#     failed marker check, which aborts the whole run with a message. The
#     failure was loud but MISATTRIBUTED — it would have read "this is probably
#     a type annotation" about a perfectly ordinary body.
#   - The parse gate below would NOT have made it loud, because it never
#     arises: there is nothing left to fail. The AST locator does not read the
#     body's contents at all, so what the guards call inside themselves — and
#     what that helper is named — cannot affect whether they are mutated.
#
# Renaming a GUARD (not the helper) is still caught, by the "no exported
# function named X" refusal below, which aborts the run rather than scoring a
# rule that no longer exists as killed.
#
# ─── And about the parse gate, equally honestly ───────────────────────────
#
# The parse gate is real and it runs on every mutation, but on its own it would
# NOT have caught the first reproducer above. Measured: mutating that return
# type with the `ALLOW` body yields
#
#     export function f(a: string): {
#       /* MUTATED: check removed */
#     } { assertPermission(...); }
#
# which has ZERO parse errors — the return type merely became `{}` — and would
# have gone on to a green suite and a "SURVIVED (BAD)" verdict for a rule that
# was never touched. It DOES catch the `TRUE` body in the same position
# (`{ return true; }` is not a valid type literal: 2 parse errors). So the gate
# catches one half of that shape and the AST locator catches both. Neither is
# redundant; the claim that a mis-mutation is "by construction a syntax error"
# is false, and the harness must not rely on it.

ANALYZER = r"""
import ts from "typescript";

let source = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) source += chunk;

const sf = ts.createSourceFile("rules.ts", source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
const parseErrors = (sf.parseDiagnostics ?? []).map((d) => {
  const { line } = sf.getLineAndCharacterOfPosition(d.start ?? 0);
  return `line ${line + 1}: ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`;
});

const functions = {};
for (const st of sf.statements) {
  if (!ts.isFunctionDeclaration(st) || !st.name || !st.body) continue;
  const open = st.body.getStart(sf);
  const end = st.body.getEnd();
  functions[st.name.text] = {
    exported: (st.modifiers ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword),
    open,
    end,
    body: source.slice(open, end),
  };
}

process.stdout.write(JSON.stringify({ parseErrors, functions }));
"""


def analyze(source: str) -> dict:
    """
    Parse `source` with the TypeScript compiler: syntax errors + body spans.

    Run out of `packages/api` so the bare `typescript` specifier resolves to
    the same compiler the package builds with. Kept inline rather than as a
    checked-in `.mjs` so the harness stays one self-contained file.
    """
    proc = subprocess.run(
        ["node", "--input-type=module", "-e", ANALYZER],
        cwd=API,
        input=source,
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        raise SystemExit(
            "mutate: the TypeScript analyzer could not be run. Without it there is no "
            "way to locate a function body structurally, and guessing is what this "
            "harness exists to stop.\n" + proc.stderr.strip()
        )
    return json.loads(proc.stdout)


def replace_body(source: str, name: str, body: str) -> str:
    """
    Replace the body of `export function name(...)` with `body`.

    Three refusals, all loud, none of which can be reached by a genuine
    mutation (removing a guard's condition leaves a body that parses and a
    file whose other declarations are untouched):

      1. the function is not there, or is not exported — the harness would
         otherwise score a rule it never mutated;
      2. the result does not PARSE — the harness edited the wrong region, and
         the red suite that follows would be recorded as a kill;
      3. any OTHER declaration's body changed — the locator lost its place and
         deleted a different rule, which also produces a red suite and also
         looks like a kill.
    """
    before = analyze(source)
    if before["parseErrors"]:
        raise SystemExit(
            "mutate: the source does not parse BEFORE any mutation:\n  "
            + "\n  ".join(before["parseErrors"][:5])
        )

    fn = before["functions"].get(name)
    if fn is None:
        raise SystemExit(
            f"mutate: no exported function named {name} in {RULES}. Refusing rather "
            "than skipping it — a rule that has been renamed away is not a rule that "
            "passed."
        )
    if not fn["exported"]:
        raise SystemExit(f"mutate: {name} is not exported; the guards all are. Refusing.")

    mutated = source[: fn["open"] + 1] + "\n" + body + "\n" + source[fn["end"] - 1 :]

    # ─── The parse gate ───────────────────────────────────────────────────
    after = analyze(mutated)
    if after["parseErrors"]:
        raise SystemExit(
            f"mutate: {RULES.name} does not parse after mutating {name}. A genuine "
            "mutation — a guard with its condition removed — still parses, so this "
            "means the harness edited the wrong region. Refusing: the suite would go "
            f"red for a syntax error and the mutant would be scored as killed.\n  "
            + "\n  ".join(after["parseErrors"][:5])
        )

    # ─── And nothing else moved ───────────────────────────────────────────
    lost = sorted(set(before["functions"]) - set(after["functions"]))
    changed = sorted(
        n
        for n, f in after["functions"].items()
        if n not in before["functions"] or before["functions"][n]["body"] != f["body"]
    )
    if lost or changed != [name]:
        raise SystemExit(
            f"mutate: mutating {name} changed {changed or 'nothing'}"
            + (f" and lost {lost}" if lost else "")
            + ". Exactly one body must change, and it must be the named one. Refusing."
        )

    return mutated


def self_test() -> int:
    """
    Prove the locator handles the shapes earlier versions got wrong, and that
    the parse gate and the neighbour check refuse rather than score.

    None of these shapes is in `rules.ts` today, which is exactly why this is a
    test and not a comment: the next guard someone writes may have one, and
    every failure mode here is one that produces a CONFIDENT WRONG ANSWER
    rather than an error.
    """
    neighbour = "export function g(): void {\n  throw new Error('g');\n}\n"

    # (label, source, name, body, the return-type text that must SURVIVE,
    #  a token of the original body that must be GONE)
    mutate_correctly = [
        (
            "multi-line object return type",
            "export function f(a: string): {\n  x: string;\n} {\n  return { x: a };\n}\n" + neighbour,
            "f",
            ALLOW,
            "x: string;",
            "return { x: a }",
        ),
        (
            "return type whose property contains a marker substring",
            "export function f(a: string): {\n  returned: boolean;\n} {\n"
            '  assertPermission(a, "A2", { action: "x" });\n  return { returned: true };\n}\n' + neighbour,
            "f",
            ALLOW,
            "returned: boolean;",
            "assertPermission",
        ),
        (
            "return type carrying an inline comment containing `if `",
            "export function f(a: string): {\n  // true if the caller may read it\n"
            "  allowed: boolean;\n} {\n"
            '  assertPermission(a, "A2", { action: "x" });\n  return { allowed: true };\n}\n' + neighbour,
            "f",
            ALLOW,
            "// true if the caller may read it",
            "assertPermission",
        ),
        (
            "empty body on the signature line",
            "export function f(): void {}\n\n" + neighbour,
            "f",
            ALLOW,
            "): void {",
            # An empty body has no token to lose; assert on the marker itself.
            "MUTATED: check removed",
        ),
        (
            "predicate with a multi-line object return type, `return true` body",
            "export function f(a: string): {\n  returned: boolean;\n} {\n  return { returned: !!a };\n}\n"
            + neighbour,
            "f",
            "  return { returned: true };",
            "returned: boolean;",
            "!!a",
        ),
    ]

    # (label, source, name, body) — each must raise.
    must_refuse = [
        (
            "a guard that has been renamed away",
            "export function f(): void {\n  throw new Error('f');\n}\n",
            "assertCanDoSomethingRenamed",
            ALLOW,
        ),
        (
            "a function that is not exported",
            "function f(): void {\n  throw new Error('f');\n}\n" + neighbour,
            "f",
            ALLOW,
        ),
        (
            "a replacement body that does not parse (the parse gate)",
            "export function f(): void {\n  throw new Error('f');\n}\n" + neighbour,
            "f",
            "  return {;",
        ),
        (
            "a source that was already broken",
            "export function f(): void {\n  throw new Error('f';\n}\n",
            "f",
            ALLOW,
        ),
    ]

    failures = 0

    for label, source, name, body, keep, gone in mutate_correctly:
        try:
            mutated = replace_body(source, name, body)
        except SystemExit as err:
            print(f"  FAILED ({label}): refused a legitimate mutation — {str(err).splitlines()[0][:90]}")
            failures += 1
            continue
        problems = []
        if keep not in mutated:
            problems.append("the signature/return type was destroyed")
        if gone in source and gone in mutated:
            problems.append("the body was not replaced")
        if gone not in source and gone not in mutated:
            problems.append("the replacement body was not inserted")
        if neighbour in source and "throw new Error('g')" not in mutated:
            problems.append("the neighbouring function was destroyed")
        if problems:
            print(f"  MIS-MUTATED ({label}): {'; '.join(problems)}")
            failures += 1
        else:
            print(f"  ok ({label})")

    for label, source, name, body in must_refuse:
        try:
            replace_body(source, name, body)
        except SystemExit as err:
            print(f"  refused ({label}): {str(err).splitlines()[0][:90]}…")
            continue
        print(f"  MUTATED WITHOUT REFUSING ({label}) — this shape would be scored, wrongly")
        failures += 1

    print("self-test: " + ("PASS" if failures == 0 else f"{failures} FAILED"))
    return failures


def run_suite() -> tuple[bool, list[str]]:
    """Run the authorization suite; return (passed, failing test names)."""
    proc = subprocess.run(
        ["npx", "vitest", "run", "src/trpc", "--reporter=json", "--silent"],
        cwd=API,
        capture_output=True,
        text=True,
    )
    stdout = proc.stdout
    start = stdout.find("{")
    failing: list[str] = []
    if start != -1:
        try:
            report = json.loads(stdout[start:])
            for suite in report.get("testResults", []):
                for assertion in suite.get("assertionResults", []):
                    if assertion.get("status") == "failed":
                        failing.append(assertion.get("fullName", "?"))
        except json.JSONDecodeError:
            pass
    return proc.returncode == 0, failing


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--only")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()

    if args.self_test:
        return 1 if self_test() else 0

    if self_test():
        print("refusing to run: the mutator mis-handles a known shape", file=sys.stderr)
        return 2

    original = RULES.read_text()
    digest = hashlib.sha256(original.encode()).hexdigest()
    print(f"rules.ts sha256 before: {digest}\n")

    results: list[tuple[str, str, bool, list[str]]] = []
    restored = False
    try:
        for rule_id, name, body in MUTATIONS:
            if args.only and args.only not in (rule_id, name):
                continue
            RULES.write_text(replace_body(original, name, body))
            passed, failing = run_suite()
            results.append((rule_id, name, passed, failing))
            verdict = "SURVIVED (BAD)" if passed else "killed"
            print(f"[{rule_id:32}] {name:42} {verdict}")
            for f in failing[:4]:
                print(f"      ↳ {f}")
    finally:
        RULES.write_text(original)
        after = hashlib.sha256(RULES.read_text().encode()).hexdigest()
        print(f"\nrules.ts sha256 after:  {after}")
        restored = after == digest

    if not restored:
        print("RESTORE FAILED — rules.ts does not match the original", file=sys.stderr)
        return 2

    survived = [r for r in results if r[2]]
    print(f"\n{len(results) - len(survived)}/{len(results)} mutations killed")
    if survived:
        print("SURVIVING MUTANTS (rules with no test that notices):", file=sys.stderr)
        for rule_id, name, _, _ in survived:
            print(f"  {rule_id}  {name}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
