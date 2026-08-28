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

Usage:  DATABASE_URL=... python3 scripts/mutate-authorization.py [--only NAME]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
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
]


def declaration_span(source: str, start: int) -> int:
    """
    Index at which this declaration ends — the next top-level `export`, or EOF.

    Bounds every search below. Without it, a scan that fails to find what it is
    looking for runs forward into the NEXT function and mutates that instead,
    silently, while still reporting a kill.
    """
    nxt = re.search(r"^export ", source[start:], re.MULTILINE)
    return start + nxt.start() if nxt else len(source)


def find_body_brace(source: str, start: int, name: str) -> int:
    """
    Index of the `{` that opens a function's BODY.

    Not simply the first `{` after the name. Several of these guards take an
    inline object type — `row: { status: MinutesStatus }` — and taking the
    first brace mutates the PARAMETER'S TYPE instead of the body. The first
    version of this script did exactly that, and the result was seven mutants
    that "survived": the guards whose signatures contain a brace, and only
    those. They looked like seven unprotected rules and were in fact one broken
    mutator.

    That was fixed with a second heuristic — "the first `{` that is the last
    thing on its line" — and a heuristic is not a check. Review found two more
    shapes it gets wrong, neither of which exists in `rules.ts` today:

      1. a multi-line object RETURN type mutates the type, leaving the body
         intact. The file then fails to parse, the whole suite goes red, and
         the mutant is reported "killed" while the rule was never removed;
      2. an empty body (`): void {}`, which Prettier emits) has no
         last-on-its-line `{`, so the scan runs past the end of the
         declaration and mutates the NEXT function.

    A mutation harness that silently mutates the wrong thing produces false
    confidence in both directions. So the heuristic stays, and `replace_body`
    now VERIFIES what it selected: the span bound below catches (2), and the
    "does the replaced region look like a body" check catches (1). Both refuse
    loudly instead of mutating.
    """
    end = declaration_span(source, start)

    # Step over the parameter list by paren depth.
    i = source.index("(", start)
    depth = 0
    while i < end:
        if source[i] == "(":
            depth += 1
        elif source[i] == ")":
            depth -= 1
            if depth == 0:
                break
        i += 1
    else:  # pragma: no cover
        raise SystemExit(f"mutate: unbalanced parentheses in {name}'s parameter list")

    while True:
        brace = source.find("{", i)
        if brace == -1 or brace >= end:
            raise SystemExit(
                f"mutate: could not find a body brace for {name} within its own "
                "declaration. Refusing rather than scanning into the next function — "
                "an empty body `{}` on the signature line is the known shape that "
                "does this."
            )
        end_of_line = source.index("\n", brace)
        if source[brace + 1 : end_of_line].strip() == "":
            return brace
        i = brace + 1


BODY_MARKERS = ("return", "throw", "assert", "if ", "for ", "switch")


def replace_body(source: str, name: str, body: str) -> str:
    """Replace the body of `export function name(...)` with `body`."""
    match = re.search(
        rf"^export (?:async )?function {re.escape(name)}\b", source, re.MULTILINE
    )
    if not match:
        raise SystemExit(f"mutate: no function named {name} in {RULES}")

    end = declaration_span(source, match.end())
    open_brace = find_body_brace(source, match.end(), name)
    depth = 0
    i = open_brace
    while i < len(source):
        if source[i] == "{":
            depth += 1
        elif source[i] == "}":
            depth -= 1
            if depth == 0:
                break
        i += 1
    else:  # pragma: no cover
        raise SystemExit(f"mutate: unbalanced braces around {name}")

    # ─── The checks, not more heuristics ──────────────────────────────────
    #
    # Everything replaced must lie inside THIS declaration. A region running
    # past it means the locator lost its place and is about to delete a
    # different function's body — which would still make the suite fail, and
    # would still be reported as a kill.
    if i > end:
        raise SystemExit(
            f"mutate: the region selected for {name} runs past the end of its own "
            f"declaration. Refusing."
        )

    # And it must look like a BODY, not a type. A multi-line object return
    # type is brace-balanced and passes every structural check; what it does
    # not contain is control flow. Getting this wrong yields a syntax error,
    # a red suite, and a "killed" verdict for a rule that was never removed.
    region = source[open_brace + 1 : i]
    if not any(marker in region for marker in BODY_MARKERS):
        raise SystemExit(
            f"mutate: the region selected for {name} contains no control flow "
            f"({', '.join(BODY_MARKERS)}), so it is probably a type annotation and "
            "not the function body. Refusing rather than producing a syntax error "
            "that would look like a killed mutant."
        )

    return source[: open_brace + 1] + "\n" + body + "\n" + source[i:]


def self_test() -> int:
    """
    Prove the locator refuses the two shapes it used to get wrong.

    Neither shape is in `rules.ts` today, which is exactly why this is a test
    and not a comment: the next guard someone writes may have one, and the
    failure is silent.
    """
    cases = [
        (
            "multi-line object return type",
            "export function f(a: string): {\n  x: string;\n} {\n  return { x: a };\n}\n"
            "export function g(): void {\n  throw new Error('g');\n}\n",
            "f",
        ),
        (
            "empty body on the signature line",
            "export function f(): void {}\n\nexport function g(): void {\n  throw new Error('g');\n}\n",
            "f",
        ),
    ]
    failures = 0
    for label, source, name in cases:
        try:
            mutated = replace_body(source, name, ALLOW)
        except SystemExit as err:
            print(f"  refused ({label}): {str(err).splitlines()[0][:80]}…")
            continue
        # If it did not refuse, it must at least not have touched `g`.
        if "throw new Error('g')" not in mutated:
            print(f"  MIS-MUTATED ({label}): the neighbouring function was destroyed")
            failures += 1
        else:
            print(f"  MUTATED WITHOUT REFUSING ({label}) — check this shape by hand")
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
