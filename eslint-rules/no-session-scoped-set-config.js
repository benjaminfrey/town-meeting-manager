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
 * ─── Scope: the `app.` namespace only ────────────────────────────────────
 *
 * Both checks fire only on GUCs whose name contains `app.`, the one namespace
 * this application owns. `set_config('statement_timeout', '5s', false)` is a
 * legitimate pattern and is not this rule's business — and a rule that flags
 * legitimate code is a rule that earns a blanket disable comment, which costs
 * more than it saves.
 *
 * ─── What it reads, and what it cannot ───────────────────────────────────
 *
 * SQL is read out of string literals, template literals, and `+`
 * concatenations of those (a concatenation is analysed once, at the outermost
 * `+`, from its flattened text — so splitting `..., false)` across two string
 * literals does not evade it). `${...}` interpolations become a `$`-prefixed
 * placeholder, so an interpolated value still reads as an argument.
 * Argument-splitting balances parentheses and skips over single-quoted
 * strings, so `set_config('app.town_id', $1, (1=0))` is seen as three
 * arguments rather than being missed on the nested parens.
 *
 * Limits, stated rather than hidden — all three are genuinely out of reach for
 * a syntactic rule:
 *
 *   - SQL assembled from values a static read cannot see (`sql[key]`, an array
 *     `.join()`, a string returned by a function, a template built in a loop).
 *   - SQL in `.sql` files, which ESLint does not parse. `supabase/seed.sql` is
 *     the one deliberate session-scoped use in the repository — it applies one
 *     file as one tenant, outside any request — and carries a comment saying so.
 *   - A GUC whose *name* is dynamic (`set_config(gucName, v, false)`), since
 *     the namespace scoping above cannot tell whether it is `app.`-anything.
 *
 * The runtime backstop for all three is the transaction-leak assertion in
 * `packages/api/src/db/__tests__/tenant-isolation.test.ts`; this rule and that
 * assertion are the only two protections for this property, so neither is
 * redundant.
 */

/**
 * `SET app.<something> = <value>` that is not `SET LOCAL`.
 *
 * The trailing `['$]` is not decoration. Without it this fired on the English
 * sentence "would set app.town_id to something ..." inside an error message in
 * with-tenant.ts — caught by running the rule over the repository rather than
 * only over fixtures. Requiring the value to start like SQL (a quote, or a
 * `$n` placeholder, which is also what PLACEHOLDER below is shaped as) keeps
 * prose out while still matching `= '...'`, `TO $1` and `= ${expr}`.
 */
const BARE_SET = /\bset\s+(?!local\b)app\.[a-z_]+\s*(?:=|\bto\b)\s*['$]/gi;

/** Start of a `set_config(` call; arguments are then scanned by hand. */
const SET_CONFIG_HEAD = /\bset_config\s*\(/gi;

/** Text stand-in for a `${...}` placeholder. No commas, parens or quotes, so
 * it does not disturb the argument scan; never the literal `true`; and shaped
 * like a `$n` bind parameter so BARE_SET recognises it as a value. */
const PLACEHOLDER = "$__EXPRESSION__";

/**
 * Find every `set_config(...)` call in `text` and return its arguments.
 *
 * Hand-written rather than a regex because a regex either cannot handle nested
 * parentheses at all — `set_config('app.town_id', $1, (1=0))` slipped straight
 * past the first version — or becomes unreadable trying. Single-quoted strings
 * are skipped over so a comma or parenthesis inside a SQL literal does not
 * split an argument.
 *
 * @param {string} text
 * @returns {string[][]} one entry per call, each the trimmed argument list
 */
function findSetConfigCalls(text) {
  const calls = [];
  SET_CONFIG_HEAD.lastIndex = 0;
  let head;

  while ((head = SET_CONFIG_HEAD.exec(text)) !== null) {
    const args = [];
    let current = "";
    let depth = 0;
    let inString = false;
    let i = head.index + head[0].length - 1; // the opening parenthesis

    for (; i < text.length; i += 1) {
      const ch = text[i];

      if (inString) {
        current += ch;
        if (ch === "'") inString = false;
        continue;
      }
      if (ch === "'") {
        inString = true;
        current += ch;
        continue;
      }
      if (ch === "(") {
        depth += 1;
        if (depth > 1) current += ch;
        continue;
      }
      if (ch === ")") {
        depth -= 1;
        if (depth === 0) {
          args.push(current);
          break;
        }
        current += ch;
        continue;
      }
      if (ch === "," && depth === 1) {
        args.push(current);
        current = "";
        continue;
      }
      current += ch;
    }

    // Unbalanced: a truncated fragment, not a complete call. Nothing to judge.
    if (depth !== 0) continue;

    calls.push(args.map((a) => a.trim()));
    SET_CONFIG_HEAD.lastIndex = i + 1;
  }

  return calls;
}

/**
 * Flatten an expression to the SQL text it produces, as far as that is
 * statically knowable. Anything unknowable becomes PLACEHOLDER.
 *
 * @param {import("estree").Node} node
 * @returns {string}
 */
function flatten(node) {
  if (node.type === "Literal" && typeof node.value === "string") return node.value;
  if (node.type === "TemplateLiteral") {
    return node.quasis.map((q) => q.value.raw).join(PLACEHOLDER);
  }
  if (node.type === "TaggedTemplateExpression") return flatten(node.quasi);
  if (node.type === "BinaryExpression" && node.operator === "+") {
    return flatten(node.left) + flatten(node.right);
  }
  return PLACEHOLDER;
}

/** True when `node` is an operand of a `+`, i.e. part of a larger concatenation. */
function isConcatOperand(node) {
  const parent = node.parent;
  return Boolean(parent && parent.type === "BinaryExpression" && parent.operator === "+");
}

/** @type {import("eslint").Rule.RuleModule} */
const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "require SET LOCAL semantics when setting an app.* GUC — a session-scoped " +
        "value leaks tenant context across pooled connections",
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
      for (const args of findSetConfigCalls(text)) {
        // set_config is always 3-arity; anything else is not the call we mean.
        if (args.length !== 3) continue;
        // Scoped to the namespace this application owns — see the header.
        if (!/app\./i.test(args[0])) continue;
        if (args[2].toLowerCase() === "true") continue;
        context.report({ node, messageId: "sessionScoped", data: { found: args[2] } });
      }

      BARE_SET.lastIndex = 0;
      let match;
      while ((match = BARE_SET.exec(text)) !== null) {
        context.report({ node, messageId: "bareSet", data: { found: match[0] } });
      }
    }

    // Each expression is checked exactly once, at the outermost node that
    // knows its whole text: operands of a `+` are skipped and the root
    // concatenation is checked instead, so nothing is reported twice and
    // nothing split across a `+` is missed.
    return {
      Literal(node) {
        if (typeof node.value === "string" && !isConcatOperand(node)) check(node, node.value);
      },
      TemplateLiteral(node) {
        if (!isConcatOperand(node) && node.parent?.type !== "TaggedTemplateExpression") {
          check(node, flatten(node));
        }
      },
      TaggedTemplateExpression(node) {
        if (!isConcatOperand(node)) check(node, flatten(node));
      },
      BinaryExpression(node) {
        if (node.operator === "+" && !isConcatOperand(node)) check(node, flatten(node));
      },
    };
  },
};

export default rule;
