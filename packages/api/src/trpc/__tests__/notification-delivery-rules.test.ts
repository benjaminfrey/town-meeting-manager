/**
 * Rule 18 — `notification_delivery` SELECT: C2, **or the subscriber's own row**.
 *
 * Every delivery read in `routes/notifications.ts` sits behind the
 * `notificationAdmin` preHandler (C2), and NO SURFACE shows a person their own
 * notification history — so when backlog 18 was filed, the rule's self branch
 * had no production caller and was enforced only by that absence.
 *
 * Closing it turned up something the entry had not:
 * `NotificationService.getSubscriberDeliveryHistory(personId)` already existed,
 * read any person's deliveries by id, applied no rule, and had no caller — an
 * unguarded reader waiting for a route to be wired to it. It now takes the
 * actor and calls `assertCanSelectNotificationDelivery` itself, so the rule is
 * enforced at the read rather than trusted to whoever wires it later. That is
 * the self branch's first real caller.
 *
 * Owner decision, 2026-09-20 (backlog 18): the self branch stays. A
 * person-facing delivery history is a plausible feature whose authorization is
 * already settled, and deleting the branch would mean deciding that residents
 * never see one — a decision nobody has taken.
 *
 * This file makes that mechanical. It fails when:
 *
 *   - a production file reads `notification_delivery` without either the
 *     `notificationAdmin` preHandler (the C2 path) or rule 18's own functions
 *     (the self path) — the case that would otherwise ship unscoped;
 *   - the self branch disappears from the rule, silently turning it into a
 *     C2-only rule that no longer matches the policy or its test.
 *
 * Contrast rule 19, whose C2 branch was REMOVED by the same review: there the
 * unreachable branch exposed one person's choices to another, so inheriting it
 * was the weaker option. Here the unreachable branch protects a person's access
 * to their own record. Different directions, different answers.
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

const DELIVERY_READ = /FROM\s+notification_delivery\b/i;

describe("rule 18 — notification_delivery reads (backlog 18)", () => {
  /**
   * Granularity is per FILE, not per query, and that is a deliberate limit: a
   * file that reads deliveries must show the rule somewhere in it, which is
   * enough to make an unscoped NEW file fail while staying readable. Two reads
   * inside `services/notification-service.ts` are scoped by something other
   * than the rule and are worth naming, since this test cannot tell them apart:
   *
   *   - `getDeliverySummary` is called only from `routes/notifications.ts`,
   *     behind the `notificationAdmin` preHandler (C2);
   *   - `processRetries` is the background sender, run per town by
   *     `server.ts`'s loop with no actor at all — there is no user whose
   *     permissions could scope it, and it reads nothing back to anyone.
   */
  it("every production reader is scoped by C2 or by rule 18 itself", () => {
    const mentionsRule = (text: string) =>
      /canSelectNotificationDelivery|visibleNotificationDeliveries/i.test(text);

    const unscoped = productionSources(API_SRC)
      .map((file) => ({ file, text: readFileSync(file, "utf8") }))
      .filter(({ text }) => DELIVERY_READ.test(text))
      .filter(
        ({ text }) =>
          // the C2 path: routes/notifications.ts's admin preHandler
          !text.includes("notificationAdmin") &&
          // the self path: rule 18's own functions, in any of their forms
          !mentionsRule(text),
      )
      .map(({ file }) => file.slice(API_SRC.length + 1))
      .sort();

    expect(
      unscoped,
      "these files read notification_delivery without C2 gating and without rule 18. A delivery " +
        "row names who was contacted and about what: it is readable with C2 " +
        "(manage_notification_settings), or by the subscriber themselves. Put the read behind " +
        "the notificationAdmin preHandler, or filter it through " +
        "visibleNotificationDeliveries, then update this test. See backlog 18",
    ).toEqual([]);
  });

  it("keeps the self branch, which is the half no caller exercises", () => {
    const rules = readFileSync(RULES, "utf8");
    const body = rules.slice(
      rules.indexOf("export function canSelectNotificationDelivery"),
      rules.indexOf("export function assertCanSelectNotificationDelivery"),
    );

    expect(
      body,
      "canSelectNotificationDelivery no longer compares the row's subscriber to the actor. " +
        "That self branch is the half with no production caller (backlog 18) — it is what lets " +
        "a person read their own notification history, and removing it is a product decision " +
        "about residents, not a cleanup of dead code",
    ).toContain("row.subscriberId === actor.personId");

    expect(body, "canSelectNotificationDelivery no longer admits C2").toContain('"C2"');
  });
});
