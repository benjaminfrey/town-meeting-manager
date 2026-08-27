# Town Meeting Manager Revival — Master Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate Town Meeting Manager off self-hosted Supabase onto Postgres + tRPC + Drizzle + Better Auth, repair what the revival audit found, then finish the originally envisioned Phase 2 and Phase 3 feature work.

**Architecture:** A single Fastify 5 process hosts tRPC (application data), Better Auth (`/api/auth/*`), and existing REST routes (webhooks, public portal, documents), all behind nginx at same-origin `/api`. Drizzle talks to Postgres through `pg.Pool`; every request runs inside a transaction that sets `app.town_id` via `SET LOCAL`, and Postgres RLS enforces tenancy as a backstop while the 30-action permission matrix lives in tested TypeScript. Live-meeting sync is tRPC SSE subscriptions fed by Postgres `LISTEN/NOTIFY` through one dedicated `postgres.js` connection.

**Tech Stack:** TypeScript · pnpm + turbo monorepo · Fastify 5 · tRPC 11 · Drizzle ORM · Better Auth · PostgreSQL · React 19 · React Router v7 (SPA) · TanStack Query v5 · Tailwind v4 · shadcn/ui · Vitest · Playwright · nginx

**Spec:** [2026-08-26-tmm-revival-design.md](../specs/2026-08-26-tmm-revival-design.md)
**Audit:** [2026-08-25-revival-audit.md](../../audit/2026-08-25-revival-audit.md)

---

## Global Constraints

Every task's requirements implicitly include this section.

- **`drizzle-orm` >= 0.45.2 is a security floor, not a preference.** Below it, GHSA-gpj5-g38j-94v9 is a CVSS 7.5 SQL injection via improperly escaped identifiers. Pin at 0.45.2; pair with `drizzle-zod` 0.8.3.
- **Do not adopt `drizzle-orm` v1.0.0-rc.** The documentation site documents the RC's `drizzle-orm/zod` subpath, which does not exist in 0.45.2. Debugging our migration and a release candidate simultaneously is not an acceptable trade.
- **Better Auth must be >= 1.7.1**, with `emailAndPassword.requireEmailVerification: true` and `organization({ requireEmailVerificationOnInvitation: true })`. These two settings negate GHSA-fmh4-wcc4-5jm3 (unauthorized invitation acceptance). Enable only plugins actually used.
- **Better Auth CLI is the `auth` package** (`npx auth@latest generate`). The old `@better-auth/cli` is stale; older tutorials will mislead.
- **Tenant context uses `set_config('app.town_id', <id>, true)`.** The third argument `true` means `SET LOCAL` and reverts at transaction end. `false` or a bare `SET` leaks tenant context to the next request on that pooled connection. Never write either.
- **No PgBouncer.** Its transaction mode silently breaks `LISTEN/NOTIFY` and session advisory locks.
- **Two Postgres drivers, deliberately:** `pg` `Pool` for queries, `postgres.js` for the single dedicated `LISTEN` connection. `LISTEN` is per-session state and cannot use a pool.
- **`NOTIFY` payloads must be `{table, id, op}` only.** The payload cap is 8000 bytes; subscribers refetch through the normal tRPC query path, which also keeps authorization in one place.
- **Every SSE event goes through `tracked()`** so `lastEventId` resumes after a reconnect. A network blip must never silently swallow a motion or a vote.
- **No `CREATE INDEX CONCURRENTLY` inside a Drizzle migration.** All pending migrations run in one transaction. Run non-transactional DDL out of band.
- **Migrations are append-only.** Drizzle never re-checks applied hashes, so editing an applied file goes undetected. Enforce in review.
- **Node 20** (`.nvmrc`), **pnpm 9.15.4** (`packageManager`). Do not change either during this plan.
- **`turbo run test` must be run alone.** Running it concurrently with the dev server overloads the machine and produces spurious timeouts in unrelated files.

---

## Stage Map

Each stage ends at a review gate. A stage's detailed task plan is written at its boundary, when its inputs exist — writing Stage 1's exact tasks today would mean writing code blocks against `drizzle-kit pull` output that does not yet exist.

| Stage                    | Scope                                                                                                                                                                                                                                  | Gate                                                                                                                                                                                                                              | Detailed plan            |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| **0 · Ground**           | ESLint + Prettier + CI · `generated_by` mislabel · `operator_notes` rendering · doc corrections · VM provisioning · schema consolidation                                                                                               | CI green on a clean clone · one authoritative migration corpus · a build gate that **fails loudly** · a verified inventory of what blocks a full build (see the correction under Stage 0 exit criteria)                           | **In this document**     |
| **1 · Platform**         | Drizzle baseline (non-owner role, FORCE RLS, rewritten helpers) · Better Auth · SSE spike · tRPC vertical slice · fan out 244 call sites · realtime · storage · permission middleware · auth-by-default routes · decommission Supabase | **A test proves cross-tenant reads return zero rows while connected as the application role.** `./scripts/build-db-from-repo.sh` exits 0 (moved here from Stage 0 — it cannot pass until `auth.*` is gone). Feature parity on CI. | Written at Stage 1 start |
| **2 · Repair**           | Portal switch-on · notification recipients · backups incl. PDFs + tested restore + PITR · observability · route tests                                                                                                                  | Portal renders a real town end to end · a restore is demonstrated · an induced failure produces an alert                                                                                                                          | Written at Stage 2 start |
| **3 · Record integrity** | DB-level minutes immutability + addendum-only path · FOAA publish loop · notice PDF completion                                                                                                                                         | An adopted minutes record cannot be altered by any application path, proven by test                                                                                                                                               | Written at Stage 3 start |
| **4 · Vision**           | AI minutes · audio + transcription · warrant articles · SMS · residents + straw polls · mobile                                                                                                                                         | All six blocks shipped on the new stack                                                                                                                                                                                           | One plan per block       |
| **5 · Scale**            | Parcels · proximity · postal mail · consortiums · zoning                                                                                                                                                                               | —                                                                                                                                                                                                                                 | One plan per block       |

### Stage 1 parallelization

Stage 1's vertical slice (authentication + login + boards, end to end) is deliberately serial — it establishes the template. Everything after it fans out. The remaining 13 browser-queried tables are independent of one another once the slice exists, which is where autonomous parallel execution pays off. The fan-out is gated on the slice passing review, never started before it.

### The 21-rule permission checklist

`has_permission()` is called 21 times inside RLS policies. Under the split authorization model these are **removed** from RLS, not rewritten — so each must reappear as a tRPC procedure guard, or the rule is silently lost. Stage 1 carries this as an explicit checklist:

| Migration file                              | Codes enforced |
| ------------------------------------------- | -------------- |
| `20260308000033_rls_agenda_motion_vote.sql` | A2, M2, M3     |
| `20260308000034_rls_minutes_exhibit.sql`    | R1, R4, A3     |
| `20260308000035_rls_notification.sql`       | C2             |

Every one of the 21 gets a named replacement guard and a test. Note the live defect this replaces: RLS looks permissions up by action **code** (`R1`), while the application writes them by action **name** (`edit_agenda`). `supabase/seed.sql:92` seeds by code — standardize there.

---

# Stage 0 — Ground

Tasks 1–5 need no server and can run immediately. Task 6 requires VM access. Task 7 depends on Task 6.

---

### Task 1: ESLint and Prettier

The repository has `prettier@^3.8.1` installed with `format`/`format:check` scripts but **no configuration file**, and all three packages have `"lint": "echo 'No linter configured yet'"`. The audit's governing finding is that a green build proves nothing; this is the first half of fixing that.

Expect a large initial error count on ~68,800 LOC. The approach is deliberate: a conservative rule set, auto-fix what is mechanical, then let CI enforce errors while warnings are tolerated. Tightening happens later, on a green baseline.

**Files:**

- Create: `eslint.config.js`
- Create: `.prettierrc.json`
- Create: `.prettierignore`
- Modify: `package.json` (root `devDependencies`, `lint` script)
- Modify: `packages/api/package.json`, `packages/shared/package.json`, `packages/web/package.json` (replace the `lint` echo stubs)

**Interfaces:**

- Consumes: nothing.
- Produces: `pnpm lint` exits non-zero on an ESLint **error** and zero otherwise. `pnpm format:check` exits non-zero on unformatted files. Task 2 (CI) invokes both by exactly these names.

- [ ] **Step 1: Install the toolchain**

```bash
pnpm add -Dw eslint typescript-eslint eslint-plugin-react-hooks globals @eslint/js
```

- [ ] **Step 2: Write the Prettier configuration**

Create `.prettierrc.json` — these values match the formatting already dominant in the codebase, so the initial diff stays small:

```json
{
  "semi": true,
  "singleQuote": false,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2
}
```

Create `.prettierignore`:

```
node_modules
dist
build
coverage
.turbo
.react-router
pnpm-lock.yaml
docker/volumes
playwright-report
supabase/migrations
docker/migrations
```

SQL migrations are excluded deliberately: they are an append-only historical record and reformatting them would create noise while changing nothing.

- [ ] **Step 3: Write the ESLint flat configuration**

Create `eslint.config.js`. Note this is ESLint 9 flat config — not `.eslintrc`:

```js
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/build/**",
      "**/coverage/**",
      "**/.turbo/**",
      "**/.react-router/**",
      "docker/volumes/**",
      "playwright-report/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      // Errors: these indicate real defects.
      "no-console": ["error", { allow: ["warn", "error"] }],
      "@typescript-eslint/no-floating-promises": "off",

      // Warnings: real signal, but too numerous to gate CI on today.
      // Stage 2's test-floor task ratchets these to error.
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: ["packages/web/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
  {
    files: ["**/*.test.ts", "**/*.test.tsx", "**/__tests__/**"],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
);
```

`react-hooks/rules-of-hooks` is an **error** on purpose. It catches conditional hook calls, which produce real runtime bugs in the live-meeting screens and are never intentional.

- [ ] **Step 4: Replace the lint script stubs**

In each of `packages/api/package.json`, `packages/shared/package.json`, `packages/web/package.json`, replace:

```json
"lint": "echo 'No linter configured yet'",
```

with:

```json
"lint": "eslint src --config ../../eslint.config.js",
```

Two deliberate details. `--config` is named explicitly rather than relying on discovery: flat-config resolution from a subdirectory has varied across ESLint 9 minors, and turbo runs these scripts with the package as cwd. Naming the file removes the ambiguity entirely.

And `--max-warnings` is deliberately **not** passed — its default is unlimited, so ESLint exits non-zero on errors while tolerating warnings, which is exactly the gate wanted here.

- [ ] **Step 5: Run the linter and record the real baseline**

Run: `pnpm lint 2>&1 | tail -30`

Expected: a summary line reporting N errors and M warnings. **Record both numbers in the commit message** — they are the baseline the ratchet works against.

- [ ] **Step 6: Auto-fix what is mechanical, then re-run**

```bash
pnpm exec eslint . --fix
pnpm format
pnpm lint 2>&1 | tail -5
```

Expected: error count reduced, ideally to 0. If errors remain, read each one. Do **not** silence a rule to reach zero — if a rule is genuinely wrong for this codebase, downgrade it to `warn` in `eslint.config.js` with a comment explaining why. A rule disabled without a reason is how the current situation happened.

- [ ] **Step 7: Verify nothing broke**

Run: `pnpm typecheck && pnpm test`

Expected: typecheck clean; test count matches the pre-change count. Auto-fix touched formatting and unused imports — if a test now fails, `--fix` removed something load-bearing. Investigate rather than reverting wholesale.

- [ ] **Step 8: Commit**

```bash
git add eslint.config.js .prettierrc.json .prettierignore package.json packages/*/package.json pnpm-lock.yaml
git add -u
git commit -m "Add ESLint and Prettier configuration

Replaces three 'echo No linter configured yet' stubs with a real flat
config. Conservative rule set: errors for genuine defects (rules-of-hooks,
stray console), warnings for the large-but-real categories (explicit any,
unused vars) so CI can gate on errors today and ratchet later.

Baseline after auto-fix: <N> errors, <M> warnings."
```

---

### Task 2: Continuous integration

There is no `.github/workflows` directory. This is why 415 passing tests coexisted with broken authorization, a portal that cannot be switched on, and a notification service querying a nonexistent column.

**Files:**

- Create: `.github/workflows/ci.yml`

**Interfaces:**

- Consumes: `pnpm lint` and `pnpm format:check` from Task 1.
- Produces: a required status check on every push and pull request. All later stages depend on this being green before merge.

- [ ] **Step 1: Write the workflow**

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [main, "revival-*", "stage-*"]
  pull_request:
    branches: [main]

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  verify:
    runs-on: ubuntu-latest
    timeout-minutes: 20

    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 9.15.4

      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      # packages/web/src/lib/supabase.ts throws at import time when
      # VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are unset, and React Router's
      # SPA-mode build prerenders a shell that pulls that module in. The local
      # packages/web/.env is git-ignored by design, so a clean CI checkout has no
      # values. The checked-in .env.example holds public placeholders
      # (http://localhost:54321, your-anon-key) — no secrets. Every web test that
      # imports the client also vi.mock()s it, so these values only satisfy the
      # non-empty guard; they never reach a real Supabase client.
      # Stage 1 deletes supabase.ts entirely, at which point this step goes too.
      - name: Configure web environment
        run: cp packages/web/.env.example packages/web/.env

      - name: Typecheck
        run: pnpm typecheck

      - name: Lint
        run: pnpm lint

      - name: Format check
        run: pnpm format:check

      - name: Build
        run: pnpm build

      # Run tests alone. Concurrent execution with other turbo tasks
      # overloads the runner and produces spurious timeouts in
      # unrelated test files.
      - name: Test
        run: pnpm test
```

Ordering is deliberate: typecheck first because it is fastest and catches the most, build before test because `packages/shared` must compile before `packages/web` can see its exports.

- [ ] **Step 2: Verify the same sequence passes locally**

```bash
pnpm install --frozen-lockfile
pnpm typecheck && pnpm lint && pnpm format:check && pnpm build
pnpm test
```

Expected: every command exits zero. If `format:check` fails, run `pnpm format` and commit the result — do not weaken the check.

- [ ] **Step 3: Commit and push, then confirm the run**

```bash
git add .github/workflows/ci.yml
git commit -m "Add CI pipeline

Typecheck, lint, format, build, test on every push and PR. The repository
had no CI, which is the mechanism behind most of the revival audit's
findings: 415 tests passed while authorization was inert and the portal
could not be switched on."
git push
```

Then confirm the run succeeded:

```bash
gh run list --limit 1
gh run watch
```

Expected: conclusion `success`. If it fails on the runner but passed locally, the usual cause is a case-sensitive import path — macOS is case-insensitive, Ubuntu is not.

---

### Task 3: Fix the `generated_by: "ai"` mislabel

Minutes are assembled deterministically from database rows through Handlebars. Nothing about them is AI. Two call sites write `generated_by: "ai"` into `minutes_document`, mislabeling every generated record. The enum is `('manual', 'ai', 'hybrid')`; `'manual'` is the honest value until Stage 4 introduces a real Claude stage, at which point `'ai'` or `'hybrid'` becomes accurate.

No data backfill is required — nothing is deployed, and the development database no longer exists.

**Files:**

- Modify: `packages/api/src/routes/minutes.ts:221` (insert) and `:394` (update)
- Test: `packages/api/src/services/__tests__/minutes-generation.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `minutes_document.generated_by === "manual"` for all deterministically assembled documents. Stage 4's AI-minutes work changes this to `"hybrid"` when a Claude stage actually runs.

- [ ] **Step 1: Write the failing test**

Add to `packages/api/src/services/__tests__/minutes-generation.test.ts`:

```ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// packages/api is ESM ("type": "module"), so bare __dirname does not exist.
// This is the idiom already used in services/templates.ts:13 and
// services/email-sender.ts:17.
const testDir = path.dirname(fileURLToPath(import.meta.url));
const MINUTES_ROUTE = path.join(testDir, "..", "..", "routes", "minutes.ts");

describe("generated_by labelling", () => {
  it("never labels deterministically assembled minutes as ai-generated", () => {
    const source = readFileSync(MINUTES_ROUTE, "utf8");
    expect(source).not.toContain('generated_by: "ai"');
  });

  it("labels assembled minutes as manual at both write sites", () => {
    const source = readFileSync(MINUTES_ROUTE, "utf8");
    const matches = source.match(/generated_by: "manual"/g) ?? [];
    expect(matches).toHaveLength(2);
  });
});
```

This asserts against source text rather than behavior because both call sites sit inside Fastify route handlers that need a live Supabase client — which Stage 1 removes entirely. A source assertion is honest about what it checks, costs nothing, and gets replaced by a real route test in Stage 1 once tRPC procedures are directly callable. The count assertion is the load-bearing half: it fails if someone later adds a third write site and forgets the label.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @town-meeting/api test -- minutes-generation`

Expected: FAIL — first assertion finds `generated_by: "ai"`, second finds 0 matches instead of 2.

- [ ] **Step 3: Make the change**

In `packages/api/src/routes/minutes.ts`, at both line 221 and line 394, replace:

```ts
generated_by: "ai",
```

with:

```ts
generated_by: "manual",
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @town-meeting/api test -- minutes-generation`

Expected: PASS, both assertions.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/routes/minutes.ts packages/api/src/services/__tests__/minutes-generation.test.ts
git commit -m "Stop labelling assembled minutes as AI-generated

minutes-assembler.ts builds documents deterministically from database rows
through Handlebars. There is no AI involved and no Anthropic SDK in the
repository, yet routes/minutes.ts:221 and :394 wrote generated_by: 'ai' on
every insert and update, mislabelling public records.

Corrected to 'manual'. Stage 4 changes this to 'hybrid' when a real Claude
enrichment stage exists. No backfill needed — nothing is deployed."
```

---

### Task 4: Render `operator_notes` in generated minutes

The clerk's contemporaneous notes are captured during a live meeting and reach the document pipeline — `minutes-assembler.ts:565` passes `operator_notes: item.operator_notes` into the item structure — but none of the three formatters in `minutes-formatters.ts` emit it, so it is silently dropped at the last step. A clerk types notes during a meeting and they vanish.

Render in all three styles. A clerk who typed notes expects to see them; silently discarding typed content is the defect being fixed.

**Files:**

- Modify: `packages/api/src/services/minutes-formatters.ts` — `formatActionMinutes` (line 305), `formatSummaryMinutes` (line 398), `formatNarrativeMinutes` (line 512)
- Test: `packages/api/src/services/__tests__/minutes-generation.test.ts`

**Interfaces:**

- Consumes: `MinutesContentItem.operator_notes: string | null`, already populated by `minutes-assembler.ts:565`.
- Produces: `formatted_text` containing `<p class="operator-notes">…</p>` when notes exist. Stage 4's AI-minutes work reads `operator_notes` as its narrative input.

- [ ] **Step 1: Write the failing test**

Add to `packages/api/src/services/__tests__/minutes-generation.test.ts`, inside the existing `describe("formatMinutes", …)` block at line 592.

Use the helpers already in that file — `makeContent()` (line 500) and `BASE_OPTIONS` (line 490) — and follow its established idiom of mutating `content.sections[0]!.items[0]!` before formatting. Do not add new fixtures. Both are already imported and in scope; the file carries `// @ts-nocheck`, so the non-null assertions match surrounding style:

```ts
describe("operator notes", () => {
  it.each(["action", "summary", "narrative"] as const)(
    "renders operator notes in %s style",
    (style) => {
      const content = makeContent();
      content.sections[0]!.items[0]!.operator_notes =
        "Chair noted the shortfall stems from the culvert repair.";

      const formatted = formatMinutes(content, {
        ...BASE_OPTIONS,
        minutes_style: style,
      });

      const allText = formatted.sections.map((s) => s.formatted_text).join("\n");
      expect(allText).toContain("culvert repair");
      expect(allText).toContain('class="operator-notes"');
    },
  );

  it("escapes HTML in operator notes", () => {
    const content = makeContent();
    content.sections[0]!.items[0]!.operator_notes = "<script>alert(1)</script>";

    const formatted = formatMinutes(content, BASE_OPTIONS);
    const allText = formatted.sections.map((s) => s.formatted_text).join("\n");

    expect(allText).not.toContain("<script>");
    expect(allText).toContain("&lt;script&gt;");
  });

  it("emits nothing when notes are absent", () => {
    const content = makeContent();
    content.sections[0]!.items[0]!.operator_notes = null;

    const formatted = formatMinutes(content, BASE_OPTIONS);
    const allText = formatted.sections.map((s) => s.formatted_text).join("\n");

    expect(allText).not.toContain("operator-notes");
  });
});
```

Two things to note. `formatMinutes(contentJson, options)` selects the formatter from `options.minutes_style` — there is no bare `style` property, and `MinutesRenderOptions` requires all six fields, which is why the style cases spread `BASE_OPTIONS` rather than constructing an options object.

The escaping test is the one that matters most: `formatted_text` is injected into `minutes.hbs` with a triple-stash (`{{{this.formatted_text}}}`), so an unescaped note is an HTML injection into a published public record.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @town-meeting/api test -- minutes-generation`

Expected: the three style cases and the escaping case FAIL (no `operator-notes` in output); the absent-notes case passes vacuously.

- [ ] **Step 3: Implement the shared helper**

In `packages/api/src/services/minutes-formatters.ts`, next to the existing `formatRecusals` (line 220) and `formatSpeakers` (line 237) helpers, add:

```ts
function formatOperatorNotes(notes: string | null): string {
  if (!notes || notes.trim() === "") return "";
  return `<p class="operator-notes">${escapeHtml(notes.trim())}</p>`;
}
```

It uses the existing `escapeHtml` (line 210) — the same helper the other formatters use.

- [ ] **Step 4: Call it from all three formatters**

In each of `formatActionMinutes`, `formatSummaryMinutes` and `formatNarrativeMinutes`, locate the `itemParts` construction and append the notes after the motions block, immediately before the `if (itemParts.length > 0)` check:

```ts
const notesText = formatOperatorNotes(item.operator_notes);
if (notesText) itemParts.push(notesText);
```

Placing it after motions is deliberate: the notes are context on what was decided, so they read better following the action than preceding it.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @town-meeting/api test -- minutes-generation`

Expected: PASS, all four cases.

- [ ] **Step 6: Add the stylesheet rule**

In `packages/api/src/templates/minutes.css`, add:

```css
.operator-notes {
  margin: 0.5em 0 0.5em 1.5em;
  font-style: italic;
  color: #333;
}
```

Indented and italic so the clerk's notes are visually distinguishable from the formal record in the rendered PDF, while remaining legible in print.

- [ ] **Step 7: Run the full API suite**

Run: `pnpm --filter @town-meeting/api test`

Expected: all tests pass. Existing minutes-generation snapshots may need updating — if a snapshot fails, confirm the only difference is the added notes block before accepting it.

- [ ] **Step 8: Commit**

```bash
git add packages/api/src/services/minutes-formatters.ts packages/api/src/templates/minutes.css packages/api/src/services/__tests__/minutes-generation.test.ts
git commit -m "Render operator notes in generated minutes

A clerk's contemporaneous notes were captured during live meetings and
reached the document pipeline — minutes-assembler.ts:565 passes them into
the item structure — but none of the three formatters emitted them, so they
were silently dropped at the last step.

Rendered in all three styles, HTML-escaped (formatted_text is injected with
a triple-stash, so an unescaped note would be an injection into a public
record). Also supplies the narrative input Stage 4's Claude enrichment
otherwise lacks: there is no transcript and no audio today."
```

---

### Task 5: Correct stale documentation and ignore rules

`README.md` and the spec still describe the application as offline-first, which stopped being true when PowerSync was removed and the app moved to TanStack Query plus Supabase Realtime. A `playwright-report/` directory appeared untracked during the audit, and `.DS_Store` is tracked and perpetually dirty.

**Files:**

- Modify: `README.md`
- Modify: `.gitignore`
- Delete from index: `.DS_Store`

**Interfaces:**

- Consumes: nothing.
- Produces: a clean `git status` on a fresh clone, so later stages can trust it as a signal.

- [ ] **Step 1: Find every stale architecture claim**

```bash
grep -rn -i "offline.first\|powersync\|local.first\|sync rules" README.md docs/*.md
```

Record each hit. Some are historical records inside `docs/workflow/` — **leave those alone**, they are being archived in Stage 1 and rewriting history there is wrong. Correct only `README.md` and any document that presents itself as describing the current architecture.

- [ ] **Step 2: Correct the README**

Replace offline-first claims with an accurate description. The application is online-first: TanStack Query v5 for data fetching with Supabase Realtime for live-meeting sync today, moving to tRPC plus SSE in Stage 1. Do not describe the Stage 1 target as though it already exists.

- [ ] **Step 3: Update `.gitignore`**

Append:

```
playwright-report/
test-results/
.DS_Store
```

- [ ] **Step 4: Untrack `.DS_Store`**

```bash
git rm --cached .DS_Store
git rm --cached docs/.DS_Store docker/.DS_Store docs/workflow/.DS_Store 2>/dev/null || true
```

- [ ] **Step 5: Verify a clean tree**

Run: `git status --short`

Expected: only the intended modifications. No `.DS_Store`, no `playwright-report/`.

- [ ] **Step 6: Commit**

```bash
git add README.md .gitignore
git add -u
git commit -m "Correct stale architecture docs and ignore rules

README described the app as offline-first, which stopped being true when
PowerSync was removed (sessions M.01-M.11). Corrected to online-first.
Historical session files under docs/workflow/ deliberately untouched.

Also ignores playwright-report/ and test-results/, and untracks .DS_Store."
```

---

### Task 6: Provision the VM

**Target, surveyed 2026-08-26 — this supersedes the plan's earlier assumptions.**

|                   |                                                                                          |
| ----------------- | ---------------------------------------------------------------------------------------- |
| Host              | `192.168.1.162`, hostname `tmm`, user `ben`, SSH key auth working, **passwordless sudo** |
| OS                | **Debian 13 (trixie)**, kernel 6.12.95-cloud-amd64 — _not_ Ubuntu 24.04 as first assumed |
| Resources         | 2 vCPU · 3.8 GB RAM · 32 GB disk (29 GB free)                                            |
| Already installed | Docker 29.6.2, running but **completely empty** — zero containers, volumes, images       |
| Not installed     | Postgres, Node, nginx, Supabase (nothing to remove)                                      |

The 4 GB budget is the binding constraint: Postgres wants roughly 1 GB, Node 200–500 MB, and
Puppeteer 300–500 MB per Chromium instance. Dropping the eight Supabase containers is what makes
that budget work. Note the disk is 32 GB, not the "plenty" first assumed — adequate now, but
backups and generated PDFs accumulate, so Stage 2's backup work must not assume unlimited space.

Debian 13 ships everything needed natively, so **no third-party APT repositories are required** —
no PGDG, no NodeSource:

| Package                   | Debian 13 candidate                               |
| ------------------------- | ------------------------------------------------- |
| `postgresql-17`           | 17.11-0+deb13u1                                   |
| `postgresql-17-postgis-3` | 3.5.2 (Stage 5 parcels)                           |
| `nodejs`                  | 20.19.2 — satisfies the `>=20.19.0` floor exactly |
| `nginx`                   | 1.26.3                                            |

**Files:**

- Create: `infrastructure/provision/README.md`
- Create: `infrastructure/provision/postgresql.conf.tuned`
- Create: `infrastructure/provision/nginx-dev.conf`

**Interfaces:**

- Consumes: nothing in the repository.
- Produces: a reachable Postgres instance and a documented connection string. Task 7 and all of Stage 1 depend on it.

- [ ] **Step 1: Record the target**

Write `infrastructure/provision/README.md` capturing hostname, OS and version, vCPU, RAM, disk, what else runs on the box, and how the development machine reaches Postgres (direct exposure on a firewalled port, or an SSH tunnel — prefer the tunnel; never expose Postgres to the open internet).

- [ ] **Step 2: Install Postgres, Node and nginx**

Install **PostgreSQL 17** (Debian 13's native version — the abandoned dev volume was PG 15, but nothing is being restored from it, so there is no compatibility reason to hold back, and using the distro's own package avoids adding the PGDG repository), plus `postgresql-17-postgis-3` so Stage 5 does not require a later reinstall, `nodejs` (20.19.2, satisfying the `>=20.19.0` floor), and `nginx`.

Record the exact commands used in the README **as they are run** — this file is the reproduction recipe, and a command that was run but not recorded is a step that will be forgotten. Do not paraphrase them afterwards from memory.

- [ ] **Step 3: Tune Postgres for 4 GB**

Write `infrastructure/provision/postgresql.conf.tuned` with settings appropriate to the box, and apply it:

```
shared_buffers = 1GB
effective_cache_size = 2GB
work_mem = 16MB
maintenance_work_mem = 256MB
max_connections = 50
```

`max_connections = 50` is deliberate: a single Fastify process with a modest `pg.Pool` plus one dedicated `postgres.js` listener needs nowhere near the default 100, and each connection costs memory that Puppeteer needs.

- [ ] **Step 4: Create the roles**

Two roles, and the distinction is load-bearing for the entire authorization model:

```sql
-- Owns the schema. Runs migrations. Never used by the application.
CREATE ROLE tmm_owner LOGIN PASSWORD '<generated>';

-- The application connects as this. NOT the table owner, so RLS applies.
CREATE ROLE tmm_app LOGIN PASSWORD '<generated>';

CREATE DATABASE town_meeting_manager OWNER tmm_owner;
```

`tmm_app` must never own tables and must never be superuser. Table owners bypass RLS, so an application connecting as the owner turns every policy into a no-op silently. Grants for `tmm_app` are issued in the Stage 1 baseline, once tables exist.

- [ ] **Step 5: Verify connectivity from the development machine**

```bash
psql "postgresql://tmm_owner@<host>/town_meeting_manager" -c "SELECT version();"
psql "postgresql://tmm_app@<host>/town_meeting_manager" -c "SELECT current_user, rolsuper FROM pg_roles WHERE rolname = current_user;"
```

Expected: the version string, and `tmm_app` with `rolsuper = f`. If `rolsuper` is `t`, stop — RLS will not work and Stage 1's gate cannot be met.

- [ ] **Step 6: Commit the provisioning record**

```bash
git add infrastructure/provision/
git commit -m "Add VM provisioning record

PostgreSQL 17.11, PostGIS 3.5.2, Node 20.19.2 and nginx 1.26.3 — all Debian 13
native packages, no third-party repositories — on the 2 vCPU / 3.8 GB dev-staging
VM. Postgres tuned for the memory budget; max_connections lowered to 50 because
Puppeteer needs the headroom more than the connection slots.

Two roles: tmm_owner owns the schema and runs migrations, tmm_app is the
application's non-owner login. That separation is what makes RLS function —
table owners bypass row security, so an app connecting as owner would turn
every policy into a silent no-op."
```

---

### Task 7: Consolidate the schema and prove it builds — Stage 0 gate

Two migration corpora exist. `supabase/migrations/` holds 56 files and `docker/migrations/` holds two (`011_notification_system.sql`, `012_invitation_email.sql`), and [`infrastructure/scripts/migrate.sh:23`](../../../infrastructure/scripts/migrate.sh) iterates `supabase/migrations/*.sql` **only** — so those two have never been applied by any deploy script. This is why the audit concluded the `invitation` table and the notification retry columns had no SQL source. They do. The schema is not lost; half of it is unreachable by tooling.

**Files:**

- Create: `supabase/migrations/20260826000001_merge_notification_system.sql`
- Create: `supabase/migrations/20260826000002_merge_invitation_email.sql`
- Create: `scripts/build-db-from-repo.sh`
- Modify: `infrastructure/scripts/migrate.sh`
- Delete: `docker/migrations/011_notification_system.sql`, `docker/migrations/012_invitation_email.sql`

**Interfaces:**

- Consumes: the Postgres instance from Task 6.
- Produces: `scripts/build-db-from-repo.sh` builds a complete database from a clean clone. Stage 1's `drizzle-kit pull` runs against exactly this database.

- [ ] **Step 1: Establish the true starting state**

```bash
psql "postgresql://tmm_owner@<host>/town_meeting_manager" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
for f in supabase/migrations/*.sql; do
  echo "=== $f"
  psql "postgresql://tmm_owner@<host>/town_meeting_manager" -v ON_ERROR_STOP=1 -f "$f" || echo ">>> FAILED: $f"
done
```

Record every failure. Expect failures referencing `auth.*` schemas and roles that GoTrue would have created — those are precisely what Stage 1's baseline replaces. **Do not fix them here.** The goal of this task is a complete and accurate inventory, not a working GoTrue-compatible database.

- [ ] **Step 2: Port the two orphaned migrations**

Copy `docker/migrations/011_notification_system.sql` to `supabase/migrations/20260826000001_merge_notification_system.sql` and `012_invitation_email.sql` to `20260826000002_merge_invitation_email.sql`, preserving content. Add a header comment to each recording where it came from and why it moved:

```sql
-- Ported from docker/migrations/011_notification_system.sql on 2026-08-26.
-- That directory was never read by infrastructure/scripts/migrate.sh, which
-- iterates supabase/migrations/*.sql only, so this migration had never been
-- applied by any deploy script.
```

Verify they are additive and idempotent — they already use `ADD COLUMN IF NOT EXISTS`, so re-running against a database that had them hand-applied is safe.

- [ ] **Step 3: Delete the orphaned directory**

```bash
git rm docker/migrations/011_notification_system.sql docker/migrations/012_invitation_email.sql
```

A second corpus that tooling ignores is worse than no corpus, because it looks like coverage.

- [ ] **Step 4: Inventory the remaining drift**

The audit reported columns queried by application code that no migration defines. Verify each against the consolidated corpus and record findings in the commit message:

```bash
grep -rn "user_account_id" supabase/migrations/*.sql | grep -i "board_member" || echo "board_member.user_account_id: CONFIRMED MISSING"
grep -rn "item_type\|duration_minutes\|meeting_schedule\|quorum_custom_value" supabase/migrations/*.sql | head
```

`board_member.user_account_id` is confirmed absent — `board_member` is `id, person_id, board_id, town_id, seat_title, term_start, term_end, status, is_default_rec_sec, created_at`, and `packages/api/src/services/notification-service.ts:48` selects a column that does not exist and discards the error. **Do not fix that here** — it is Stage 2's notification-recipients task, and fixing it needs a decision about how a board member resolves to a user account. Record it.

- [ ] **Step 5: Write the build script**

Create `scripts/build-db-from-repo.sh`:

```bash
#!/usr/bin/env bash
# Build a complete database from the repository alone.
# This is the Stage 0 gate: if this fails, the repo is not the source of truth.
set -euo pipefail

DB_URL="${1:?usage: build-db-from-repo.sh <postgres-url>}"

echo "==> Resetting public schema"
psql "$DB_URL" -v ON_ERROR_STOP=1 -c "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;"

echo "==> Applying migrations in order"
for file in supabase/migrations/*.sql; do
  echo "    $(basename "$file")"
  psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f "$file"
done

echo "==> Applying seed"
psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f supabase/seed.sql

echo "==> Table count"
psql "$DB_URL" -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public';"
```

Make it executable: `chmod +x scripts/build-db-from-repo.sh`

- [ ] **Step 6: Point `migrate.sh` at the single corpus**

`infrastructure/scripts/migrate.sh:23` already iterates `supabase/migrations/*.sql`, which is now correct because the orphans were merged in. Add a comment above that loop recording the consolidation so a future reader does not recreate a second directory:

```bash
# Single source of truth. docker/migrations/ was merged into this directory
# on 2026-08-26 — it had never been read by this script. Do not add a second
# migration directory; tooling reads only this one.
```

Note for Stage 1: this script's `schema_migrations` table is superseded by Drizzle's `drizzle.__drizzle_migrations` and gets retired then, or there will be two sources of truth.

- [ ] **Step 7: Run the gate**

```bash
./scripts/build-db-from-repo.sh "postgresql://tmm_owner@<host>/town_meeting_manager"
```

Expected: every migration applies, the seed applies, and the table count is at least 26. Any failure not attributable to a missing `auth.*` schema is a genuine gap that must be closed before Stage 1 — `drizzle-kit pull` can only introspect what actually exists.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/20260826000001_merge_notification_system.sql \
        supabase/migrations/20260826000002_merge_invitation_email.sql \
        scripts/build-db-from-repo.sh infrastructure/scripts/migrate.sh
git add -u
git commit -m "Consolidate the two migration corpora into one

docker/migrations/ held 011_notification_system.sql and
012_invitation_email.sql, but infrastructure/scripts/migrate.sh iterates
supabase/migrations/*.sql only — so neither had ever been applied by any
deploy script. That is why the revival audit concluded the invitation table
and notification retry columns had no SQL source in the repo. They did; the
corpus was split and half of it was unreachable by tooling.

Merged into supabase/migrations/, deleted the orphaned directory, and added
scripts/build-db-from-repo.sh as the Stage 0 gate.

Known drift recorded, not fixed here: board_member has no user_account_id
column, yet notification-service.ts:48 selects it and discards the error, so
board-scoped notifications resolve to zero recipients. Deferred to Stage 2,
where it needs a decision on how a board member resolves to a user account."
```

---

## Stage 0 exit criteria

- [ ] `pnpm typecheck && pnpm lint && pnpm format:check && pnpm build && pnpm test` passes locally
- [ ] CI is green on the branch
- [ ] No `generated_by: "ai"` remains in the codebase
- [ ] Operator notes render in all three minutes styles, HTML-escaped
- [ ] One migration corpus; `docker/migrations/` is gone
- [ ] `./scripts/build-db-from-repo.sh` exists and **fails loudly** rather than exiting 0 on a partial build
- [ ] A complete, verified inventory of what blocks a full build, and of schema-vs-code drift
- [ ] `tmm_app` exists, is not superuser, and does not own tables

### Correction — the original criterion was unachievable

This section first read _"`./scripts/build-db-from-repo.sh` builds a complete database from a clean
clone."_ That was **impossible for Stage 0 to satisfy, and I should have seen it when writing the
plan.** `supabase/migrations/20260308000004_create_user_account.sql:26` declares
`auth_user_id REFERENCES auth.users(id)`. The `auth` schema belongs to Supabase's GoTrue and does
not exist on plain PostgreSQL. That FK sits at file 4 of 58, so it blocks the corpus almost
immediately — and removing the `auth.*` dependency is **Stage 1's** job, by design.

Stage 0's honest deliverable is therefore a single authoritative corpus, a gate that refuses to lie,
and an accurate inventory. Task 7 confirmed the corpus is **structurally sound**: with a throwaway
`auth`/`storage` shim, **56 of 58 migrations apply and produce 27 tables**. Exactly two things
remain behind that wall — the notification-table collision (below) and one `storage.foldername`
dependency.

**Moved to Stage 1's gate:** `./scripts/build-db-from-repo.sh` exits 0 and builds a complete
database from a clean clone.

### Carried into Stage 1 from Task 7

The notification tables are defined **three** incompatible ways: the "official" corpus
(`20260308000018`–`000021`), the ported docker corpus, and a **hybrid that is what actually exists
in the dev database**. The ported file uses `CREATE TABLE IF NOT EXISTS`, so on a fresh build the
official definition wins and the ported one silently no-ops — yielding a schema the application
cannot use. Parts of the feature are already broken in dev, not merely on a fresh build.

Stage 1 must decide, before `drizzle-kit pull` runs:

1. Which of the three shapes is canonical.
2. Whether `town_id` stays on `notification_delivery` as a denormalized tenant key for RLS, or is dropped in favour of joining through `notification_event`.
3. **Whether subscribers are `person` or `user_account`.** This is the same open question as `board_member.user_account_id` — answering it once resolves both.
4. Whether the TCPA `consent_*` columns survive; only the official shape carries them.
5. Whether `external_id` and `postmark_message_id` merge into one column.
6. Whether any dev data must migrate.

Also carried: the two ported migrations contain 8 bare `CREATE POLICY` statements and PostgreSQL has
no `CREATE POLICY IF NOT EXISTS`, so their first application against a database that already has
those policies will abort `migrate.sh`. Stage 1 needs `DROP POLICY IF EXISTS` guards or a
`schema_migrations` backfill.

When these hold, write the Stage 1 detailed plan. Its first task is the SSE spike, because tRPC SSE on the Fastify adapter is unproven in public and the fallback decision must be made before anything depends on the transport.

---

## Self-review notes

**Spec coverage.** Stage 0 implements spec §5 Stage 0 in full: tooling floor (Tasks 1–2), the `generated_by` fix (Task 3), VM provisioning (Task 6), and schema consolidation (Task 7). Task 4 (`operator_notes`) is pulled forward from spec §5 Stage 4 deliberately — it is small, it stops ongoing data loss, and it supplies Stage 4's narrative input. Task 5 covers the §8 documentation correction. Spec §4.1–§4.11 decisions are carried into Global Constraints and the Stage Map; their detailed implementation belongs to Stages 1–3, whose plans are written at their boundaries.

**Deliberate deferrals, each with a named owner stage.** `board_member.user_account_id` → Stage 2. Retiring `migrate.sh`'s `schema_migrations` table → Stage 1. Ratcheting ESLint warnings to errors → Stage 2. The six unauthenticated endpoints and the `admin-alert.hbs:14` triple-stash → Stage 1, via the auth-by-default route policy, because a structural fix beats seven individual patches.

**Type consistency — four errors found and fixed during review.** Worth recording, because each would have cost an implementer real time:

1. Task 4's test called `formatMinutes(content, { style })`. The real signature selects on `options.minutes_style`, and `MinutesRenderOptions` requires all six of `minutes_style`, `motion_display_format`, `member_reference_style`, `certification_format`, `is_draft`, `town_seal_url`. Rewritten to spread the existing `BASE_OPTIONS`.
2. Task 4's test referenced `ITEM_BUDGET_CONTENT` and `buildContentWithItem`, which do not exist — invented names. Rewritten against the real helpers `makeContent()` (line 500) and `BASE_OPTIONS` (line 490), following the file's established idiom of mutating `content.sections[0]!.items[0]!` before formatting.
3. Task 3's test used bare `__dirname`. `packages/api` is ESM, so it is undefined. Rewritten to `path.dirname(fileURLToPath(import.meta.url))`, matching `services/templates.ts:13`.
4. Task 1's lint script relied on flat-config discovery from a package subdirectory, which has varied across ESLint 9 minors. Now names `--config ../../eslint.config.js` explicitly.

**Known blocker.** Task 6 cannot start without SSH access to the VM. Tasks 1–5 are independent of it and should proceed in parallel.
