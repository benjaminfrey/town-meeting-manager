/**
 * Stage 1, Task B3 — the lint rule that guards the SET LOCAL invariant.
 *
 * A lint rule nobody has watched fire is a comment with a config entry. These
 * cases are the ones that matter: the correct form must not be flagged (a rule
 * that cries wolf gets turned off), and every spelling of the leaking form
 * must be — including the exact one-character mutation of
 * `packages/api/src/db/with-tenant.ts` that the isolation gate's
 * transaction-leak assertion catches at runtime.
 *
 * The rule is loaded by URL rather than by a static import because it lives at
 * the repository root, outside this package's `rootDir`; a static import would
 * break `tsc -b`'s emit for the whole package.
 */

import { describe, it, beforeAll } from "vitest";
import { RuleTester } from "eslint";

const RULE_URL = new URL(
  "../../../../../eslint-rules/no-session-scoped-set-config.js",
  import.meta.url,
);

let rule: Parameters<RuleTester["run"]>[1];

beforeAll(async () => {
  rule = (await import(RULE_URL.href)).default;
});

describe("no-session-scoped-set-config", () => {
  it("accepts the transaction-scoped form and flags every session-scoped one", () => {
    // RuleTester throws on the first case that does not behave as declared, so
    // running it inside an `it` surfaces failures the same way any assertion
    // would. Constructed here rather than at module scope because `rule` is
    // only available after beforeAll.
    const ruleTester = new RuleTester();

    ruleTester.run("no-session-scoped-set-config", rule, {
      valid: [
        // The shipped form, verbatim from packages/api/src/db/with-tenant.ts.
        "const q = sql`select set_config('app.town_id', ${townId}, true)`;",
        // Whitespace and case are not what make it correct or incorrect.
        "const q = `SET_CONFIG( 'app.town_id' , $1 , TRUE )`;",
        // SET LOCAL is the raw-SQL equivalent and is fine.
        "const q = `SET LOCAL app.town_id = '...'`;",
        // A GUC outside the app namespace is none of this rule's business.
        "const q = `SET search_path = pg_catalog, public`;",
        // Ordinary SQL containing the word SET must not trip the bare-SET check.
        "const q = sql`UPDATE board SET name = ${name} WHERE id = ${id}`;",
        // Not a set_config call at all.
        "const q = 'insert into audit_log (action) values (\\'set_config\\')';",
        // Prose, not SQL. An earlier version of this rule fired on the error
        // message inside with-tenant.ts itself, which is exactly how a rule
        // earns a blanket disable comment.
        "throw new Error('A malformed value would set app.town_id to something get_current_town_id() resolves to NULL');",
        // Not this rule's business. A session-scoped statement_timeout is a
        // legitimate pattern, and flagging it is how a rule earns a blanket
        // disable comment that then hides the real thing.
        "const q = `select set_config('statement_timeout', '5s', false)`;",
        "const q = `SET statement_timeout = '5s'`;",
      ],
      invalid: [
        {
          // The mutation the whole gate exists to catch: with-tenant.ts's own
          // line with `true` changed to `false`.
          code: "await tx.execute(sql`select set_config('app.town_id', ${ctx.townId}, false)`);",
          errors: [{ messageId: "sessionScoped" }],
        },
        {
          // Postgres accepts these spellings of false too.
          code: "const q = `select set_config('app.town_id', $1, 'f')`;",
          errors: [{ messageId: "sessionScoped" }],
        },
        {
          code: "const q = \"select set_config('app.town_id', $1, FALSE)\";",
          errors: [{ messageId: "sessionScoped" }],
        },
        {
          // A computed third argument is rejected as well: the invariant is
          // that it is the literal `true`, not that it is probably true.
          code: "const q = sql`select set_config('app.town_id', ${townId}, ${isLocal})`;",
          errors: [{ messageId: "sessionScoped" }],
        },
        {
          code: "const q = `SET app.town_id = '00000000-0000-0000-0000-000000000000'`;",
          errors: [{ messageId: "bareSet" }],
        },
        {
          // An interpolated value is still a bare SET.
          code: "const q = sql`SET app.town_id = ${townId}`;",
          errors: [{ messageId: "bareSet" }],
        },
        {
          // Two calls in one literal are two findings, not one.
          code: "const q = `select set_config('app.town_id', $1, false), set_config('app.role', $2, false)`;",
          errors: [{ messageId: "sessionScoped" }, { messageId: "sessionScoped" }],
        },
        {
          // Nested parentheses in the third argument. The first version of the
          // rule used `\\(([^()]*)\\)` to grab the argument list and this went
          // straight past it.
          code: "const q = `select set_config('app.town_id', $1, (1=0))`;",
          errors: [{ messageId: "sessionScoped" }],
        },
        {
          // Split across a concatenation, so neither half matches on its own.
          // Checked once, at the outermost `+`, from the flattened text.
          code: 'const q = "select set_config(\'app.town_id\', $1, " + "false)";',
          errors: [{ messageId: "sessionScoped" }],
        },
        {
          code: "const q = 'SET app.town_id = ' + \"'x'\";",
          errors: [{ messageId: "bareSet" }],
        },
        {
          // A three-part concatenation is still one finding, not three: the
          // operands are skipped and only the root is checked.
          code: 'const q = "select set_config(\'app." + "town_id\', $1, " + "false)";',
          errors: [{ messageId: "sessionScoped" }],
        },
      ],
    });
  });
});
