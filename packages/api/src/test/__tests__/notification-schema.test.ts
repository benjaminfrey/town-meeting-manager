/**
 * Task 3 (A3) — canonicalize the notification schema.
 *
 * These are schema-level integration tests against a real Postgres
 * database (via the Task A2 harness), not mocked-Supabase unit tests —
 * mocked tests are exactly why the three breakages below went
 * undetected in the first place (see notification-service.test.ts,
 * which mocks board_member.user_account_id and never touches a real
 * foreign key).
 *
 * Each `it` documents one of the three live breakages from
 * .superpowers/sdd/2026-08-26-stage-1-platform/task-3-brief.md:
 *
 *   1. notification-service.ts's notification_delivery insert
 *   2. settings.notifications.tsx / notification-service.ts's
 *      subscriber_notification_preference upsert
 *   3. the subscriber relationship (notification_delivery.subscriber_id,
 *      and board_member.user_account_id feeding it) must resolve to
 *      PERSON, per the owner's decision.
 *
 * Where the *schema itself* was already correct before this migration
 * (subscriber_notification_preference and the person FK on
 * notification_delivery both were — see the migration's header
 * comment for the full three-shape comparison) the "old shape fails"
 * half of each test documents the exact application-code bug via the
 * real schema, and the "new shape succeeds" half proves the target
 * call sites (fixed in this same commit) now have somewhere valid to
 * write.
 */

import { describe, it, expect } from "vitest";
import { withTestDb } from "../db-harness.js";
import type postgres from "postgres";

async function seedTownBoardPerson(sql: postgres.Sql) {
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
  const [event] = await sql<{ id: string }[]>`
    INSERT INTO notification_event (id, town_id, event_type, payload)
    VALUES (gen_random_uuid(), ${town!.id}, 'agenda_published', '{}')
    RETURNING id
  `;
  return { townId: town!.id, boardId: board!.id, personId: person!.id, eventId: event!.id };
}

describe("notification schema canonicalization (Task 3 / A3)", () => {
  describe("breakage 1: notification_delivery insert (notification-service.ts:263-269)", () => {
    it("rejects the insert exactly as notification-service.ts sends it today (town_id omitted)", async () => {
      await withTestDb(async (sql) => {
        const { eventId, personId } = await seedTownBoardPerson(sql);

        // Mirrors the CURRENT (pre-fix) field list in
        // notification-service.ts's processNotificationEvent: no town_id.
        // (Before this migration, retry_count wasn't even a real column
        // on the official-only table — a compound bug that made this
        // insert fail on a *different* error first. This assertion
        // targets the schema's final, canonical shape, where the ported
        // tracking columns exist and town_id is the only thing missing —
        // exactly the bug notification-service.ts:263-269 has.)
        await expect(
          sql`
            INSERT INTO notification_delivery (event_id, subscriber_id, channel, status, retry_count)
            VALUES (${eventId}, ${personId}, 'email', 'pending', 0)
          `,
        ).rejects.toThrow(/null value in column "town_id"/);
      });
    });

    it("accepts the insert once town_id is included and the ported tracking columns exist", async () => {
      await withTestDb(async (sql) => {
        const { townId, eventId, personId } = await seedTownBoardPerson(sql);

        // Mirrors the FIXED field list: town_id present, and retry_count /
        // postmark_message_id / next_retry_at / sent_at / opened_at all
        // resolve to real columns (the "hybrid" shape this migration adds).
        const rows = await sql<{ id: string }[]>`
          INSERT INTO notification_delivery
            (event_id, town_id, subscriber_id, channel, status, retry_count)
          VALUES
            (${eventId}, ${townId}, ${personId}, 'email', 'pending', 0)
          RETURNING id
        `;
        expect(rows).toHaveLength(1);

        // The dispatch-tracking update path (dispatchEmail / retryDelivery)
        // writes postmark_message_id, sent_at, next_retry_at, opened_at.
        await sql`
          UPDATE notification_delivery
          SET postmark_message_id = 'pm-123', sent_at = now(),
              next_retry_at = now(), opened_at = now()
          WHERE id = ${rows[0]!.id}
        `;

        const [row] = await sql<{ postmark_message_id: string }[]>`
          SELECT postmark_message_id FROM notification_delivery WHERE id = ${rows[0]!.id}
        `;
        expect(row!.postmark_message_id).toBe("pm-123");
      });
    });

    it("has all five ported delivery-tracking columns bolted onto the official base table", async () => {
      await withTestDb(async (sql) => {
        const cols = await sql<{ column_name: string }[]>`
          SELECT column_name FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'notification_delivery'
        `;
        const names = new Set(cols.map((c) => c.column_name));

        // Official base — must survive canonicalization untouched.
        for (const col of ["town_id", "external_id", "subscriber_id", "event_id", "status"]) {
          expect(names.has(col)).toBe(true);
        }
        // Ported tracking columns — must be bolted on.
        for (const col of [
          "postmark_message_id",
          "sent_at",
          "opened_at",
          "retry_count",
          "next_retry_at",
        ]) {
          expect(names.has(col)).toBe(true);
        }
      });
    });

    it("accepts the 'completed' and 'complained' status values existing call sites already write", async () => {
      await withTestDb(async (sql) => {
        const { townId, eventId, personId } = await seedTownBoardPerson(sql);

        // notification-service.ts sets notification_event.status = 'completed'.
        await expect(
          sql`UPDATE notification_event SET status = 'completed' WHERE id = ${eventId}`,
        ).resolves.toBeDefined();

        // notifications.ts's SpamComplaint webhook sets
        // notification_delivery.status = 'complained'.
        const rows = await sql<{ id: string }[]>`
          INSERT INTO notification_delivery (event_id, town_id, subscriber_id, channel, status)
          VALUES (${eventId}, ${townId}, ${personId}, 'email', 'pending')
          RETURNING id
        `;
        await expect(
          sql`UPDATE notification_delivery SET status = 'complained' WHERE id = ${rows[0]!.id}`,
        ).resolves.toBeDefined();
      });
    });
  });

  describe("breakage 2: subscriber_notification_preference upsert (settings.notifications.tsx, notification-service.ts:108)", () => {
    it("rejects the upsert exactly as the current (pre-fix) code sends it — subscriber_id / onConflict on subscriber_id,event_type,channel", async () => {
      await withTestDb(async (sql) => {
        const { townId, personId } = await seedTownBoardPerson(sql);

        await expect(
          sql`
            INSERT INTO subscriber_notification_preference
              (subscriber_id, town_id, event_type, channel, enabled)
            VALUES
              (${personId}, ${townId}, 'agenda_published', 'email', false)
            ON CONFLICT (subscriber_id, event_type, channel)
            DO UPDATE SET enabled = EXCLUDED.enabled
          `,
          // subscriber_id doesn't exist as a column at all on this table.
        ).rejects.toThrow(
          /column "subscriber_id" of relation "subscriber_notification_preference" does not exist/,
        );
      });
    });

    it("accepts the upsert on person_id with the real (person_id, channel, event_type) unique constraint", async () => {
      await withTestDb(async (sql) => {
        const { townId, personId } = await seedTownBoardPerson(sql);

        await sql`
          INSERT INTO subscriber_notification_preference
            (person_id, town_id, event_type, channel, enabled)
          VALUES
            (${personId}, ${townId}, 'agenda_published', 'email', true)
          ON CONFLICT (person_id, channel, event_type)
          DO UPDATE SET enabled = EXCLUDED.enabled
        `;

        // Upsert again with a different value — proves the conflict
        // target actually matches a real unique constraint (an upsert
        // against a non-matching target would fail, not silently insert
        // a duplicate row).
        await sql`
          INSERT INTO subscriber_notification_preference
            (person_id, town_id, event_type, channel, enabled)
          VALUES
            (${personId}, ${townId}, 'agenda_published', 'email', false)
          ON CONFLICT (person_id, channel, event_type)
          DO UPDATE SET enabled = EXCLUDED.enabled
        `;

        const rows = await sql<{ enabled: boolean }[]>`
          SELECT enabled FROM subscriber_notification_preference
          WHERE person_id = ${personId} AND event_type = 'agenda_published' AND channel = 'email'
        `;
        expect(rows).toHaveLength(1);
        expect(rows[0]!.enabled).toBe(false);
      });
    });
  });

  describe("breakage 3: subscriber relationship resolves to person (notifications.ts:229, notification-service.ts:45)", () => {
    it("notification_delivery.subscriber_id has a foreign key to person(id), not user_account(id)", async () => {
      await withTestDb(async (sql) => {
        const fks = await sql<{ foreign_table: string }[]>`
          SELECT ccu.table_name AS foreign_table
          FROM information_schema.table_constraints tc
          JOIN information_schema.key_column_usage kcu
            ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
          JOIN information_schema.constraint_column_usage ccu
            ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
          WHERE tc.constraint_type = 'FOREIGN KEY'
            AND tc.table_name = 'notification_delivery'
            AND kcu.column_name = 'subscriber_id'
        `;
        expect(fks).toHaveLength(1);
        expect(fks[0]!.foreign_table).toBe("person");
      });
    });

    it("board_member has no user_account_id column (the pre-fix query in getBoardSubscribers) but does have person_id", async () => {
      await withTestDb(async (sql) => {
        await expect(sql`SELECT user_account_id FROM board_member LIMIT 1`).rejects.toThrow(
          /column "user_account_id" does not exist/,
        );

        await expect(sql`SELECT person_id FROM board_member LIMIT 1`).resolves.toBeDefined();
      });
    });

    it("a board member seat with no user_account is still resolvable to a notifiable person (the case this decision protects)", async () => {
      await withTestDb(async (sql) => {
        const { townId, boardId, personId } = await seedTownBoardPerson(sql);

        // No INSERT into user_account for this person — directory-only /
        // account-less board member, exactly what AddPersonDialog and
        // people.test.tsx cover.
        await sql`
          INSERT INTO board_member (id, person_id, board_id, town_id, term_start, status)
          VALUES (gen_random_uuid(), ${personId}, ${boardId}, ${townId}, CURRENT_DATE, 'active')
        `;

        const rows = await sql<{ id: string; email: string | null }[]>`
          SELECT p.id, p.email
          FROM board_member bm
          JOIN person p ON p.id = bm.person_id
          WHERE bm.board_id = ${boardId} AND bm.status = 'active'
        `;
        expect(rows).toHaveLength(1);
        expect(rows[0]!.email).toBe("alice@testville.gov");
      });
    });
  });
});
