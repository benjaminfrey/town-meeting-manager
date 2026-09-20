/**
 * Backlog 11, defect B — `POST /api/minutes/:documentId/render`.
 *
 * ─── The defect this route closes ──────────────────────────────────────────
 *
 * `VotePanel.tsx` used to post `/api/meetings/${meetingId}/minutes/render` —
 * the LIVE meeting's id — after `voteRecord.recordForMotion` reported minutes
 * approved. The document a vote approves belongs to an EARLIER meeting,
 * reached only through `agenda_item.source_minutes_document_id`, never the
 * live one, so that request 404d into a swallowed `.catch(() => {})` and the
 * DRAFT watermark was never removed from an adopted legal record.
 *
 * The fix (`routes/minutes.ts`) adds a route keyed by the DOCUMENT instead,
 * and derives authorization from the document's OWN meeting's board — not
 * any other meeting's, live or otherwise — using the same R1 guard
 * (`assertCanUpdateMinutesDocument`) the sibling meeting-keyed route already
 * uses, so the two cannot drift on who may re-render.
 *
 * ─── What this file proves ────────────────────────────────────────────────
 *
 * One town, two boards. Board A has an EARLIER, adjourned meeting with an
 * approved minutes document — the scenario `VotePanel` hits. Board B has a
 * SEPARATE, unrelated meeting standing in for "the live meeting" a clerk
 * might be running at the moment the document-keyed request fires; it has no
 * minutes document of its own in the first two tests, exactly as a live
 * meeting usually does not. The route must:
 *
 *   1. re-render board A's document, identified ONLY by its own id — the
 *      existence of a live meeting on a different board changes nothing;
 *   2. derive its authorization from board A specifically, not from a global
 *      grant that would also happen to cover board B — proved by a matrix
 *      that grants R1 on board A via a `board_overrides` entry and nothing
 *      globally, the exact shape `TEMPLATE_BOARD_SPECIFIC_STAFF` produces;
 *   3. refuse a caller who holds no R1 anywhere;
 *   4. answer 404, not 403, both for a document RLS makes invisible (a real
 *      row in a SEPARATE town, `foreignDocumentId` below — fix round 1
 *      correction: this used to be a random uuid, which pins "unknown id",
 *      not cross-tenant isolation) and for a document id that never existed
 *      at all.
 *
 * ─── Why Puppeteer is mocked ────────────────────────────────────────────
 *
 * Same reason as `board-scoped-legacy-routes.test.ts`: what is under test is
 * the DECISION (which document, whose board), not PDF rendering. Everything
 * else — the session, the tenant transaction, RLS, `loadActor`, `rules.ts`,
 * the route itself — is real.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import sensible from "@fastify/sensible";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import type postgres from "postgres";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { withTestDb, connectAsAppRole } from "../../test/db-harness.js";
import { createAuth } from "../../auth/auth.js";
import { betterAuthPlugin } from "../../auth/fastify.js";
import { completeOnboarding } from "../../auth/onboarding.js";
import { authPlugin } from "../../plugins/auth.js";
import { minutesRoutes } from "../minutes.js";
import { fileRoutes } from "../files.js";
import { withTenant, type TenantTx } from "../../db/with-tenant.js";

// A minimal but real PDF, so nothing downstream has to tolerate a fake.
vi.mock("../../services/puppeteer.js", () => ({
  generatePdf: () => Promise.resolve(Buffer.from("%PDF-1.7\n% stub\n%%EOF\n")),
}));

const PASSWORD = "correct-horse-battery-staple";

let tempRoot: string;
let saved: Record<string, string | undefined>;

beforeAll(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "tmm-minutes-by-doc-"));
  saved = { doc: process.env.DOCUMENT_ROOT, accel: process.env.X_ACCEL_ENABLED };
  process.env.DOCUMENT_ROOT = path.join(tempRoot, "documents");
  delete process.env.X_ACCEL_ENABLED;
});

afterAll(async () => {
  if (saved.doc === undefined) delete process.env.DOCUMENT_ROOT;
  else process.env.DOCUMENT_ROOT = saved.doc;
  if (saved.accel !== undefined) process.env.X_ACCEL_ENABLED = saved.accel;
  await fs.rm(tempRoot, { recursive: true, force: true });
});

// ─── Harness ──────────────────────────────────────────────────────────

interface Matrix {
  global: Record<string, boolean>;
  /** Applied to `boardAId` only. */
  override: Record<string, boolean>;
}

interface Scenario {
  /** POST `path`, signed in; returns the status code and parsed JSON body. */
  post: (path: string) => Promise<{ status: number; body: unknown }>;
  /** Board A's EARLIER meeting — the one the approved document belongs to. */
  documentAId: string;
  /** Board B's document, on the unrelated "live" meeting's own board. */
  documentBId: string;
  boardAId: string;
  boardBId: string;
  /**
   * A minutes document belonging to a SEPARATE town entirely — the caller's
   * session never resolves into that town's tenant context, so RLS makes the
   * row invisible rather than merely forbidden.
   */
  foreignDocumentId: string;
}

/**
 * One town, two boards. Board A has an adjourned meeting with an approved
 * minutes document; board B has a separate meeting standing in for a live
 * one, also with its own approved document (so cross-board refusal can be
 * proved by id, not merely by the second board lacking a document at all).
 * The signed-in staff account's matrix is `spec`, with the override attached
 * to board A.
 */
async function withDocumentOnTwoBoards(
  spec: Matrix,
  fn: (ctx: Scenario) => Promise<void>,
): Promise<void> {
  await withTestDb(async (owner) => {
    const client: postgres.Sql = await connectAsAppRole(owner);
    try {
      const db = drizzle(client);
      const auth = createAuth({
        db,
        secret: "0123456789abcdef0123456789abcdef",
        baseURL: "http://localhost:5173",
        sendAuthEmail: async () => {},
      });

      const server: FastifyInstance = Fastify({ logger: false });
      await server.register(sensible);
      await server.register(betterAuthPlugin, {
        auth,
        db,
        allowedOrigins: ["http://localhost:5173"],
      });
      await server.register(authPlugin);
      await server.register(minutesRoutes, { prefix: "/api" });
      await server.register(fileRoutes, { prefix: "/api" });

      try {
        const email = "clerk@example.gov";
        await auth.api.signUpEmail({ body: { email, password: PASSWORD, name: "Clerk" } });
        const [row] = await client<{ id: string }[]>`
          SELECT id FROM better_auth."user" WHERE email = ${email}`;
        await client`UPDATE better_auth."user" SET "emailVerified" = true WHERE id = ${row!.id}`;

        const onboarded = await completeOnboarding(db, {
          authUserId: row!.id,
          townName: "Newcastle",
        });

        const seed = <T>(inner: (tx: TenantTx) => Promise<T>) =>
          withTenant(db, { townId: onboarded.townId }, inner);

        const boardAId = randomUUID();
        const boardBId = randomUUID();
        const meetingAId = randomUUID(); // the EARLIER meeting whose minutes were approved
        const meetingBId = randomUUID(); // stands in for the LIVE meeting, a different board
        const documentAId = randomUUID();
        const documentBId = randomUUID();

        await seed(async (tx) => {
          for (const [id, name, type] of [
            [boardAId, "Historic District Commission", "other"],
            [boardBId, "Zoning Board", "zoning_board"],
          ] as const) {
            await tx.execute(sql`
              INSERT INTO board (id, town_id, name, board_type, member_count)
              VALUES (${id}, ${onboarded.townId}, ${name}, ${type}::board_type, 5)
            `);
          }
          for (const [meetingId, boardId] of [
            [meetingAId, boardAId],
            [meetingBId, boardBId],
          ] as const) {
            await tx.execute(sql`
              INSERT INTO meeting (id, board_id, town_id, title, scheduled_date, status)
              VALUES (${meetingId}, ${boardId}, ${onboarded.townId}, 'Regular',
                      CURRENT_DATE, 'adjourned')
            `);
          }
          for (const [documentId, meetingId, boardId] of [
            [documentAId, meetingAId, boardAId],
            [documentBId, meetingBId, boardBId],
          ] as const) {
            await tx.execute(sql`
              INSERT INTO minutes_document (id, meeting_id, board_id, town_id, status,
                                            content_json, minutes_style)
              VALUES (${documentId}, ${meetingId}, ${boardId}, ${onboarded.townId}, 'approved',
                      ${JSON.stringify(MINIMAL_CONTENT)}::jsonb, 'action')
            `);
          }

          const permissions = JSON.stringify({
            global: spec.global,
            board_overrides: [{ board_id: boardAId, permissions: spec.override }],
          });
          await tx.execute(sql`
            UPDATE user_account
               SET role = 'staff', permissions = ${permissions}::jsonb
             WHERE id = ${onboarded.userAccountId}
          `);
        });

        // A genuinely SEPARATE town — not a board this caller merely lacks a
        // grant on, but a tenant their session never resolves into at all.
        // Seeded on the raw `tmm_app` connection with `app.town_id` set to
        // the foreign town, exactly as `db/__tests__/tenant-isolation.test.ts`
        // seeds cross-tenant fixtures: RLS enforces the boundary, not this
        // test, so the insert itself only succeeds because the session's
        // `app.town_id` matches the row being written.
        const foreignTownId = randomUUID();
        const foreignBoardId = randomUUID();
        const foreignMeetingId = randomUUID();
        const foreignDocumentId = randomUUID();
        await client.begin(async (tx) => {
          await tx`SELECT set_config('app.town_id', ${foreignTownId}, true)`;
          await tx`INSERT INTO town (id, name, subdomain)
                    VALUES (${foreignTownId}, 'Elsewhere', 'elsewhere')`;
          await tx`INSERT INTO board (id, town_id, name)
                    VALUES (${foreignBoardId}, ${foreignTownId}, 'Select Board')`;
          await tx`INSERT INTO meeting (id, board_id, town_id, title, scheduled_date)
                    VALUES (${foreignMeetingId}, ${foreignBoardId}, ${foreignTownId},
                            'Regular Meeting', DATE '2026-03-01')`;
          await tx`INSERT INTO minutes_document (id, meeting_id, town_id, board_id)
                    VALUES (${foreignDocumentId}, ${foreignMeetingId}, ${foreignTownId},
                            ${foreignBoardId})`;
        });

        const signIn = await auth.api.signInEmail({
          body: { email, password: PASSWORD },
          asResponse: true,
        });
        const cookie = signIn.headers
          .getSetCookie()
          .map((c) => c.split(";")[0])
          .join("; ");

        await fn({
          post: async (url) => {
            const res = await server.inject({ method: "POST", url, headers: { cookie } });
            return { status: res.statusCode, body: res.json() };
          },
          documentAId,
          documentBId,
          boardAId,
          boardBId,
          foreignDocumentId,
        });
      } finally {
        await server.close();
      }
    } finally {
      await client.end();
    }
  });
}

/** Enough of a `MinutesContentJson` for `formatMinutes` to render. */
const MINIMAL_CONTENT = {
  meeting_header: {
    town_name: "Newcastle",
    board_name: "Select Board",
    meeting_type: "regular",
    meeting_date: "2026-01-01",
    location: "Town Hall",
    called_to_order_at: null,
    adjourned_at: null,
  },
  attendance: {
    members_present: [],
    members_absent: [],
    presiding_officer: null,
    recording_secretary: null,
    staff_present: [],
    quorum: { required: 3, present: 0, met: false },
  },
  sections: [],
  executive_sessions: [],
  adjournment: null,
  certification: { format: "prepared_by", recording_secretary: null, prepared_date: "2026-01-01" },
};

const R1 = "R1";

describe("POST /api/minutes/:documentId/render (backlog 11, defect B)", () => {
  it("re-renders board A's earlier document while an unrelated board-B meeting exists, with global R1", async () => {
    await withDocumentOnTwoBoards({ global: { [R1]: true }, override: {} }, async (ctx) => {
      const { status, body } = await ctx.post(`/api/minutes/${ctx.documentAId}/render`);
      expect(status).toBe(200);
      expect(body).toMatchObject({ id: ctx.documentAId, rendered: true });
    });
  });

  it("derives authorization from the DOCUMENT's own board, not a grant that happens to cover another board", async () => {
    // R1 granted ONLY on board A, via a board_override — the exact shape
    // `TEMPLATE_BOARD_SPECIFIC_STAFF` produces, and the shape the historical
    // `board-scoped-legacy-routes.test.ts` defect was about for the
    // meeting-keyed sibling route. Nothing here is granted globally, and
    // nothing is granted on board B at all.
    const boardADesignated: Matrix = {
      global: { [R1]: false },
      override: { [R1]: true },
    };
    await withDocumentOnTwoBoards(boardADesignated, async (ctx) => {
      const a = await ctx.post(`/api/minutes/${ctx.documentAId}/render`);
      expect(a.status).toBe(200);

      // The SAME caller, same request cycle, against board B's document:
      // refused, because the override names board A and nothing grants B.
      // This is what proves the guard reads the DOCUMENT's board rather than
      // any board already authorized elsewhere in the request.
      const b = await ctx.post(`/api/minutes/${ctx.documentBId}/render`);
      expect(b.status).toBe(403);
    });
  });

  it("refuses a caller who holds R1 nowhere", async () => {
    await withDocumentOnTwoBoards({ global: { [R1]: false }, override: {} }, async (ctx) => {
      const { status } = await ctx.post(`/api/minutes/${ctx.documentAId}/render`);
      expect(status).toBe(403);
    });
  });

  it("answers 404, not 403, for a document belonging to another town", async () => {
    // A caller holding R1 everywhere in THEIR town still gets 404, not 403,
    // for a document RLS never lets their tenant transaction see at all —
    // 403 would say "that document exists but you may not touch it", which
    // is a membership oracle over every other town's document ids.
    await withDocumentOnTwoBoards({ global: { [R1]: true }, override: {} }, async (ctx) => {
      const { status } = await ctx.post(`/api/minutes/${ctx.foreignDocumentId}/render`);
      expect(status).toBe(404);
    });
  });

  it("answers 404, not 403, for a document id that does not exist at all", async () => {
    await withDocumentOnTwoBoards({ global: { [R1]: true }, override: {} }, async (ctx) => {
      const nonexistent = randomUUID();
      const { status } = await ctx.post(`/api/minutes/${nonexistent}/render`);
      expect(status).toBe(404);
    });
  });
});
