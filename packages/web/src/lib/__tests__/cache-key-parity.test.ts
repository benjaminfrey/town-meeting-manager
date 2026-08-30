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
 * `MIGRATED` is three lines, hand-maintained on purpose. Growing it
 * is exactly the moment this rule should fire for a newly-migrated entity,
 * so it stays a deliberate edit, not a derived one. Update it in the same
 * commit a router's read moves off `queryKeys.<x>` and its `pathFilter()`
 * becomes the thing writers owe (conventions item 7).
 *
 * ─── Why the match is scoped to a window, not the whole file ──────────────
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
        void queryClient.invalidateQueries({ queryKey: queryKeys.invitations.byTown(townId) });
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
