/**
 * Stage 1, Task D1f — the six routes that resolved a BOARD-SCOPED permission
 * with no board, and now do not.
 *
 * ─── The defect ───────────────────────────────────────────────────────────
 *
 * `plugins/auth.ts`'s `requirePermission(action)` is a Fastify preHandler. A
 * preHandler runs before any body parsing this API does and has no meeting to
 * resolve a board from, so it called `resolvePermission(actor, code)` with the
 * board argument omitted. Four of the five codes those routes guard — A6, R1,
 * R2, R3 — are granted PER BOARD by `TEMPLATE_BOARD_SPECIFIC_STAFF` and
 * `TEMPLATE_RECORDING_SECRETARY` and globally by neither, so the omission was
 * wrong in both directions:
 *
 *   an override that GRANTS   was ignored → a board-designated clerk was
 *                               refused everywhere, and those two templates
 *                               grant nothing else, so such an account could
 *                               do nothing at all;
 *   an override that REVOKES  was ignored → a clerk a town had explicitly
 *                               barred from a board could still generate that
 *                               board's agenda packets and meeting notices and
 *                               edit, re-render and submit its draft minutes.
 *
 * The second is a live authorization bypass, confirmed in the D1 review wave.
 * Neither direction was pinned by anything: `plugins/__tests__/permission-guards.test.ts`
 * exercises only GLOBAL grants, so every assertion in it passes with the board
 * dropped.
 *
 * ─── What this file proves ────────────────────────────────────────────────
 *
 * All six routes, both directions, on a real Fastify instance with a real
 * Better Auth session and a real database. Two boards in one town, a meeting
 * on each, one staff account, and a `board_overrides` entry that names ONE of
 * them — so every assertion is a comparison between two boards for the SAME
 * caller in the SAME request cycle. A guard that ignores the board cannot tell
 * them apart, and every REVOKE case below turns from 403 into a success.
 *
 * The matrix is written to `user_account.permissions` and read back by
 * `loadActor`, so the stored JSONB is the input — never a hand-built object.
 *
 * ─── Why Puppeteer is mocked and nothing else is ──────────────────────────
 *
 * Four of the six routes render a PDF once authorization passes. What is under
 * test is the DECISION, which happens before any rendering; launching Chromium
 * would add minutes and a platform dependency to a test about a permission
 * lookup. `generatePdf` is therefore stubbed and everything else — the session,
 * the tenant transaction, RLS, `loadActor`, `rules.ts`, the routes themselves —
 * is real. The meeting-notice route does not use Puppeteer at all (pdf-lib),
 * and is left to run for real.
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
import { documentRoutes } from "../documents.js";
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
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "tmm-boardscope-"));
  saved = { doc: process.env.DOCUMENT_ROOT, accel: process.env.X_ACCEL_ENABLED };
  process.env.DOCUMENT_ROOT = path.join(tempRoot, "documents");
  // The development delivery path: these assertions are about status codes,
  // and `X-Accel-Redirect` would answer 200 with no body either way.
  delete process.env.X_ACCEL_ENABLED;
});

afterAll(async () => {
  if (saved.doc === undefined) delete process.env.DOCUMENT_ROOT;
  else process.env.DOCUMENT_ROOT = saved.doc;
  if (saved.accel !== undefined) process.env.X_ACCEL_ENABLED = saved.accel;
  await fs.rm(tempRoot, { recursive: true, force: true });
});

// ─── Harness ──────────────────────────────────────────────────────────

interface TwoBoards {
  /** POST `path`, signed in; returns the status code. */
  post: (path: string, body?: unknown) => Promise<number>;
  /** GET `path`, signed in; returns the status code. */
  get: (path: string) => Promise<number>;
  /** The board whose override the test names. */
  namedBoardMeetingId: string;
  /** A second board in the same town, named by no override. */
  otherBoardMeetingId: string;
  seed: (fn: (tx: TenantTx) => Promise<unknown>) => Promise<unknown>;
  townId: string;
  namedBoardId: string;
}

interface Matrix {
  global: Record<string, boolean>;
  /** Applied to `namedBoardId`. */
  override: Record<string, boolean>;
}

/**
 * One town, two boards, one adjourned meeting on each, and a staff account
 * whose matrix is `spec` with the override attached to the FIRST board.
 */
async function withTwoBoards(spec: Matrix, fn: (ctx: TwoBoards) => Promise<void>): Promise<void> {
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
      // `authPlugin` supplies `verifyAuth`, which `/minutes/approve` still
      // uses. Registered exactly as `server.ts` registers all four.
      await server.register(authPlugin);
      await server.register(documentRoutes, { prefix: "/api" });
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

        const namedBoardId = randomUUID();
        const otherBoardId = randomUUID();
        const namedBoardMeetingId = randomUUID();
        const otherBoardMeetingId = randomUUID();

        await seed(async (tx) => {
          for (const [id, name, type] of [
            [namedBoardId, "Planning Board", "planning_board"],
            [otherBoardId, "Zoning Board", "zoning_board"],
          ] as const) {
            await tx.execute(sql`
              INSERT INTO board (id, town_id, name, board_type, member_count)
              VALUES (${id}, ${onboarded.townId}, ${name}, ${type}::board_type, 5)
            `);
          }
          for (const [meetingId, boardId] of [
            [namedBoardMeetingId, namedBoardId],
            [otherBoardMeetingId, otherBoardId],
          ] as const) {
            await tx.execute(sql`
              INSERT INTO meeting (id, board_id, town_id, title, scheduled_date, status)
              VALUES (${meetingId}, ${boardId}, ${onboarded.townId}, 'Regular',
                      CURRENT_DATE, 'adjourned')
            `);
          }

          const permissions = JSON.stringify({
            global: spec.global,
            board_overrides: [{ board_id: namedBoardId, permissions: spec.override }],
          });
          await tx.execute(sql`
            UPDATE user_account
               SET role = 'staff', permissions = ${permissions}::jsonb
             WHERE id = ${onboarded.userAccountId}
          `);
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
          post: async (url, body) =>
            (
              await server.inject({
                method: "POST",
                url,
                headers: { cookie },
                ...(body === undefined ? {} : { payload: body as object }),
              })
            ).statusCode,
          get: async (url) =>
            (await server.inject({ method: "GET", url, headers: { cookie } })).statusCode,
          namedBoardMeetingId,
          otherBoardMeetingId,
          seed: seed as TwoBoards["seed"],
          townId: onboarded.townId,
          namedBoardId,
        });
      } finally {
        await server.close();
      }
    } finally {
      await client.end();
    }
  });
}

/** A draft minutes document, which `/render` and `/submit` need to exist. */
async function seedDraftMinutes(ctx: TwoBoards, meetingId: string): Promise<void> {
  await ctx.seed(async (tx) => {
    const [meeting] = (await tx.execute(
      sql`SELECT board_id FROM meeting WHERE id = ${meetingId}`,
    )) as unknown as Array<{ board_id: string }>;
    await tx.execute(sql`
      INSERT INTO minutes_document (id, meeting_id, board_id, town_id, status,
                                    content_json, minutes_style)
      VALUES (${randomUUID()}, ${meetingId}, ${meeting!.board_id}, ${ctx.townId}, 'draft',
              ${JSON.stringify(MINIMAL_CONTENT)}::jsonb, 'action')
    `);
  });
}

/**
 * Enough of a `MinutesContentJson` for `formatMinutes` to render.
 *
 * The shape, not the substance: what these tests assert is the status code the
 * authorization produced, and a render that threw would be a 500 rather than
 * the 200 the ALLOW cases expect — which would make an ALLOW indistinguishable
 * from a refusal for the wrong reason.
 */
const MINIMAL_CONTENT = {
  meeting_header: {
    town_name: "Newcastle",
    board_name: "Planning Board",
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

// The four board-scoped codes, and what a caller holding one may do.
const A6 = "A6";
const R1 = "R1";
const R2 = "R2";
const R3 = "R3";

describe("a board_override that REVOKES is now honoured — the live bypass", () => {
  // Global grant, revoked on the named board. Before D1f every one of these
  // answered as if the override did not exist. Each assertion fails — turning
  // 403 into a 2xx — if the board argument is dropped from the rule call in
  // the route.
  const revoking: Matrix = {
    global: { [A6]: true, [R1]: true, [R2]: true, [R3]: true },
    override: { [A6]: false, [R1]: false, [R2]: false, [R3]: false },
  };

  it("refuses agenda-packet generation for the barred board, and allows it elsewhere", async () => {
    await withTwoBoards(revoking, async (ctx) => {
      expect(await ctx.post(`/api/meetings/${ctx.namedBoardMeetingId}/agenda-packet`)).toBe(403);
      expect(await ctx.post(`/api/meetings/${ctx.otherBoardMeetingId}/agenda-packet`)).toBe(200);
    });
  });

  it("refuses meeting-notice generation for the barred board, and allows it elsewhere", async () => {
    await withTwoBoards(revoking, async (ctx) => {
      expect(await ctx.post(`/api/meetings/${ctx.namedBoardMeetingId}/meeting-notice`)).toBe(403);
      expect(await ctx.post(`/api/meetings/${ctx.otherBoardMeetingId}/meeting-notice`)).toBe(200);
    });
  });

  it("refuses minutes generation for the barred board, and allows it elsewhere", async () => {
    await withTwoBoards(revoking, async (ctx) => {
      expect(await ctx.post(`/api/meetings/${ctx.namedBoardMeetingId}/minutes/generate`)).toBe(403);
      expect(await ctx.post(`/api/meetings/${ctx.otherBoardMeetingId}/minutes/generate`)).toBe(200);
    });
  });

  it("refuses minutes regeneration for the barred board, and allows it elsewhere", async () => {
    await withTwoBoards(revoking, async (ctx) => {
      await seedDraftMinutes(ctx, ctx.namedBoardMeetingId);
      await seedDraftMinutes(ctx, ctx.otherBoardMeetingId);
      expect(await ctx.post(`/api/meetings/${ctx.namedBoardMeetingId}/minutes/regenerate`)).toBe(
        403,
      );
      expect(await ctx.post(`/api/meetings/${ctx.otherBoardMeetingId}/minutes/regenerate`)).toBe(
        200,
      );
    });
  });

  it("refuses draft-minutes re-render for the barred board, and allows it elsewhere", async () => {
    await withTwoBoards(revoking, async (ctx) => {
      await seedDraftMinutes(ctx, ctx.namedBoardMeetingId);
      await seedDraftMinutes(ctx, ctx.otherBoardMeetingId);
      expect(await ctx.post(`/api/meetings/${ctx.namedBoardMeetingId}/minutes/render`)).toBe(403);
      expect(await ctx.post(`/api/meetings/${ctx.otherBoardMeetingId}/minutes/render`)).toBe(200);
    });
  });

  it("refuses minutes submission for the barred board, and allows it elsewhere", async () => {
    await withTwoBoards(revoking, async (ctx) => {
      await seedDraftMinutes(ctx, ctx.namedBoardMeetingId);
      await seedDraftMinutes(ctx, ctx.otherBoardMeetingId);
      expect(await ctx.post(`/api/meetings/${ctx.namedBoardMeetingId}/minutes/submit`)).toBe(403);
      expect(await ctx.post(`/api/meetings/${ctx.otherBoardMeetingId}/minutes/submit`)).toBe(200);
    });
  });
});

describe("a board_override that GRANTS is now honoured — the board-designated clerk", () => {
  // Global all-false with a per-board grant is EXACTLY the shape both shipped
  // `designated_boards` templates produce. Before D1f an account created from
  // one of them held nothing anywhere: every assertion below was a 403.
  const granting: Matrix = {
    global: { [A6]: false, [R1]: false, [R2]: false, [R3]: false },
    override: { [A6]: true, [R1]: true, [R2]: true, [R3]: true },
  };

  it("allows agenda-packet generation on the designated board only", async () => {
    await withTwoBoards(granting, async (ctx) => {
      expect(await ctx.post(`/api/meetings/${ctx.namedBoardMeetingId}/agenda-packet`)).toBe(200);
      expect(await ctx.post(`/api/meetings/${ctx.otherBoardMeetingId}/agenda-packet`)).toBe(403);
    });
  });

  it("allows meeting-notice generation on the designated board only", async () => {
    await withTwoBoards(granting, async (ctx) => {
      expect(await ctx.post(`/api/meetings/${ctx.namedBoardMeetingId}/meeting-notice`)).toBe(200);
      expect(await ctx.post(`/api/meetings/${ctx.otherBoardMeetingId}/meeting-notice`)).toBe(403);
    });
  });

  it("allows minutes generation on the designated board only", async () => {
    await withTwoBoards(granting, async (ctx) => {
      expect(await ctx.post(`/api/meetings/${ctx.namedBoardMeetingId}/minutes/generate`)).toBe(200);
      expect(await ctx.post(`/api/meetings/${ctx.otherBoardMeetingId}/minutes/generate`)).toBe(403);
    });
  });

  it("allows minutes regeneration on the designated board only", async () => {
    await withTwoBoards(granting, async (ctx) => {
      await seedDraftMinutes(ctx, ctx.namedBoardMeetingId);
      await seedDraftMinutes(ctx, ctx.otherBoardMeetingId);
      expect(await ctx.post(`/api/meetings/${ctx.namedBoardMeetingId}/minutes/regenerate`)).toBe(
        200,
      );
      expect(await ctx.post(`/api/meetings/${ctx.otherBoardMeetingId}/minutes/regenerate`)).toBe(
        403,
      );
    });
  });

  it("allows draft-minutes re-render on the designated board only", async () => {
    await withTwoBoards(granting, async (ctx) => {
      await seedDraftMinutes(ctx, ctx.namedBoardMeetingId);
      await seedDraftMinutes(ctx, ctx.otherBoardMeetingId);
      expect(await ctx.post(`/api/meetings/${ctx.namedBoardMeetingId}/minutes/render`)).toBe(200);
      expect(await ctx.post(`/api/meetings/${ctx.otherBoardMeetingId}/minutes/render`)).toBe(403);
    });
  });

  it("allows minutes submission on the designated board only", async () => {
    await withTwoBoards(granting, async (ctx) => {
      await seedDraftMinutes(ctx, ctx.namedBoardMeetingId);
      await seedDraftMinutes(ctx, ctx.otherBoardMeetingId);
      expect(await ctx.post(`/api/meetings/${ctx.namedBoardMeetingId}/minutes/submit`)).toBe(200);
      expect(await ctx.post(`/api/meetings/${ctx.otherBoardMeetingId}/minutes/submit`)).toBe(403);
    });
  });
});

describe("rule 9b — reading a generated meeting document", () => {
  // The read side of the same code. `meeting.agenda_packet_url` is NULL until
  // a packet is generated, so an authorized caller gets 404 ("no generated
  // agenda packet yet") and an unauthorized one gets 403 — which is what makes
  // the two distinguishable without rendering anything.
  it("refuses a caller barred from the board, and answers 404 on the board they hold", async () => {
    await withTwoBoards(
      {
        global: { [A6]: false },
        override: { [A6]: true },
      },
      async (ctx) => {
        expect(await ctx.get(`/api/files/agenda-packet/${ctx.namedBoardMeetingId}`)).toBe(404);
        expect(await ctx.get(`/api/files/agenda-packet/${ctx.otherBoardMeetingId}`)).toBe(403);
      },
    );
  });

  it("serves a published agenda's packet to any member of the town, A6 or not", async () => {
    // Rule 9b's second branch. Once the agenda is published the portal serves
    // the same file anonymously, so a narrower rule for signed-in members
    // would be theatre.
    await withTwoBoards({ global: { [A6]: true }, override: { [A6]: true } }, async (ctx) => {
      expect(await ctx.post(`/api/meetings/${ctx.otherBoardMeetingId}/agenda-packet`)).toBe(200);

      await ctx.seed(async (tx) => {
        await tx.execute(sql`
          UPDATE meeting SET agenda_status = 'published' WHERE id = ${ctx.otherBoardMeetingId}
        `);
        await tx.execute(sql`
          UPDATE user_account SET permissions = ${JSON.stringify({
            global: { [A6]: false },
            board_overrides: [],
          })}::jsonb
           WHERE role = 'staff'
        `);
      });

      expect(await ctx.get(`/api/files/agenda-packet/${ctx.otherBoardMeetingId}`)).toBe(200);
    });
  });
});

describe("the tenancy the board scope sits on top of", () => {
  it("answers 404, not 403, for a meeting id from another town", async () => {
    // The board-scoped check cannot run at all without a meeting, and RLS is
    // what decides whether there is one. A 403 here would say "that meeting
    // exists but you may not touch it", which is a membership oracle over
    // every other town's meeting ids.
    await withTwoBoards({ global: { [A6]: true, [R2]: true }, override: {} }, async (ctx) => {
      const foreign = randomUUID();
      expect(await ctx.post(`/api/meetings/${foreign}/agenda-packet`)).toBe(404);
      expect(await ctx.post(`/api/meetings/${foreign}/minutes/generate`)).toBe(404);
      expect(await ctx.get(`/api/files/agenda-packet/${foreign}`)).toBe(404);
    });
  });

  it("answers 404 for an id that is not a UUID rather than a driver 500", async () => {
    await withTwoBoards({ global: { [A6]: true }, override: {} }, async (ctx) => {
      expect(await ctx.post("/api/meetings/not-a-uuid/agenda-packet")).toBe(404);
      expect(await ctx.post("/api/meetings/not-a-uuid/minutes/render")).toBe(404);
    });
  });
});
