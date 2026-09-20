/**
 * Rules 12 and 13 — `minutes_section` INSERT and UPDATE, both R1 — are enforced
 * today by nothing having written the table.
 *
 * The corpus carried `minutes_section_insert` and `minutes_section_update`.
 * `rules.ts` restates both and `permission.test.ts` pins both, but neither has
 * a production caller: minutes content lives in `minutes_document.content_json`,
 * and the product has no section router, route or raw write. An unwritten table
 * cannot be written past its guard — which is a true statement about today and
 * a worthless one about tomorrow. The first section writer someone adds
 * inherits a rule that is decided, documented, and attached to nothing.
 *
 * So this file makes the absence mechanical instead of incidental. It fails in
 * both directions:
 *
 *   - a production writer to `minutes_section` appears that does NOT reference
 *     the guards (the tripwire — the thing that would otherwise ship unguarded);
 *   - the guards themselves disappear from `rules.ts` (a cleanup deleting the
 *     only record that R1 governs sections, along with the rules the next
 *     implementer would otherwise have to re-derive).
 *
 * Owner decision, 2026-09-20 (backlog 16): `content_json` is today's shape;
 * `minutes_section` is a deferred design whose authorization is already settled.
 * Whoever builds the sectioned editor wires these two guards and updates this
 * file's expectation — deliberately, with this comment in front of them.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const API_SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const RULES = join(API_SRC, "trpc", "authorization", "rules.ts");

/** Every production `.ts` under `packages/api/src` — tests and fixtures excluded. */
function productionSources(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "__tests__" || entry === "test") return [];
      return productionSources(full);
    }
    if (!entry.endsWith(".ts") || entry.endsWith(".test.ts")) return [];
    return [full];
  });
}

const SECTION_WRITE = /(?:INSERT\s+INTO|UPDATE)\s+minutes_section\b/i;

describe("rules 12 and 13 — minutes_section writes (backlog 16)", () => {
  it("has no production writer, or every writer calls the guards", () => {
    const offenders = productionSources(API_SRC)
      .map((file) => ({ file, text: readFileSync(file, "utf8") }))
      .filter(({ text }) => SECTION_WRITE.test(text))
      .filter(
        ({ text }) =>
          !text.includes("assertCanInsertMinutesSection") &&
          !text.includes("assertCanUpdateMinutesSection"),
      )
      .map(({ file }) => file.slice(API_SRC.length + 1))
      .sort();

    expect(
      offenders,
      "these files write minutes_section without referencing rule 12 or 13. Minutes sections " +
        "are R1 (`edit_draft_minutes`), board-scoped — the corpus policies were " +
        "`minutes_section_insert` and `minutes_section_update`. Call " +
        "assertCanInsertMinutesSection / assertCanUpdateMinutesSection with the board the " +
        "section's minutes_document belongs to, the way minutes-document.ts derives it, and " +
        "then update this test's expectation. See backlog 16",
    ).toEqual([]);
  });

  it("keeps the two guards, so the decided rule is not deleted as dead code", () => {
    const rules = readFileSync(RULES, "utf8");

    // Named individually: a single "both are gone" assertion cannot say which.
    expect(
      rules.includes("export function assertCanInsertMinutesSection"),
      "assertCanInsertMinutesSection is gone from rules.ts. It has no caller by design " +
        "(backlog 16) — it is the record that creating a minutes section requires R1. " +
        "Deleting it is a product decision (drop the table too), not a cleanup",
    ).toBe(true);
    expect(
      rules.includes("export function assertCanUpdateMinutesSection"),
      "assertCanUpdateMinutesSection is gone from rules.ts — same reasoning as the insert guard",
    ).toBe(true);

    // Both must still resolve R1. A guard that survives but silently changes
    // code enforces a different rule than the policy did.
    for (const guard of ["assertCanInsertMinutesSection", "assertCanUpdateMinutesSection"]) {
      const body = rules.slice(rules.indexOf(`export function ${guard}`));
      expect(body.slice(0, body.indexOf("}")), `${guard} no longer resolves R1`).toContain('"R1"');
    }
  });
});
