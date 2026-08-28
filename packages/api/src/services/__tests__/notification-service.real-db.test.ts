/**
 * Task 3 (A3) — IMPORTANT 3 from code review.
 *
 * notification-service.test.ts mocks board_member and user_account with
 * identity-function `.select()`/`.eq()` — a mock that returns
 * `mockBoardMembers` regardless of what column is actually selected. Code
 * review demonstrated that mock cannot fail even when the exact audit bug
 * (`board_member.user_account_id`, which does not exist) is reintroduced,
 * and cannot fail when the person->user_account embed is silently changed
 * from a LEFT JOIN to an INNER JOIN — which excludes precisely the
 * account-less board member the person-based decision exists to protect.
 *
 * notification-schema.test.ts (the other new test file from this task) is
 * real Postgres but hand-written SQL — it proves the SCHEMA supports the
 * right shape, not that notification-service.ts's actual code USES it.
 *
 * This file closes that gap: it calls the real, exported
 * `getBoardSubscribers` from notification-service.ts against a real
 * Postgres database (via the Task A2 harness), through a minimal
 * supabase-js-shaped shim that executes genuine SQL (a real LEFT JOIN, a
 * real board_member.person_id SELECT) instead of returning canned data.
 * See realSupabaseShim's own doc comment for exactly how narrow it is and
 * why that's still enough to catch a real regression.
 */

import { describe, it, expect } from "vitest";
import { withTestDb } from "../../test/db-harness.js";
import { getBoardSubscribers } from "../notification-service.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type postgres from "postgres";

// ─── Minimal real-SQL Supabase-js shim ─────────────────────────────────
//
// The harness hands back a raw postgres.js connection, not a PostgREST
// endpoint, so the real supabase-js client can't be pointed at it. This
// shim implements just enough of supabase-js's chainable query-builder
// surface to execute the two query shapes getBoardSubscribers and
// getSubscribersForPersonIds actually send:
//
//   .from("board_member").select("<cols>").eq(col, v).eq(col, v)
//   .from("person").select("<cols>, user_account[!inner](<cols>)")
//     .eq(col, v).in(col, [v...])
//
// It is deliberately NOT a general Supabase mock. It translates each call
// into real SQL text and runs it through the real connection, so:
//   - a `.select()` naming a column the table doesn't have (e.g. the
//     audit bug's `board_member.user_account_id`) hits a genuine Postgres
//     "column does not exist" error, exactly like the real app would;
//   - the embed becomes a genuine SQL LEFT JOIN (or, if the select string
//     asks for `user_account!inner(...)`, a genuine INNER JOIN) against
//     the real user_account table, so an account-less person is only
//     returned if the join is actually a LEFT JOIN.
function realSupabaseShim(sql: postgres.Sql): SupabaseClient {
  type Filter = { col: string; op: "eq" | "in"; val: unknown };

  function buildQuery(table: string, selectExpr: string, filters: Filter[]) {
    const params: unknown[] = [];
    const whereParts: string[] = [];
    for (const f of filters) {
      params.push(f.val);
      const idx = params.length;
      whereParts.push(
        f.op === "eq" ? `${table}.${f.col} = $${idx}` : `${table}.${f.col} = ANY($${idx})`,
      );
    }
    const where = whereParts.length > 0 ? `WHERE ${whereParts.join(" AND ")}` : "";

    // Detect a trailing embed, e.g. "id, name, email, user_account(a, b)"
    // or "...user_account!inner(a, b)" — the exact shape
    // getSubscribersForPersonIds sends, and the exact shape the
    // !inner-mutation described in review produces.
    const embedMatch = selectExpr.match(/^(.*?),\s*(\w+)(!inner)?\(([^)]*)\)\s*$/);

    if (!embedMatch) {
      const cols = selectExpr
        .split(",")
        .map((c) => c.trim())
        .join(", ");
      return { text: `SELECT ${cols} FROM ${table} ${where}`, params };
    }

    const [, plainColsRaw, embedTable, innerHint, embedColsRaw] = embedMatch;
    if (table !== "person" || embedTable !== "user_account") {
      throw new Error(`realSupabaseShim: unsupported embed ${table} -> ${embedTable}`);
    }
    const plainCols = plainColsRaw!
      .split(",")
      .map((c) => c.trim())
      .map((c) => `${table}.${c} AS ${c}`)
      .join(", ");
    const embedCols = embedColsRaw!.split(",").map((c) => c.trim());
    const jsonPairs = embedCols.map((c) => `'${c}', ${embedTable}.${c}`).join(", ");
    const joinType = innerHint ? "INNER JOIN" : "LEFT JOIN";
    // person.id is the join key from the OTHER side (user_account.person_id
    // -> person.id); on an unmatched LEFT JOIN row every user_account.*
    // column is NULL, including person_id, so that's what "no account"
    // detection keys on.
    const embedExpr = innerHint
      ? `json_build_object(${jsonPairs})`
      : `CASE WHEN ${embedTable}.person_id IS NULL THEN NULL ELSE json_build_object(${jsonPairs}) END`;

    const text = `SELECT ${plainCols}, ${embedExpr} AS user_account FROM ${table} ${joinType} ${embedTable} ON ${embedTable}.person_id = ${table}.id ${where}`;
    return { text, params };
  }

  function makeBuilder(table: string) {
    let selectExpr = "*";
    const filters: Filter[] = [];

    async function execute(): Promise<{ data: unknown; error: { message: string } | null }> {
      try {
        const { text, params } = buildQuery(table, selectExpr, filters);
        const rows = await sql.unsafe(text, params as never[]);
        return { data: [...rows], error: null };
      } catch (err) {
        return { data: null, error: { message: err instanceof Error ? err.message : String(err) } };
      }
    }

    const builder = {
      select(expr: string) {
        selectExpr = expr;
        return builder;
      },
      eq(col: string, val: unknown) {
        filters.push({ col, op: "eq", val });
        return builder;
      },
      in(col: string, val: unknown[]) {
        filters.push({ col, op: "in", val });
        return builder;
      },
      then(resolve: (v: unknown) => unknown, reject?: (v: unknown) => unknown) {
        return execute().then(resolve, reject);
      },
    };

    return builder;
  }

  return { from: (table: string) => makeBuilder(table) } as unknown as SupabaseClient;
}

// ─── Test ───────────────────────────────────────────────────────────────

describe("getBoardSubscribers against a real database (IMPORTANT 3)", () => {
  it("resolves an account-less board member — the exact case the person-based decision protects", async () => {
    await withTestDb(async (sql) => {
      const [town] = await sql<{ id: string }[]>`
        INSERT INTO town (id, name) VALUES (gen_random_uuid(), 'Testville') RETURNING id
      `;
      const [board] = await sql<{ id: string }[]>`
        INSERT INTO board (id, town_id, name) VALUES (gen_random_uuid(), ${town!.id}, 'Select Board') RETURNING id
      `;
      const [person] = await sql<{ id: string }[]>`
        INSERT INTO person (id, town_id, name, email)
        VALUES (gen_random_uuid(), ${town!.id}, 'Alice Board Member', 'alice@testville.gov')
        RETURNING id
      `;
      // No INSERT into user_account for this person — directory-only /
      // account-less board member (AddPersonDialog's "Directory-only"
      // choice; people.test.tsx covers exactly this).
      await sql`
        INSERT INTO board_member (id, person_id, board_id, town_id, term_start, status)
        VALUES (gen_random_uuid(), ${person!.id}, ${board!.id}, ${town!.id}, CURRENT_DATE, 'active')
      `;

      const supabase = realSupabaseShim(sql);
      const subscribers = await getBoardSubscribers(supabase, board!.id, town!.id);

      expect(subscribers).toHaveLength(1);
      expect(subscribers[0]!.id).toBe(person!.id);
      expect(subscribers[0]!.email).toBe("alice@testville.gov");
      expect(subscribers[0]!.email_bounced).toBe(false);
      expect(subscribers[0]!.email_complained).toBe(false);
    });
  });
});
