/**
 * Stage 1, Task D1e — the file routes, end to end.
 *
 * `storage/__tests__/documents.test.ts` proves the rules against a real
 * database. This file proves the WIRING, which is where every historical
 * defect in this repository has actually been: a mount that serves without a
 * session, a check that never runs because it was registered on the wrong
 * hook, a limit that nginx was silently enforcing instead.
 *
 * So these run against a real Fastify instance with the real Better Auth
 * plugin, a real session cookie, and a real database — and they assert on
 * status codes and headers, not on function return values.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
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
import { fileRoutes } from "../files.js";
import { withTenant } from "../../db/with-tenant.js";
import { X_ACCEL_LOCATION } from "../../storage/serve.js";

const PASSWORD = "correct-horse-battery-staple";
const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);
const PDF = Buffer.from("%PDF-1.7\n% minutes\n");

let tempRoot: string;
let saved: Record<string, string | undefined>;

beforeAll(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "tmm-files-"));
  saved = {
    pub: process.env.PUBLIC_ASSET_ROOT,
    doc: process.env.DOCUMENT_ROOT,
    accel: process.env.X_ACCEL_ENABLED,
  };
  process.env.PUBLIC_ASSET_ROOT = path.join(tempRoot, "public");
  process.env.DOCUMENT_ROOT = path.join(tempRoot, "documents");
  // Production's delivery path, so the header assertions below test what
  // production actually does rather than the development fallback.
  process.env.X_ACCEL_ENABLED = "true";
});

afterAll(async () => {
  for (const [key, envName] of [
    ["pub", "PUBLIC_ASSET_ROOT"],
    ["doc", "DOCUMENT_ROOT"],
    ["accel", "X_ACCEL_ENABLED"],
  ] as const) {
    if (saved[key] === undefined) delete process.env[envName];
    else process.env[envName] = saved[key]!;
  }
  await fs.rm(tempRoot, { recursive: true, force: true });
});

// ─── Harness ──────────────────────────────────────────────────────────

interface Signed {
  server: FastifyInstance;
  cookie: string;
  townId: string;
  personId: string;
  userAccountId: string;
  client: postgres.Sql;
  /**
   * Seed rows the way the application does — inside a tenant transaction.
   *
   * These tests run on the `tmm_app` role, which RLS actually binds, so a bare
   * `INSERT` on the raw client silently affects zero rows and the test then
   * fails for a reason that has nothing to do with what it is testing. (It
   * did, on the first run of this file.) Everything that touches `public`
   * goes through here.
   */
  seed: <T>(fn: (tx: Parameters<Parameters<typeof withTenant>[2]>[0]) => Promise<T>) => Promise<T>;
}

/**
 * A signed-in administrator of a freshly onboarded town, on the `tmm_app`
 * role — the non-owner connection production uses, so RLS binds.
 */
async function withSignedIn(fn: (ctx: Signed) => Promise<void>): Promise<void> {
  await withTestDb(async (owner) => {
    const client = await connectAsAppRole(owner);
    try {
      const db = drizzle(client);
      const auth = createAuth({
        db,
        secret: "0123456789abcdef0123456789abcdef",
        baseURL: "http://localhost:5173",
        sendAuthEmail: async () => {},
      });

      const server = Fastify({ logger: false });
      await server.register(sensible);
      await server.register(betterAuthPlugin, {
        auth,
        db,
        allowedOrigins: ["http://localhost:5173"],
      });
      // Registered exactly as `server.ts` registers it — no `config`, so the
      // deny-by-default gate applies. If someone adds `PUBLIC_ROUTE` there,
      // the first test in this file fails.
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

        const signIn = await auth.api.signInEmail({
          body: { email, password: PASSWORD },
          asResponse: true,
        });
        const cookie = signIn.headers
          .getSetCookie()
          .map((c) => c.split(";")[0])
          .join("; ");

        const seed = <T>(inner: (tx: never) => Promise<T>) =>
          withTenant(db, { townId: onboarded.townId }, inner as never) as Promise<T>;

        await fn({ server, cookie, client, seed: seed as Signed["seed"], ...onboarded });
      } finally {
        await server.close();
      }
    } finally {
      await client.end();
    }
  });
}

/** Demote the signed-in account to staff holding exactly `codes`. */
async function demoteToStaff(ctx: Signed, codes: string[]) {
  const matrix = JSON.stringify({
    global: Object.fromEntries(codes.map((c) => [c, true])),
    board_overrides: [],
  });
  await ctx.seed(async (tx) => {
    await tx.execute(sql`
      UPDATE user_account SET role = 'staff', permissions = ${matrix}::jsonb
      WHERE id = ${ctx.userAccountId}
    `);
  });
}

/** Insert a meeting + a minutes document with the given status and path. */
async function seedMinutes(
  ctx: Signed,
  status: string,
  storagePath: string | null,
): Promise<{ minutesId: string; meetingId: string }> {
  const meetingId = randomUUID();
  const minutesId = randomUUID();
  await ctx.seed(async (tx) => {
    const boards = (await tx.execute(
      sql`SELECT id FROM board WHERE town_id = ${ctx.townId} LIMIT 1`,
    )) as unknown as Array<{ id: string }>;
    const boardId = boards[0]!.id;
    await tx.execute(sql`
      INSERT INTO meeting (id, board_id, town_id, title, scheduled_date, status)
      VALUES (${meetingId}, ${boardId}, ${ctx.townId}, 'Regular', CURRENT_DATE, 'adjourned')
    `);
    await tx.execute(sql`
      INSERT INTO minutes_document (id, meeting_id, town_id, status, pdf_storage_path)
      VALUES (${minutesId}, ${meetingId}, ${ctx.townId},
              ${status}::minutes_document_status, ${storagePath})
    `);
  });
  return { minutesId, meetingId };
}

/** Build a multipart body by hand — `inject` takes bytes, not a FormData. */
function multipart(
  fields: Record<string, string>,
  file?: { name: string; type: string; bytes: Buffer },
): { payload: Buffer; headers: Record<string, string> } {
  const boundary = "----tmmtestboundary1234567890";
  const parts: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
      ),
    );
  }
  if (file) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; ` +
          `filename="${file.name}"\r\nContent-Type: ${file.type}\r\n\r\n`,
      ),
      file.bytes,
      Buffer.from("\r\n"),
    );
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    payload: Buffer.concat(parts),
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
  };
}

// ═══════════════════════════════════════════════════════════════════════

describe("the file routes are behind the deny-by-default gate", () => {
  it("refuses every one of them without a session", async () => {
    await withSignedIn(async ({ server }) => {
      for (const [method, url] of [
        ["GET", `/api/files/minutes/${randomUUID()}`],
        ["GET", `/api/files/exhibits/${randomUUID()}`],
        ["POST", "/api/files/town-seal"],
        ["DELETE", "/api/files/town-seal"],
        ["POST", "/api/files/exhibits"],
        ["DELETE", `/api/files/exhibits/${randomUUID()}`],
      ] as const) {
        const res = await server.inject({ method, url });
        expect(res.statusCode, `${method} ${url}`).toBe(401);
        // The GATE's message, not a handler's — proving the refusal happened
        // in `onRequest`, before any of this task's code ran.
        expect(res.body).toContain("requires a signed-in session");
      }
    });
  });
});

describe("fetching a minutes PDF over HTTP", () => {
  it("refuses a draft to a caller without R4, with 403 and the rule's own message", async () => {
    await withSignedIn(async (ctx) => {
      const { server, cookie } = ctx;
      const { minutesId } = await seedMinutes(ctx, "draft", "minutes/a/b/c.pdf");
      await demoteToStaff(ctx, ["A2"]);

      const res = await server.inject({
        method: "GET",
        url: `/api/files/minutes/${minutesId}`,
        headers: { cookie },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().message).toContain("R4");
      // And nothing was handed to nginx.
      expect(res.headers["x-accel-redirect"]).toBeUndefined();
    });
  });

  it("hands an authorized fetch to nginx instead of piping the bytes", async () => {
    await withSignedIn(async (ctx) => {
      const { server, cookie, townId } = ctx;
      const relative = `minutes/${townId}/${randomUUID()}/${randomUUID()}.pdf`;
      const { minutesId } = await seedMinutes(ctx, "approved", relative);
      const absolute = path.join(process.env.DOCUMENT_ROOT!, relative);
      await fs.mkdir(path.dirname(absolute), { recursive: true });
      await fs.writeFile(absolute, PDF);

      const res = await server.inject({
        method: "GET",
        url: `/api/files/minutes/${minutesId}`,
        headers: { cookie },
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers["x-accel-redirect"]).toBe(`${X_ACCEL_LOCATION}${relative}`);
      // The response body is empty: nginx supplies the bytes. If this ever
      // carries the PDF, the process is piping documents again.
      expect(res.body).toBe("");
      // A document behind an authorization check must never be cached by a
      // shared cache — the next caller is a different person.
      expect(res.headers["cache-control"]).toContain("no-store");
      expect(res.headers["x-content-type-options"]).toBe("nosniff");
    });
  });

  it("refuses a STORED path that traverses, rather than handing it to nginx", async () => {
    // The value comes out of the database, not off the wire — and is still
    // validated. A row written by an older code path, or by a future one, is
    // no more trustworthy than a header.
    await withSignedIn(async (ctx) => {
      const { server, cookie } = ctx;
      const { minutesId } = await seedMinutes(ctx, "published", "../../../../etc/passwd");

      const res = await server.inject({
        method: "GET",
        url: `/api/files/minutes/${minutesId}`,
        headers: { cookie },
      });

      expect(res.statusCode).toBe(400);
      expect(res.headers["x-accel-redirect"]).toBeUndefined();
    });
  });

  it("answers 404 for a nonexistent id and for a traversal in the URL alike", async () => {
    await withSignedIn(async ({ server, cookie }) => {
      const missing = await server.inject({
        method: "GET",
        url: `/api/files/minutes/${randomUUID()}`,
        headers: { cookie },
      });
      expect(missing.statusCode).toBe(404);

      // A traversal in the path PARAMETER never reaches a filesystem: it is a
      // primary-key lookup, so the worst it can be is a row that is not there.
      const traversal = await server.inject({
        method: "GET",
        url: "/api/files/minutes/..%2f..%2fetc%2fpasswd",
        headers: { cookie },
      });
      expect([400, 404]).toContain(traversal.statusCode);
      expect(traversal.headers["x-accel-redirect"]).toBeUndefined();
    });
  });
});

describe("the town seal over HTTP", () => {
  it("accepts a PNG from an administrator and writes it under seals/", async () => {
    await withSignedIn(async ({ server, cookie, townId }) => {
      const body = multipart({}, { name: "seal.png", type: "image/png", bytes: PNG });
      const res = await server.inject({
        method: "POST",
        url: "/api/files/town-seal",
        headers: { ...body.headers, cookie },
        payload: body.payload,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().sealUrl).toBe(`/public-assets/seals/${townId}.png`);
      await expect(
        fs.stat(path.join(process.env.PUBLIC_ASSET_ROOT!, "seals", `${townId}.png`)),
      ).resolves.toBeTruthy();
    });
  });

  it("refuses a non-image, so only images reach the unguarded directory", async () => {
    await withSignedIn(async ({ server, cookie }) => {
      const before = await countPublicFiles();
      // A PDF wearing an image's name and an image's declared type — the two
      // things a client controls.
      const body = multipart(
        {},
        { name: "seal.png", type: "image/png", bytes: Buffer.from("%PDF-1.7\n") },
      );
      const res = await server.inject({
        method: "POST",
        url: "/api/files/town-seal",
        headers: { ...body.headers, cookie },
        payload: body.payload,
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().message).toMatch(/PNG or a JPEG/);
      expect(await countPublicFiles()).toBe(before);
    });
  });

  it("refuses a staff account, whatever it holds", async () => {
    await withSignedIn(async (ctx) => {
      const { server, cookie } = ctx;
      await demoteToStaff(ctx, ["A1", "A2", "A3", "R1", "R4", "M1", "C2"]);
      const body = multipart({}, { name: "seal.png", type: "image/png", bytes: PNG });
      const res = await server.inject({
        method: "POST",
        url: "/api/files/town-seal",
        headers: { ...body.headers, cookie },
        payload: body.payload,
      });
      expect(res.statusCode).toBe(403);
    });
  });
});

describe("the upload limit is this application's, not nginx's", () => {
  it("refuses a 6 MB file with 400 and a message naming the limit", async () => {
    // nginx allows 10M on the app host, deliberately. A request in the gap
    // must be refused here with something a clerk can act on — not by nginx
    // with a bare 413 the SPA cannot explain, and not by silently truncating.
    await withSignedIn(async ({ server, cookie }) => {
      const oversized = Buffer.concat([PNG, Buffer.alloc(6 * 1024 * 1024)]);
      const body = multipart({}, { name: "seal.png", type: "image/png", bytes: oversized });
      const res = await server.inject({
        method: "POST",
        url: "/api/files/town-seal",
        headers: { ...body.headers, cookie },
        payload: body.payload,
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().message).toContain("5 MB");
    });
  });
});

describe("exhibits over HTTP", () => {
  it("uploads, then serves the file back through the authorized route", async () => {
    await withSignedIn(async (ctx) => {
      const { server, cookie, townId } = ctx;
      const { meetingId } = await seedMinutes(ctx, "draft", null);
      const itemId = randomUUID();
      await ctx.seed(async (tx) => {
        await tx.execute(sql`
          INSERT INTO agenda_item (id, meeting_id, town_id, section_type, title)
          VALUES (${itemId}, ${meetingId}, ${townId}, 'business', 'Item')
        `);
      });

      const body = multipart(
        { agendaItemId: itemId, title: "Budget", visibility: "public" },
        { name: "budget.pdf", type: "application/pdf", bytes: PDF },
      );
      const created = await server.inject({
        method: "POST",
        url: "/api/files/exhibits",
        headers: { ...body.headers, cookie },
        payload: body.payload,
      });
      expect(created.statusCode).toBe(201);
      const exhibitId = created.json().id as string;

      const fetched = await server.inject({
        method: "GET",
        url: `/api/files/exhibits/${exhibitId}`,
        headers: { cookie },
      });
      expect(fetched.statusCode).toBe(200);
      expect(fetched.headers["x-accel-redirect"]).toBe(
        `${X_ACCEL_LOCATION}exhibits/${townId}/${itemId}/${exhibitId}.pdf`,
      );
      // Never `inline`: an exhibit is client-supplied, and rendering one
      // inline on this application's origin turns an upload into a page.
      expect(fetched.headers["content-disposition"]).toContain("attachment");
    });
  });
});

async function countPublicFiles(): Promise<number> {
  const root = path.join(process.env.PUBLIC_ASSET_ROOT!, "seals");
  try {
    return (await fs.readdir(root)).length;
  } catch {
    return 0;
  }
}
