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
]


def find_body_brace(source: str, start: int, name: str) -> int:
    """
    Index of the `{` that opens a function's BODY.

    Not simply the first `{` after the name. Several of these guards take an
    inline object type — `row: { status: MinutesStatus }` — and taking the
    first brace mutates the PARAMETER'S TYPE instead of the body. The first
    version of this script did exactly that, and the result was seven mutants
    that "survived": the guards whose signatures contain a brace, and only
    those. They looked like seven unprotected rules and were in fact one broken
    mutator. Recorded here because a mutation harness that silently mutates the
    wrong thing produces false confidence in both directions — it can report a
    rule as unprotected when it is fine, and it can report a mutant as killed
    when the kill came from a syntax error rather than from the rule.

    So: step over the parameter list by paren depth first, then take the first
    `{` that is the last thing on its line, which is what a body brace is and
    an inline type brace is not.
    """
    i = source.index("(", start)
    depth = 0
    while i < len(source):
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
        i = source.index("{", i)
        end_of_line = source.index("\n", i)
        if source[i + 1 : end_of_line].strip() == "":
            return i
        i += 1


def replace_body(source: str, name: str, body: str) -> str:
    """Replace the body of `export function name(...)` with `body`."""
    match = re.search(
        rf"^export (?:async )?function {re.escape(name)}\b", source, re.MULTILINE
    )
    if not match:
        raise SystemExit(f"mutate: no function named {name} in {RULES}")

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

    return source[: open_brace + 1] + "\n" + body + "\n" + source[i:]


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
    args = parser.parse_args()

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
