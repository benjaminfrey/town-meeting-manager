/**
 * Conventions item 8, "Pin the writers, not just the readers" — mechanized.
 *
 * That item's own prose roster ("six writers carry the pin as of `2d78964`
 * ... re-run `grep -rl "\.pathFilter()" packages/web/src` rather than trust
 * the count above staying current") was exactly the kind of rule a human has
 * to remember to re-check, the same shape item 7's own paragraph named
 * before `cache-key-parity.test.ts` replaced it. This is that replacement
 * for item 8: for every non-test file whose code (comments stripped) calls
 * `trpc.<router>.pathFilter()`, at least one test file must IMPORT it (or
 * `vi.mock` it) and itself assert `isInvalidated` or call `countFor(` — the
 * two shapes conventions item 8's own writer-pin examples use.
 *
 * ─── Why filename matching was rejected ────────────────────────────────
 *
 * An earlier design matched a writer to "its" test by filename
 * (`Foo.tsx` → `Foo.test.tsx`). Rejected on two real cases in this tree:
 * `routes/boards.$boardId.templates.$templateId.edit.tsx`'s test lives at
 * `routes/boards.$boardId.templates.$templateId.edit.test.tsx` — OUTSIDE any
 * `__tests__/` directory, so a check that only looked inside `__tests__/`
 * would miss it; and a hypothetical `edit.pathfilter.test.tsx` (a test
 * someone names for a narrower slice of a large file) would neither look
 * like nor be found by a bare basename-prefix match. Import resolution sees
 * both correctly, because it asks the question that actually matters —
 * "does some test actually load this module" — instead of guessing from a
 * naming convention nothing enforces.
 *
 * ─── Why comment-stripping is load-bearing ─────────────────────────────
 *
 * Without it, `routes/people.tsx` (a comment: "would make
 * `trpc.person.pathFilter()` a...") and `test/trpc.ts` (its own doc comment,
 * quoting `trpc.board.pathFilter()` and `trpc.<router>.pathFilter()` as
 * prose, twice) both false-positive as writers — neither calls it in real
 * code. Confirmed by running the raw (non-stripped) version of this check at
 * HEAD: 28 files contain the literal substring `.pathFilter()`; 26 do after
 * stripping `/* *\/` and `//` comments — the same two files conventions item
 * 11's marker-grep warns about for the identical reason (a grep that cannot
 * tell a comment from code).
 *
 * ─── Validated against history, not assumed ────────────────────────────
 *
 * Run via `git archive <sha> -- packages/web/src` against three real
 * commits from this wave (this exact algorithm, not a hand-wave):
 *
 *   - HEAD (this wave's final fix round): 26 writers, 0 violations.
 *   - `3b22df8`: 16 writers, 3 violations — `AddMemberDialog.tsx`,
 *     `MemberArchiveDialog.tsx`, `MemberTransitionDialog.tsx` (the three
 *     writers conventions item 8's own history names as unpinned at that
 *     commit).
 *   - `081a27e`: 25 writers, 1 violation — `MemberRoster.tsx` (the writer
 *     Task 3's own fix round named and closed).
 *
 * All three match the finding this check exists to mechanize exactly, by
 * file and by count.
 *
 * ─── What this does NOT check (see conventions.md's Known-gaps entry) ─────
 *
 * A test importing a writer and asserting `isInvalidated`/`countFor(`
 * ANYWHERE in the file passes, even if that assertion is about a totally
 * different procedure than the one the writer's `pathFilter()` call
 * actually invalidates. That is item 8's own "pin the writers" claim (a
 * writer is tested at all) — NOT item 8's harder, explicitly-declined claim
 * that the RIGHT procedure is being asserted on. `installTRPCFetchStub`'s
 * handler map already keys on every procedure path, so a test that named the
 * wrong procedure name would not even compile — the real gap the reviewer
 * measured (Task 3's three unpinned invalidations) was a MISSING assertion,
 * not a wrong one, and a hand-tried "require the test to name the specific
 * procedure" check caught nothing beyond what this simpler shape already
 * catches. See conventions item 4c / the Known-gaps entry for the
 * per-mutation half this leaves to a scripted deletion sweep instead.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const PROJECT_ROOT = path.resolve(__dirname, "../../../../..");
const SRC_DIR = path.join(PROJECT_ROOT, "packages/web/src");

function walk(dir: string, opts: { excludeTestFiles: boolean }): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      if (opts.excludeTestFiles && entry.name === "__tests__") continue;
      out.push(...walk(full, opts));
    } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
      if (opts.excludeTestFiles && entry.name.includes(".test.")) continue;
      out.push(full);
    }
  }
  return out;
}

/**
 * Strips `/* *\/` block comments and `//` line comments. Deliberately
 * conservative about the latter: a `//` immediately preceded by `:` (the
 * `http://`/`https://` shape) is left alone, so a URL inside a string
 * literal or a real comment mentioning one is not mangled into eating the
 * rest of its line. Good enough for this repo's style — see this file's own
 * header for what it exists to fix (`people.tsx`, `test/trpc.ts`).
 */
function stripComments(src: string): string {
  let out = src.replace(/\/\*[\s\S]*?\*\//g, "");
  out = out.replace(/(^|[^:])\/\/.*/gm, "$1");
  return out;
}

/** Resolve an import/`vi.mock` specifier to a local file's base path (no extension), or null for a bare package specifier. */
function resolveSpecifier(specifier: string, fromFile: string, srcDir: string): string | null {
  if (specifier.startsWith("@/")) return path.join(srcDir, specifier.slice(2));
  if (specifier.startsWith(".")) return path.resolve(path.dirname(fromFile), specifier);
  return null;
}

function candidatePaths(base: string): string[] {
  return [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
  ];
}

const SPECIFIER_RE = /(?:from\s+["']([^"']+)["'])|(?:vi\.mock\(\s*["']([^"']+)["'])/g;

interface Result {
  writerCount: number;
  violations: string[];
}

/** The check both the real scan and the synthetic pins below run. */
function findUnpinnedWriters(srcDir: string): Result {
  const writerFiles = walk(srcDir, { excludeTestFiles: true });
  const writers: string[] = [];
  for (const file of writerFiles) {
    const stripped = stripComments(fs.readFileSync(file, "utf8"));
    if (/trpc\.\w+\.pathFilter\(\)/.test(stripped)) writers.push(file);
  }

  const allFiles = walk(srcDir, { excludeTestFiles: false });
  const testFiles = allFiles.filter((f) => path.basename(f).includes(".test."));

  const pinned = new Set<string>();
  for (const testFile of testFiles) {
    const content = fs.readFileSync(testFile, "utf8");
    if (!/isInvalidated|countFor\(/.test(content)) continue;

    const resolvedTargets = new Set<string>();
    SPECIFIER_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = SPECIFIER_RE.exec(content))) {
      const spec = m[1] ?? m[2];
      if (!spec) continue;
      const base = resolveSpecifier(spec, testFile, srcDir);
      if (!base) continue;
      for (const candidate of candidatePaths(base)) resolvedTargets.add(path.normalize(candidate));
    }
    for (const writer of writers) {
      if (resolvedTargets.has(path.normalize(writer))) pinned.add(writer);
    }
  }

  const violations = writers.filter((w) => !pinned.has(w)).map((w) => path.relative(srcDir, w));
  return { writerCount: writers.length, violations };
}

describe("pathFilter() pin coverage: every writer calling trpc.<router>.pathFilter() has a test that imports it and asserts the invalidation", () => {
  it("has zero violations across packages/web/src", () => {
    const { violations } = findUnpinnedWriters(SRC_DIR);
    const message = violations
      .map(
        (f) =>
          `${f}: calls trpc.<router>.pathFilter() but no test file imports it and asserts ` +
          `isInvalidated/countFor( — conventions item 8's "pin the writers, not just the readers".`,
      )
      .join("\n");
    expect(violations, message).toEqual([]);
  });
});

describe("the check itself", () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "pathfilter-pin-"));
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

  it("catches a writer with no test importing it", () => {
    writeFixture(
      "components/Widget.tsx",
      `
      export function Widget() {
        void queryClient.invalidateQueries(trpc.board.pathFilter());
      }
      `,
    );
    const { violations } = findUnpinnedWriters(tmpRoot);
    expect(violations).toEqual(["components/Widget.tsx"]);
  });

  it("passes a writer whose test imports it via a relative specifier and asserts isInvalidated", () => {
    writeFixture(
      "components/Widget.tsx",
      `void queryClient.invalidateQueries(trpc.board.pathFilter());`,
    );
    writeFixture(
      "components/__tests__/Widget.test.tsx",
      `
      import { Widget } from "../Widget";
      it("invalidates", () => {
        expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true);
      });
      `,
    );
    expect(findUnpinnedWriters(tmpRoot).violations).toEqual([]);
  });

  it("passes a writer whose test imports it via an @/ specifier and calls countFor(", () => {
    writeFixture(
      "components/Widget.tsx",
      `void queryClient.invalidateQueries(trpc.board.pathFilter());`,
    );
    writeFixture(
      "components/__tests__/Widget.test.tsx",
      `
      import { Widget } from "@/components/Widget";
      it("refetches", () => {
        expect(stub.countFor("board.detail")).toBeGreaterThan(0);
      });
      `,
    );
    expect(findUnpinnedWriters(tmpRoot).violations).toEqual([]);
  });

  it("passes a writer whose test reaches it only through vi.mock(...)", () => {
    writeFixture(
      "components/Widget.tsx",
      `void queryClient.invalidateQueries(trpc.board.pathFilter());`,
    );
    writeFixture(
      "components/__tests__/Widget.test.tsx",
      `
      vi.mock("@/components/Widget", () => ({ Widget: () => null }));
      it("invalidates", () => {
        expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true);
      });
      `,
    );
    expect(findUnpinnedWriters(tmpRoot).violations).toEqual([]);
  });

  /**
   * The exact shape found in this tree: a route test that lives OUTSIDE any
   * `__tests__/` directory, sitting right next to the route it tests. A
   * filename-only matcher might get this one right by luck; this fixture
   * makes sure import resolution — the actual mechanism — is what is being
   * exercised, not a naming coincidence.
   */
  it("finds a test file that lives outside any __tests__/ directory", () => {
    writeFixture(
      "routes/widget.tsx",
      `void queryClient.invalidateQueries(trpc.board.pathFilter());`,
    );
    writeFixture(
      "routes/widget.test.tsx",
      `
      import { WidgetPage } from "./widget";
      it("invalidates", () => {
        expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true);
      });
      `,
    );
    expect(findUnpinnedWriters(tmpRoot).violations).toEqual([]);
  });

  /**
   * The false-positive this check must NOT fall into: a test file whose
   * NAME looks related to the writer (a plausible `Foo.pathfilter.test.tsx`
   * a human might write for a narrow slice) but which does not actually
   * import it. A filename-substring matcher would wrongly pass this; import
   * resolution correctly still flags it.
   */
  it("does NOT count a same-looking filename with no real import as a pin", () => {
    writeFixture(
      "components/Widget.tsx",
      `void queryClient.invalidateQueries(trpc.board.pathFilter());`,
    );
    writeFixture(
      "components/__tests__/Widget.pathfilter.test.tsx",
      `
      import { OtherThing } from "../OtherThing";
      it("invalidates something else", () => {
        expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true);
      });
      `,
    );
    const { violations } = findUnpinnedWriters(tmpRoot);
    expect(violations).toEqual(["components/Widget.tsx"]);
  });

  it("does not count a test that imports the writer but never asserts an invalidation", () => {
    writeFixture(
      "components/Widget.tsx",
      `void queryClient.invalidateQueries(trpc.board.pathFilter());`,
    );
    writeFixture(
      "components/__tests__/Widget.test.tsx",
      `
      import { Widget } from "../Widget";
      it("renders", () => {
        expect(screen.getByText("hi")).toBeInTheDocument();
      });
      `,
    );
    expect(findUnpinnedWriters(tmpRoot).violations).toEqual(["components/Widget.tsx"]);
  });

  /**
   * Comment-stripping — the two real false positives this check exists to
   * avoid, reproduced as fixtures: a `pathFilter()` mention inside a `//`
   * comment and inside a `/** *\/` block comment must not make the file a
   * "writer" at all, so it needs no pin.
   */
  it("does not treat a pathFilter() mention inside a comment as a writer", () => {
    writeFixture(
      "routes/prose.tsx",
      `
      // would make trpc.board.pathFilter() redundant with the join above
      /**
       * See trpc.board.pathFilter() for the shape this replaces.
       */
      export function Prose() {}
      `,
    );
    expect(findUnpinnedWriters(tmpRoot).violations).toEqual([]);
    expect(findUnpinnedWriters(tmpRoot).writerCount).toBe(0);
  });

  it("ignores __tests__ directories and .test. files as writer candidates", () => {
    writeFixture(
      "__tests__/Broken.test.tsx",
      `void queryClient.invalidateQueries(trpc.board.pathFilter());`,
    );
    writeFixture("Broken.test.tsx", `void queryClient.invalidateQueries(trpc.board.pathFilter());`);
    expect(findUnpinnedWriters(tmpRoot).violations).toEqual([]);
  });
});
