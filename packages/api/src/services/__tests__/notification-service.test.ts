/**
 * Notification Service — the event-to-delivery pipeline, against a real
 * database.
 *
 * ─── Why this file was rewritten wholesale (Task D1c) ─────────────────────
 *
 * It used to be 500 lines of Supabase mock: a `buildProcessSupabase` factory
 * with per-table call counting that returned canned rows regardless of what
 * the query actually asked for. Two things were wrong with that, and both were
 * demonstrated rather than theorised — the file it replaced,
 * `notification-service.real-db.test.ts`, existed precisely because code
 * review showed the mock could not fail:
 *
 *   - it returned `mockBoardMembers` whatever column was selected, so the
 *     `board_member.user_account_id` bug (a column that does not exist) passed;
 *   - it could not tell a LEFT JOIN from an INNER JOIN, so silently dropping
 *     every account-less board member — the exact person the person-based
 *     subscriber decision exists to protect — also passed.
 *
 * The service now issues real SQL, and mocking SQL results would be strictly
 * worse than mocking PostgREST was. So the database is real (the Task A2
 * harness), the connection is `tmm_app` — a NON-OWNER, which does not bypass
 * row level security — and the only things stubbed are the two genuinely
 * external ones: Postmark and web-push.
 *
 * That connection choice is what makes the tenancy assertions mean anything.
 * On the owner connection (a superuser in every supported setup) every one of
 * them would pass with the security model switched off.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import type postgres from "postgres";
import { withTestDb, connectAsAppRole } from "../../test/db-harness.js";
import { tenantJob } from "../../jobs/tenant-job.js";
import { NotificationService, getBoardSubscribers } from "../notification-service.js";
import { withTenant } from "../../db/with-tenant.js";

// ─── The two external edges, and nothing else ─────────────────────────

const mockSendEmail = vi.fn().mockResolvedValue({ MessageID: "test-message-id" });
const mockEmailSenderInstance = { sendEmail: mockSendEmail };

// Hoisted so the assertions below can read what the service passed it. The
// template layer is a pure function of these variables, so asserting on its
// arguments is how `recipientName` and `preferencesUrl` — which do not survive
// into the stubbed HTML — are observed at all.
const mockRenderEmailTemplate = vi.fn().mockReturnValue({
  html: "<p>Test email</p>",
  text: "Test email",
  subject: "Test Subject",
});

vi.mock("../email-sender.js", () => ({
  // Must use `function` (not arrow) so `new EmailSenderService()` works
  EmailSenderService: vi.fn(function () {
    return mockEmailSenderInstance;
  }),
  getMessageStream: vi.fn().mockReturnValue("outbound"),
  isBroadcastEvent: vi.fn().mockReturnValue(false),
  renderEmailTemplate: (...args: unknown[]) => mockRenderEmailTemplate(...args),
}));

vi.mock("../../lib/postmark.js", () => ({
  getPostmarkClient: vi.fn().mockResolvedValue({}),
}));

const mockDispatchPushToTown = vi.fn().mockResolvedValue(undefined);
vi.mock("../../lib/push.js", () => ({
  dispatchPushToTown: (...args: unknown[]) => mockDispatchPushToTown(...args),
}));

beforeEach(() => {
  mockSendEmail.mockClear();
  mockDispatchPushToTown.mockClear();
  mockRenderEmailTemplate.mockClear();
});

// ─── Fixtures ─────────────────────────────────────────────────────────

interface TownFixture {
  townId: string;
  boardId: string;
  /** Board members with an email and a live account. */
  members: { personId: string; accountId: string; email: string }[];
  /** A board member with NO user_account at all. */
  accountlessPersonId: string;
  adminPersonId: string;
}

async function seedTown(app: postgres.Sql, name: string): Promise<TownFixture> {
  const townId = randomUUID();
  const boardId = randomUUID();
  const members = [
    { personId: randomUUID(), accountId: randomUUID(), email: `alice@${name}.gov` },
    { personId: randomUUID(), accountId: randomUUID(), email: `bob@${name}.gov` },
  ];
  const accountlessPersonId = randomUUID();
  const adminPersonId = randomUUID();
  const adminAccountId = randomUUID();

  await app.begin(async (tx) => {
    await tx`SELECT set_config('app.town_id', ${townId}, true)`;
    await tx`INSERT INTO town (id, name, subdomain) VALUES (${townId}, ${name}, ${name})`;
    await tx`INSERT INTO board (id, town_id, name) VALUES (${boardId}, ${townId}, 'Select Board')`;

    for (const [i, m] of members.entries()) {
      await tx`INSERT INTO person (id, town_id, name, email)
               VALUES (${m.personId}, ${townId}, ${`Member ${i}`}, ${m.email})`;
      await tx`INSERT INTO user_account (id, person_id, town_id, role, email)
               VALUES (${m.accountId}, ${m.personId}, ${townId}, 'board_member', ${m.email})`;
      await tx`INSERT INTO board_member (id, person_id, board_id, town_id, term_start, status)
               VALUES (${randomUUID()}, ${m.personId}, ${boardId}, ${townId}, CURRENT_DATE, 'active')`;
    }

    // Directory-only board member — a person with an address and no login.
    // `AddPersonDialog`'s "Directory-only" choice creates exactly this.
    await tx`INSERT INTO person (id, town_id, name, email)
             VALUES (${accountlessPersonId}, ${townId}, 'Carol Directory', ${`carol@${name}.gov`})`;
    await tx`INSERT INTO board_member (id, person_id, board_id, town_id, term_start, status)
             VALUES (${randomUUID()}, ${accountlessPersonId}, ${boardId}, ${townId}, CURRENT_DATE, 'active')`;

    await tx`INSERT INTO person (id, town_id, name, email)
             VALUES (${adminPersonId}, ${townId}, 'Dana Admin', ${`dana@${name}.gov`})`;
    await tx`INSERT INTO user_account (id, person_id, town_id, role, email)
             VALUES (${adminAccountId}, ${adminPersonId}, ${townId}, 'admin', ${`dana@${name}.gov`})`;
  });

  return { townId, boardId, members, accountlessPersonId, adminPersonId };
}

function serviceFor(app: postgres.Sql, townId: string) {
  return new NotificationService(tenantJob(drizzle(app), townId));
}

/**
 * Queue a `pending` event WITHOUT asking the service to process it.
 *
 * This is the shape `services/notification-triggers.ts` leaves behind — an
 * event row and nothing driving it — and it is also how a test observes an
 * event that has not been touched yet. `createNotificationEvent` schedules its
 * own `setImmediate`, so a test that used it to make "an unprocessed event"
 * would be racing that timer.
 */
async function queuePendingEvent(
  app: postgres.Sql,
  townId: string,
  eventType: string,
  payload: Record<string, unknown>,
): Promise<string> {
  return withTenant(drizzle(app), { townId }, async (tx) => {
    const result = (await tx.execute(sql`
      INSERT INTO notification_event (town_id, event_type, payload, status)
      VALUES (${townId}::uuid, ${eventType}, ${JSON.stringify(payload)}::jsonb, 'pending')
      RETURNING id
    `)) as { id: string }[];
    return String(result[0]!.id);
  });
}

/** Addresses the email stub was asked to send to, in no particular order. */
function sentTo(): string[] {
  return mockSendEmail.mock.calls.map((call) => (call[0] as { to: string }).to).sort();
}

/** Everything the service handed Postmark for one recipient. */
interface SentEmail {
  to: string;
  from: string;
  replyTo?: string;
  subject: string;
  tag: string;
  messageStream: string;
  metadata: Record<string, string>;
}

function sentEmailTo(address: string): SentEmail {
  const call = mockSendEmail.mock.calls.find((c) => (c[0] as SentEmail).to === address);
  if (!call) throw new Error(`no email was sent to ${address}`);
  return call[0] as SentEmail;
}

/** The variables the template layer was rendered with, for one recipient. */
function templateVariablesFor(name: string): Record<string, unknown> {
  const call = mockRenderEmailTemplate.mock.calls.find(
    (c) => (c[1] as { recipientName?: string })?.recipientName === name,
  );
  if (!call) throw new Error(`no template was rendered for ${name}`);
  return call[1] as Record<string, unknown>;
}

// ─── Subscriber resolution ────────────────────────────────────────────

describe("getBoardSubscribers", () => {
  it("resolves an account-less board member — the case the person-based decision protects", async () => {
    // Carried over verbatim from the deleted `notification-service.real-db.test.ts`,
    // which existed to prove the old mock could not catch this. Now it is a
    // plain query against the real join.
    await withTestDb(async (owner) => {
      const app = await connectAsAppRole(owner);
      try {
        const town = await seedTown(app, "alpha");
        const subscribers = await withTenant(drizzle(app), { townId: town.townId }, (tx) =>
          getBoardSubscribers(tx, town.boardId),
        );

        expect(subscribers.map((s) => s.id)).toContain(town.accountlessPersonId);
        expect(subscribers).toHaveLength(3);
        for (const s of subscribers) {
          expect(s.email_bounced).toBe(false);
          expect(s.email_complained).toBe(false);
        }
      } finally {
        await app.end();
      }
    });
  });

  it("cannot see a board that belongs to another town", async () => {
    await withTestDb(async (owner) => {
      const app = await connectAsAppRole(owner);
      try {
        const alpha = await seedTown(app, "alpha");
        const beta = await seedTown(app, "beta");

        // Alpha's tenant context, Beta's board id. Not filtered out — absent.
        const subscribers = await withTenant(drizzle(app), { townId: alpha.townId }, (tx) =>
          getBoardSubscribers(tx, beta.boardId),
        );
        expect(subscribers).toEqual([]);
      } finally {
        await app.end();
      }
    });
  });
});

// ─── The pipeline ─────────────────────────────────────────────────────

describe("processNotificationEvent", () => {
  it("emails every eligible board member and records one delivery each", async () => {
    await withTestDb(async (owner) => {
      const app = await connectAsAppRole(owner);
      try {
        const town = await seedTown(app, "alpha");
        const service = serviceFor(app, town.townId);

        const eventId = await service.createNotificationEvent("agenda_published", {
          board_id: town.boardId,
          meeting_title: "Regular Meeting",
        });
        await service.processNotificationEvent(eventId);

        expect(sentTo()).toEqual([`alice@alpha.gov`, `bob@alpha.gov`, `carol@alpha.gov`]);

        const deliveries = await owner<{ status: string; subscriber_id: string }[]>`
          SELECT status, subscriber_id FROM notification_delivery WHERE event_id = ${eventId}`;
        expect(deliveries).toHaveLength(3);
        expect(deliveries.every((d) => d.status === "sent")).toBe(true);

        const [event] = await owner<{ status: string; processed_at: Date | null }[]>`
          SELECT status, processed_at FROM notification_event WHERE id = ${eventId}`;
        expect(event!.status).toBe("completed");
        expect(event!.processed_at).not.toBeNull();

        const summary = await service.getDeliverySummary(eventId);
        expect(summary).toMatchObject({ total: 3, sent: 3, failed: 0 });
      } finally {
        await app.end();
      }
    });
  });

  // ─── What is actually put on the wire ──────────────────────────────
  //
  // Restored in the D1c review, item 8. The rewrite of this file onto a real
  // database was a genuine improvement — the Supabase mock it replaced could
  // not tell a LEFT JOIN from an INNER JOIN and passed a bug that dropped
  // every account-less board member — but these assertions went missing in
  // the move, and each covers something with no other test:
  //
  //   * `getTownSenderConfig`'s CONFIGURED branch. Only the derived fallback
  //     had coverage, so a town that had set up its own Postmark sender was
  //     the untested case — and it is the one that matters, because mail from
  //     the wrong From: is mail that fails DMARC and silently does not arrive.
  //   * The Postmark `tag` and `metadata`. `routes/webhooks.ts` matches a
  //     bounce back to a delivery through `metadata.delivery_id`; without it
  //     a bounce cannot be attributed and `email_bounced` is never set.
  //     `town_id` is what keeps that lookup inside one town.
  //   * `preferencesUrl` and `recipientName`, which the stubbed template
  //     renderer does not put in the HTML — so they are observed where they
  //     are produced, on the call into the template layer.

  it("sends from the town's CONFIGURED Postmark sender when it has one", async () => {
    await withTestDb(async (owner) => {
      const app = await connectAsAppRole(owner);
      try {
        const town = await seedTown(app, "alpha");
        await app.begin(async (tx) => {
          await tx`SELECT set_config('app.town_id', ${town.townId}, true)`;
          await tx`INSERT INTO town_notification_config
                     (id, town_id, postmark_sender_email, postmark_sender_name)
                   VALUES (gen_random_uuid(), ${town.townId}, 'clerk@alpha.gov',
                           'Alpha Town Clerk')`;
        });

        const service = serviceFor(app, town.townId);
        const eventId = await service.createNotificationEvent("agenda_published", {
          board_id: town.boardId,
          meeting_title: "Regular Meeting",
        });
        await service.processNotificationEvent(eventId);

        expect(sentEmailTo("alice@alpha.gov").from).toBe("Alpha Town Clerk <clerk@alpha.gov>");
      } finally {
        await app.end();
      }
    });
  });

  it("derives a sender from the subdomain when the town has configured none", async () => {
    await withTestDb(async (owner) => {
      const app = await connectAsAppRole(owner);
      try {
        const town = await seedTown(app, "alpha");
        // A row exists but is only HALF filled in — the branch is
        // `sender_email && sender_name`, so a town that typed an address and
        // no display name must still get a working From: rather than
        // "null <clerk@alpha.gov>".
        await app.begin(async (tx) => {
          await tx`SELECT set_config('app.town_id', ${town.townId}, true)`;
          await tx`INSERT INTO town_notification_config (id, town_id, postmark_sender_email)
                   VALUES (gen_random_uuid(), ${town.townId}, 'clerk@alpha.gov')`;
        });

        const service = serviceFor(app, town.townId);
        const eventId = await service.createNotificationEvent("agenda_published", {
          board_id: town.boardId,
          meeting_title: "Regular Meeting",
        });
        await service.processNotificationEvent(eventId);

        expect(sentEmailTo("alice@alpha.gov").from).toBe(
          "Town of alpha <notifications@alpha.townmeetingmanager.com>",
        );
      } finally {
        await app.end();
      }
    });
  });

  it("tags each message and carries the ids a bounce is matched back through", async () => {
    await withTestDb(async (owner) => {
      const app = await connectAsAppRole(owner);
      try {
        const town = await seedTown(app, "alpha");
        const service = serviceFor(app, town.townId);
        const eventId = await service.createNotificationEvent("agenda_published", {
          board_id: town.boardId,
          meeting_title: "Regular Meeting",
        });
        await service.processNotificationEvent(eventId);

        const sent = sentEmailTo("alice@alpha.gov");
        expect(sent.tag).toBe("agenda_published");
        expect(sent.messageStream).toBe("outbound");

        // The delivery id in the metadata must be the row that was actually
        // written for this recipient — asserted against the database rather
        // than against itself, because a metadata block full of ids that
        // match nothing is exactly as useless as no metadata.
        const [delivery] = await owner<{ id: string; subscriber_id: string }[]>`
          SELECT d.id, d.subscriber_id
            FROM notification_delivery d
            JOIN person p ON p.id = d.subscriber_id
           WHERE d.event_id = ${eventId} AND p.email = 'alice@alpha.gov'`;
        expect(sent.metadata).toEqual({
          town_id: town.townId,
          event_id: eventId,
          delivery_id: String(delivery!.id),
        });
      } finally {
        await app.end();
      }
    });
  });

  it("renders each recipient's own name and a link to their preferences", async () => {
    await withTestDb(async (owner) => {
      const app = await connectAsAppRole(owner);
      try {
        const town = await seedTown(app, "alpha");
        const service = serviceFor(app, town.townId);
        const eventId = await service.createNotificationEvent("agenda_published", {
          board_id: town.boardId,
          meeting_title: "Regular Meeting",
        });
        await service.processNotificationEvent(eventId);

        // One render per recipient, each with THAT person's name — not the
        // first subscriber's, which is what a hoisted variable would produce.
        const rendered = mockRenderEmailTemplate.mock.calls.map(
          (c) => (c[1] as { recipientName: string }).recipientName,
        );
        expect(rendered.sort()).toEqual(["Carol Directory", "Member 0", "Member 1"]);

        const variables = templateVariablesFor("Carol Directory");
        expect(variables.preferencesUrl).toBe(
          `${process.env.APP_URL ?? "https://app.townmeetingmanager.com"}/settings/notifications`,
        );
        // The payload is passed through alongside the derived variables, so a
        // template can reference either.
        expect(variables.meeting_title).toBe("Regular Meeting");
        expect(variables.isBroadcast).toBe(false);
        expect(mockRenderEmailTemplate.mock.calls[0]![0]).toBe("agenda-published");

        // NOTE on the half of this assertion that was NOT restored: the
        // service writes `subscriber.display_name ?? subscriber.email`, and
        // the old mock-based test covered the email fallback by returning a
        // null display name. It cannot happen here and it cannot happen in
        // production: `display_name` is `person.name`, which is NOT NULL in
        // the schema (0000_baseline.sql), so the fallback is unreachable.
        // Asserting it would require a mock that lies about the database,
        // which is the thing this file's rewrite existed to stop doing.
      } finally {
        await app.end();
      }
    });
  });

  it("skips a subscriber who has disabled this event type", async () => {
    await withTestDb(async (owner) => {
      const app = await connectAsAppRole(owner);
      try {
        const town = await seedTown(app, "alpha");
        const optedOut = town.members[0]!;

        await app.begin(async (tx) => {
          await tx`SELECT set_config('app.town_id', ${town.townId}, true)`;
          await tx`INSERT INTO subscriber_notification_preference
                          (id, person_id, town_id, channel, event_type, enabled)
                   VALUES (${randomUUID()}, ${optedOut.personId}, ${town.townId},
                           'email', 'agenda_published', false)`;
        });

        const service = serviceFor(app, town.townId);
        const eventId = await service.createNotificationEvent("agenda_published", {
          board_id: town.boardId,
        });
        await service.processNotificationEvent(eventId);

        expect(sentTo()).toEqual([`bob@alpha.gov`, `carol@alpha.gov`]);
        // No delivery row either — an opt-out is not a suppressed send, it is
        // an absent one.
        const deliveries = await owner`
          SELECT 1 FROM notification_delivery WHERE event_id = ${eventId}`;
        expect(deliveries).toHaveLength(2);
      } finally {
        await app.end();
      }
    });
  });

  it("skips an address that has bounced or complained", async () => {
    await withTestDb(async (owner) => {
      const app = await connectAsAppRole(owner);
      try {
        const town = await seedTown(app, "alpha");

        await app.begin(async (tx) => {
          await tx`SELECT set_config('app.town_id', ${town.townId}, true)`;
          await tx`UPDATE user_account SET email_bounced = true
                    WHERE id = ${town.members[0]!.accountId}`;
          await tx`UPDATE user_account SET email_complained = true
                    WHERE id = ${town.members[1]!.accountId}`;
        });

        const service = serviceFor(app, town.townId);
        const eventId = await service.createNotificationEvent("agenda_published", {
          board_id: town.boardId,
        });
        await service.processNotificationEvent(eventId);

        // Only the account-less person is left — and she is left, which is the
        // point: no account means nothing that could have bounced.
        expect(sentTo()).toEqual([`carol@alpha.gov`]);
      } finally {
        await app.end();
      }
    });
  });

  it("sends an admin_alert to administrators rather than to a board", async () => {
    await withTestDb(async (owner) => {
      const app = await connectAsAppRole(owner);
      try {
        const town = await seedTown(app, "alpha");
        const service = serviceFor(app, town.townId);

        const eventId = await service.createNotificationEvent("admin_alert", {
          alertMessage: "Something happened",
        });
        await service.processNotificationEvent(eventId);

        expect(sentTo()).toEqual([`dana@alpha.gov`]);
      } finally {
        await app.end();
      }
    });
  });

  it("marks the event failed when there is no template for its type", async () => {
    await withTestDb(async (owner) => {
      const app = await connectAsAppRole(owner);
      try {
        const town = await seedTown(app, "alpha");
        const service = serviceFor(app, town.townId);

        // `straw_poll_created` has no entry in EVENT_TYPE_TO_TEMPLATE.
        const eventId = await service.createNotificationEvent("straw_poll_created" as never, {});
        await service.processNotificationEvent(eventId);

        const [event] = await owner<{ status: string }[]>`
          SELECT status FROM notification_event WHERE id = ${eventId}`;
        expect(event!.status).toBe("failed");
        expect(mockSendEmail).not.toHaveBeenCalled();
      } finally {
        await app.end();
      }
    });
  });

  it("processes an event exactly once, however many times it is asked to", async () => {
    await withTestDb(async (owner) => {
      const app = await connectAsAppRole(owner);
      try {
        const town = await seedTown(app, "alpha");
        const service = serviceFor(app, town.townId);

        const eventId = await service.createNotificationEvent("agenda_published", {
          board_id: town.boardId,
        });
        await service.processNotificationEvent(eventId);
        await service.processNotificationEvent(eventId);
        await service.processNotificationEvent(eventId);

        // Three subscribers, three emails — not nine. The claim is
        // `UPDATE … WHERE status = 'pending' RETURNING`, so the second and
        // third attempts match nothing and return.
        expect(mockSendEmail).toHaveBeenCalledTimes(3);
      } finally {
        await app.end();
      }
    });
  });

  it("dispatches push for the event types that map to one", async () => {
    await withTestDb(async (owner) => {
      const app = await connectAsAppRole(owner);
      try {
        const town = await seedTown(app, "alpha");
        const service = serviceFor(app, town.townId);

        const pushed = await service.createNotificationEvent("agenda_published", {
          board_id: town.boardId,
          meeting_id: "m1",
          meeting_title: "Regular Meeting",
        });
        await service.processNotificationEvent(pushed);
        expect(mockDispatchPushToTown).toHaveBeenCalledTimes(1);
        // First argument is the job — carrying the town, which is how
        // `lib/push.ts` scopes its own queries.
        expect((mockDispatchPushToTown.mock.calls[0]![0] as { townId: string }).townId).toBe(
          town.townId,
        );
        expect(mockDispatchPushToTown.mock.calls[0]![1]).toBe("agenda_published");

        mockDispatchPushToTown.mockClear();
        const notPushed = await service.createNotificationEvent("minutes_review", {
          board_id: town.boardId,
        });
        await service.processNotificationEvent(notPushed);
        expect(mockDispatchPushToTown).not.toHaveBeenCalled();
      } finally {
        await app.end();
      }
    });
  });
});

// ─── Tenancy ──────────────────────────────────────────────────────────

describe("tenancy", () => {
  it("cannot process another town's event", async () => {
    await withTestDb(async (owner) => {
      const app = await connectAsAppRole(owner);
      try {
        const alpha = await seedTown(app, "alpha");
        const beta = await seedTown(app, "beta");

        const eventId = await queuePendingEvent(app, alpha.townId, "agenda_published", {
          board_id: alpha.boardId,
        });

        // A job for Beta is handed Alpha's event id. It is not visible from
        // Beta, so the claim matches nothing and the call returns having done
        // nothing at all — no email, no delivery row, and Alpha's event still
        // pending for its own town to process.
        const betaService = serviceFor(app, beta.townId);
        await betaService.processNotificationEvent(eventId);

        expect(mockSendEmail).not.toHaveBeenCalled();
        expect(await owner`SELECT 1 FROM notification_delivery`).toHaveLength(0);

        const [event] = await owner<{ status: string }[]>`
          SELECT status FROM notification_event WHERE id = ${eventId}`;
        expect(event!.status).toBe("pending");
      } finally {
        await app.end();
      }
    });
  });

  it("sweeps only its own town's pending events", async () => {
    await withTestDb(async (owner) => {
      const app = await connectAsAppRole(owner);
      try {
        const alpha = await seedTown(app, "alpha");
        const beta = await seedTown(app, "beta");

        // Queued the way `services/notification-triggers.ts` queues them: a
        // bare `pending` row, with nothing kicking it. This is the path that
        // exists because `routes/minutes.ts` has no tenant-bound handle yet.
        for (const town of [alpha, beta]) {
          await queuePendingEvent(app, town.townId, "minutes_review", { board_id: town.boardId });
        }

        const processed = await serviceFor(app, alpha.townId).processPendingEvents();
        expect(processed).toBe(1);

        // Alpha's three subscribers, and none of Beta's.
        expect(sentTo()).toEqual([`alice@alpha.gov`, `bob@alpha.gov`, `carol@alpha.gov`]);

        const statuses = await owner<{ town_id: string; status: string }[]>`
          SELECT town_id, status FROM notification_event ORDER BY town_id`;
        const byTown = new Map(statuses.map((s) => [s.town_id, s.status]));
        expect(byTown.get(alpha.townId)).toBe("completed");
        expect(byTown.get(beta.townId)).toBe("pending");
      } finally {
        await app.end();
      }
    });
  });

  it("refuses to exist without a town", () => {
    // The job-level guarantee, restated at the service that consumes it: there
    // is no constructor that produces a NotificationService with no tenant, so
    // there is no code path where one of these silently reads every town.
    expect(() => new NotificationService(tenantJob({} as never, undefined as never))).toThrow(
      /must name its town/i,
    );
  });
});

// ─── Retries ──────────────────────────────────────────────────────────

describe("processRetries", () => {
  it("retries this town's due deliveries and clears the schedule on success", async () => {
    await withTestDb(async (owner) => {
      const app = await connectAsAppRole(owner);
      try {
        const alpha = await seedTown(app, "alpha");
        const beta = await seedTown(app, "beta");
        const service = serviceFor(app, alpha.townId);

        const eventId = await service.createNotificationEvent("agenda_published", {
          board_id: alpha.boardId,
        });
        await service.processNotificationEvent(eventId);
        mockSendEmail.mockClear();

        // One of Alpha's deliveries falls due…
        const [due] = await owner<{ id: string }[]>`
          UPDATE notification_delivery
             SET status = 'failed', retry_count = 1, next_retry_at = now() - interval '1 minute'
           WHERE event_id = ${eventId}
             AND subscriber_id = ${alpha.members[0]!.personId}
          RETURNING id`;

        // …and so does one of Beta's, which must not be touched.
        const betaEvent = randomUUID();
        const betaDelivery = randomUUID();
        await app.begin(async (tx) => {
          await tx`SELECT set_config('app.town_id', ${beta.townId}, true)`;
          await tx`INSERT INTO notification_event (id, town_id, event_type, payload, status)
                   VALUES (${betaEvent}, ${beta.townId}, 'agenda_published',
                           ${JSON.stringify({ board_id: beta.boardId })}::jsonb, 'completed')`;
          await tx`INSERT INTO notification_delivery
                          (id, event_id, town_id, subscriber_id, channel, status, retry_count, next_retry_at)
                   VALUES (${betaDelivery}, ${betaEvent}, ${beta.townId}, ${beta.members[0]!.personId},
                           'email', 'failed', 1, now() - interval '1 minute')`;
        });

        await service.processRetries();

        expect(sentTo()).toEqual([`alice@alpha.gov`]);

        const [retried] = await owner<
          { status: string; retry_count: number; next_retry_at: Date | null }[]
        >`
          SELECT status, retry_count, next_retry_at FROM notification_delivery WHERE id = ${due!.id}`;
        expect(retried!.status).toBe("sent");
        expect(Number(retried!.retry_count)).toBe(2);
        expect(retried!.next_retry_at).toBeNull();

        const [untouched] = await owner<{ status: string; next_retry_at: Date | null }[]>`
          SELECT status, next_retry_at FROM notification_delivery WHERE id = ${betaDelivery}`;
        expect(untouched!.status).toBe("failed");
        expect(untouched!.next_retry_at).not.toBeNull();
      } finally {
        await app.end();
      }
    });
  });

  it("gives up permanently once the attempt budget is spent", async () => {
    await withTestDb(async (owner) => {
      const app = await connectAsAppRole(owner);
      try {
        const town = await seedTown(app, "alpha");
        const service = serviceFor(app, town.townId);

        const eventId = await service.createNotificationEvent("agenda_published", {
          board_id: town.boardId,
        });
        await service.processNotificationEvent(eventId);

        const [due] = await owner<{ id: string }[]>`
          UPDATE notification_delivery
             SET status = 'failed', retry_count = 2, next_retry_at = now() - interval '1 minute'
           WHERE event_id = ${eventId} AND subscriber_id = ${town.members[0]!.personId}
          RETURNING id`;
        await owner`
          UPDATE notification_delivery SET next_retry_at = NULL
           WHERE event_id = ${eventId} AND id <> ${due!.id}`;

        mockSendEmail.mockClear();
        mockSendEmail.mockRejectedValueOnce(new Error("Postmark is down"));
        await service.processRetries();

        const [dead] = await owner<
          {
            status: string;
            retry_count: number;
            next_retry_at: Date | null;
            error_message: string | null;
          }[]
        >`
          SELECT status, retry_count, next_retry_at, error_message
            FROM notification_delivery WHERE id = ${due!.id}`;
        expect(dead!.status).toBe("failed");
        expect(Number(dead!.retry_count)).toBe(3);
        // Nothing left to pick it up again.
        expect(dead!.next_retry_at).toBeNull();
        expect(dead!.error_message).toContain("Postmark is down");
      } finally {
        await app.end();
      }
    });
  });
});
