/**
 * Stage 1, Task B3 — make the `SET LOCAL` invariant mechanical.
 *
 * Tenant context lives in the `app.town_id` session setting, and every RLS
 * policy in the database is keyed on it. The application connects through a
 * connection pool, so a connection that keeps a value after its transaction
 * ends hands that value to whichever request is served next.
 *
 *     set_config('app.town_id', $1, true)   -- transaction-scoped. Correct.
 *     set_config('app.town_id', $1, false)  -- session-scoped. Leaks.
 *     SET app.town_id = ...                 -- session-scoped. Leaks.
 *
 * The leak has no error, no log line and no failing test anywhere except the
 * one assertion written specifically to catch it — the second request simply
 * reads the first tenant's rows. That is a cross-tenant disclosure in a system
 * holding executive-session minutes and residents' personal data, so it is
 * worth spending a lint rule to make the wrong form unwritable rather than
 * merely discouraged.
 *
 * The rule reads SQL out of string and template literals, which is where all
 * of it lives in this repository. `packages/api/src/db/with-tenant.ts` is the
 * only place that should be setting this at all; the rule applies everywhere
 * so that a second such place cannot appear quietly.
 *
 * Known limit, stated rather than hidden: this is a text scan of literals. SQL
 * assembled at runtime from non-literal pieces, or loaded from a `.sql` file,
 * is invisible to it. `supabase/seed.sql` is the one deliberate session-scoped
 * use in the repository — it applies one file as one tenant, outside any
 * request — and it carries a comment saying so.
 */

/** Matches a whole `set_config(...)` call with no nested parentheses. */
const SET_CONFIG = /set_config\s*\(([^()]*)\)/gi;

/**
 * `SET app.<something> = <value>` that is not `SET LOCAL`. Restricted to the
 * `app.` namespace on purpose: that is the only GUC namespace this application
 * owns, so the rule cannot fire on unrelated SQL.
 *
 * The trailing `['$]` is not decoration. Without it this fired on the English
 * sentence "would set app.town_id to something ..." inside an error message in
 * with-tenant.ts — caught by running the rule over the repository rather than
 * only over fixtures. Requiring the value to start like SQL (a quote, or a
 * `$n` placeholder, which is also what PLACEHOLDER below is shaped as) keeps
 * prose out while still matching `= '...'`, `TO $1` and `= ${expr}`.
 */
const BARE_SET = /\bset\s+(?!local\b)app\.[a-z_]+\s*(?:=|\bto\b)\s*['$]/gi;

/** Text stand-in for a `${...}` placeholder. No commas or parens, so it does
 * not disturb the argument split below; never the literal `true`; and shaped
 * like a `$n` bind parameter so BARE_SET recognises it as a value. */
const PLACEHOLDER = "$__EXPRESSION__";

/** @type {import("eslint").Rule.RuleModule} */
const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "require SET LOCAL semantics when setting the app.town_id tenant GUC — " +
        "a session-scoped value leaks tenant context across pooled connections",
    },
    schema: [],
    messages: {
      sessionScoped:
        "set_config()'s third argument must be the literal `true` (SET LOCAL semantics); " +
        "found `{{ found }}`. A session-scoped setting survives the transaction and is " +
        "inherited by the next request handed this pooled connection, which reads the " +
        "previous tenant's rows. See packages/api/src/db/with-tenant.ts.",
      bareSet:
        "`{{ found }}` is session-scoped and leaks tenant context across pooled " +
        "connections. Use `set_config('app.town_id', <value>, true)` via withTenant(), " +
        "or `SET LOCAL` if this really is raw SQL.",
    },
  },

  create(context) {
    /**
     * @param {import("estree").Node} node
     * @param {string} text SQL text, with `${...}` placeholders substituted.
     */
    function check(node, text) {
      SET_CONFIG.lastIndex = 0;
      let match;
      while ((match = SET_CONFIG.exec(text)) !== null) {
        const args = match[1].split(",").map((a) => a.trim());
        // set_config is always 3-arity; anything else is not the call we mean.
        if (args.length !== 3) continue;
        if (args[2].toLowerCase() === "true") continue;
        context.report({ node, messageId: "sessionScoped", data: { found: args[2] } });
      }

      BARE_SET.lastIndex = 0;
      while ((match = BARE_SET.exec(text)) !== null) {
        context.report({ node, messageId: "bareSet", data: { found: match[0] } });
      }
    }

    return {
      Literal(node) {
        if (typeof node.value === "string") check(node, node.value);
      },
      TemplateLiteral(node) {
        // Interpolations are substituted rather than dropped, so
        // `set_config('app.town_id', ${id}, false)` still reads as a
        // three-argument call — and a `${isLocal}` in the third position is
        // reported too, because the invariant is that it is the literal
        // `true`, not that it is probably true.
        check(node, node.quasis.map((q) => q.value.raw).join(PLACEHOLDER));
      },
    };
  },
};

export default rule;
