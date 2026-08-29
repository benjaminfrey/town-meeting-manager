/**
 * Stage 1, Task D1c review, item 5 — `lib/push.ts`, actually executed.
 *
 * ─── Why this file exists ─────────────────────────────────────────────────
 *
 * D1c added a town-scoping fix to `dispatchPushToUser`: the cleanup DELETE
 * that removes expired subscriptions gained `WHERE user_account_id = …`,
 * because the previous version matched on the endpoint string alone. Nothing
 * proved it. The only suite that reaches this module,
 * `services/__tests__/notification-service.test.ts`, does
 * `vi.mock("../../lib/push.js", …)` wholesale — so `push.ts` had zero executed
 * coverage, and deleting the new predicate left every test in the repository
 * green.
 *
 * ─── What is and is not at risk ───────────────────────────────────────────
 *
 * Row level security still holds ACROSS towns: `push_subscription`'s policy
 * resolves through `user_account.town_id`, so a `TenantJob` for town A cannot
 * see or delete town B's rows however the WHERE clause is written. That half
 * is real and is asserted below, but it was never the exposure.
 *
 * The guard that has no other enforcement is the SAME-TOWN one. A push
 * endpoint is a URL the browser's push service mints, and the table's unique
 * constraint is on `(user_account_id, endpoint)` — the pair, not the endpoint
 * — so two accounts in one town holding the same endpoint string is a shape
 * the schema explicitly permits. It happens for real: a shared kiosk browser,
 * a restored browser profile, a push service reissuing an endpoint after a
 * subscription is dropped. When one of those two subscriptions expires, an
 * endpoint-only DELETE silently unsubscribes the OTHER clerk, who then stops
 * receiving meeting notifications with nothing to indicate why. RLS cannot
 * catch it: both rows are in the same town, so both are visible.
 *
 * That is the case the first test builds.
 *
 * ─── The stubs ───────────────────────────────────────────────────────────
 *
 * `web-push` only, for the same reason `notification-service.test.ts` stubs
 * Postmark: it is a network edge. The database is real and the connection is
 * `tmm_app`, the non-owner runtime role, so RLS is on rather than bypassed.
 *
 * VAPID keys have to be in the environment BEFORE `push.ts` is imported —
 * the module reads them at load time and `sendPushNotification` returns
 * "sent" for everything when they are absent, which would mean nothing ever
 * expires and the cleanup path never runs at all. Hence `vi.hoisted` for the
 * environment and a dynamic import for the module under test.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import type postgres from "postgres";
import { withTestDb, connectAsAppRole } from "../../test/db-harness.js";
import { tenantJob } from "../../jobs/tenant-job.js";

// Set before any import of `push.js` is evaluated. `vi.hoisted` runs above the
// `vi.mock` factories and above the dynamic import inside each test.
vi.hoisted(() => {
  // A syntactically valid VAPID pair. web-push is mocked, so these are never
  // used to sign anything — they exist only so `push.ts`'s module-level
  // `if (vapidPublicKey && vapidPrivateKey)` is true and the expiry path is
  // reachable.
  process.env.VAPID_PUBLIC_KEY =
    "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U";
  process.env.VAPID_PRIVATE_KEY = "UUxI4O8-FbRouAevSmBQ6o18hgE4nSG3qwvJTfKc-ls";
});

/** Endpoints web-push should answer 410 Gone for. */
const expiredEndpoints = new Set<string>();

const sendNotification = vi.fn(async (subscription: { endpoint: string }, _payload: string) => {
  if (expiredEndpoints.has(subscription.endpoint)) {
    throw Object.assign(new Error("Gone"), { statusCode: 410 });
  }
  return undefined;
});

vi.mock("web-push", () => ({
  default: {
    setVapidDetails: vi.fn(),
    sendNotification: (subscription: { endpoint: string }, payload: string) =>
      sendNotification(subscription, payload),
  },
}));

beforeEach(() => {
  expiredEndpoints.clear();
  sendNotification.mockClear();
});

// ─── Fixture ──────────────────────────────────────────────────────────

interface TownFixture {
  townId: string;
  /** Two accounts in this town, each with one push subscription. */
  firstAccountId: string;
  secondAccountId: string;
}

async function seedTown(app: postgres.Sql, name: string, endpoint: string): Promise<TownFixture> {
  const townId = randomUUID();
  const firstAccountId = randomUUID();
  const secondAccountId = randomUUID();

  await app.begin(async (tx) => {
    await tx`SELECT set_config('app.town_id', ${townId}, true)`;
    await tx`INSERT INTO town (id, name, subdomain) VALUES (${townId}, ${name}, ${name})`;
    for (const accountId of [firstAccountId, secondAccountId]) {
      const personId = randomUUID();
      await tx`INSERT INTO person (id, town_id, name, email)
               VALUES (${personId}, ${townId}, ${`Clerk ${accountId.slice(0, 4)}`},
                       ${`${accountId.slice(0, 4)}@${name}.gov`})`;
      await tx`INSERT INTO user_account (id, person_id, town_id, role, email)
               VALUES (${accountId}, ${personId}, ${townId}, 'staff',
                       ${`${accountId.slice(0, 4)}@${name}.gov`})`;
      // THE SAME endpoint string on both accounts. Permitted: the unique
      // constraint is on (user_account_id, endpoint).
      await tx`INSERT INTO push_subscription (id, user_account_id, endpoint, p256dh, auth)
               VALUES (${randomUUID()}, ${accountId}, ${endpoint}, 'p256dh-key', 'auth-key')`;
    }
  });

  return { townId, firstAccountId, secondAccountId };
}

async function endpointsFor(app: postgres.Sql, townId: string, accountId: string) {
  const rows = await app.begin(async (tx) => {
    await tx`SELECT set_config('app.town_id', ${townId}, true)`;
    return tx<{ endpoint: string }[]>`
      SELECT endpoint FROM push_subscription WHERE user_account_id = ${accountId}
    `;
  });
  return rows.map((r) => r.endpoint);
}

describe("dispatchPushToUser removes only the account's own expired subscription", () => {
  it("leaves a same-town account holding the identical endpoint subscribed", async () => {
    await withTestDb(async (owner) => {
      const app = await connectAsAppRole(owner);
      try {
        // One shared endpoint string across two accounts in ONE town.
        const shared = "https://push.example.test/shared-browser-endpoint";
        const town = await seedTown(app, "collidington", shared);

        // The push service says this endpoint is gone. Both rows carry it;
        // only the one belonging to the account being dispatched to may go.
        expiredEndpoints.add(shared);

        const { dispatchPushToUser } = await import("../push.js");
        const job = tenantJob(drizzle(app), town.townId);
        await dispatchPushToUser(job, town.firstAccountId, {
          title: "Meeting tonight",
          body: "Select Board, 7pm",
        });

        // The dispatched account's expired subscription is cleaned up …
        expect(await endpointsFor(app, town.townId, town.firstAccountId)).toEqual([]);
        // … and the other clerk in the same town is still subscribed. This is
        // the assertion that fails if `WHERE user_account_id = …` is removed
        // from the cleanup DELETE: RLS cannot distinguish these two rows,
        // because they belong to the same town.
        expect(await endpointsFor(app, town.townId, town.secondAccountId)).toEqual([shared]);
      } finally {
        await app.end();
      }
    });
  });

  it("does not delete a live subscription when nothing expired", async () => {
    await withTestDb(async (owner) => {
      const app = await connectAsAppRole(owner);
      try {
        const endpoint = "https://push.example.test/healthy-endpoint";
        const town = await seedTown(app, "steadyville", endpoint);
        // expiredEndpoints deliberately empty: web-push accepts the send.

        const { dispatchPushToUser } = await import("../push.js");
        const job = tenantJob(drizzle(app), town.townId);
        await dispatchPushToUser(job, town.firstAccountId, { title: "Hi", body: "There" });

        // The negative control for the test above: if the cleanup ran
        // unconditionally, that test would pass for the wrong reason.
        expect(sendNotification).toHaveBeenCalledTimes(1);
        expect(await endpointsFor(app, town.townId, town.firstAccountId)).toEqual([endpoint]);
        expect(await endpointsFor(app, town.townId, town.secondAccountId)).toEqual([endpoint]);
      } finally {
        await app.end();
      }
    });
  });

  it("sends nothing, and deletes nothing, for an account in another town", async () => {
    await withTestDb(async (owner) => {
      const app = await connectAsAppRole(owner);
      try {
        const endpoint = "https://push.example.test/cross-town-endpoint";
        const alpha = await seedTown(app, "alphapush", endpoint);
        const beta = await seedTown(app, "betapush", endpoint);
        expiredEndpoints.add(endpoint);

        const { dispatchPushToUser } = await import("../push.js");
        // A job for ALPHA, handed BETA's account id — the shape a stray id in
        // a queued payload would produce.
        const job = tenantJob(drizzle(app), alpha.townId);
        await dispatchPushToUser(job, beta.firstAccountId, { title: "Hi", body: "There" });

        // The SELECT returns nothing under Beta's policy, so no push is
        // attempted and the cleanup branch is never entered.
        expect(sendNotification).not.toHaveBeenCalled();
        expect(await endpointsFor(app, beta.townId, beta.firstAccountId)).toEqual([endpoint]);
        expect(await endpointsFor(app, alpha.townId, alpha.firstAccountId)).toEqual([endpoint]);
      } finally {
        await app.end();
      }
    });
  });
});

describe("dispatchPushToTown reaches its own town's subscribers only", () => {
  it("pushes to every account in the job's town and to none outside it", async () => {
    await withTestDb(async (owner) => {
      const app = await connectAsAppRole(owner);
      try {
        const alpha = await seedTown(app, "alphatown", "https://push.example.test/alpha");
        await seedTown(app, "betatown", "https://push.example.test/beta");

        const { dispatchPushToTown } = await import("../push.js");
        await dispatchPushToTown(tenantJob(drizzle(app), alpha.townId), "meeting_reminder", {
          title: "Reminder",
          body: "Tonight",
        });

        // Two accounts in Alpha, one subscription each. Beta's endpoint must
        // not appear: there is no town filter in the query at all, so this is
        // the only thing asserting that `app.town_id` is what bounds it.
        const reached = sendNotification.mock.calls.map(([subscription]) => subscription.endpoint);
        expect(reached).toEqual([
          "https://push.example.test/alpha",
          "https://push.example.test/alpha",
        ]);
        expect(reached).not.toContain("https://push.example.test/beta");
      } finally {
        await app.end();
      }
    });
  });

  it("skips an account that has turned push off", async () => {
    await withTestDb(async (owner) => {
      const app = await connectAsAppRole(owner);
      try {
        const town = await seedTown(app, "optout", "https://push.example.test/optout");
        const db = drizzle(app);
        await tenantJob(db, town.townId).run(async (tx) => {
          await tx.execute(sql`
            UPDATE user_account
               SET notification_preferences = '{"push_enabled": false}'::jsonb
             WHERE id = ${town.secondAccountId}::uuid
          `);
        });

        const { dispatchPushToTown } = await import("../push.js");
        await dispatchPushToTown(tenantJob(db, town.townId), "meeting_reminder", {
          title: "Reminder",
          body: "Tonight",
        });

        expect(sendNotification).toHaveBeenCalledTimes(1);
      } finally {
        await app.end();
      }
    });
  });
});
