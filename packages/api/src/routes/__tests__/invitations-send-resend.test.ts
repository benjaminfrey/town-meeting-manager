/**
 * `POST /api/invitations/:id/send` and `/resend` — who may call them.
 *
 * ─── The defect ───────────────────────────────────────────────────────────
 *
 * Both routes took `verifyAuth` and nothing else. Any signed-in user in a
 * town could re-send anyone's invitation, and `resend` REISSUES: it writes a
 * new token and a new expiry before it sends, so a caller with no business
 * inviting anyone could kill the link sitting in an invitee's inbox, as often
 * as they liked, and have the email go out again with themselves recorded as
 * `invited_by`. `boardMember.roster` returns `invitation_id` to every
 * signed-in user, so the ids were not hard to come by.
 *
 * It was not an account takeover — the new token goes only to the invitee's
 * address, and changing that address goes through the guarded
 * `person.update` — which is why it was `docs/backlog.md` entry 14 rather
 * than part of entry 4's fix.
 *
 * ─── The rule ─────────────────────────────────────────────────────────────
 *
 * `assertCanInsertUserAccount`: sending an invitation is the rest of issuing
 * one, and every procedure that issues one (`invitation.insert`,
 * `boardMember.addStaffMember`, `boardMember.addBoardMember`) already requires
 * an administrator. So the follow-up `/send` each of those callers makes can
 * never be refused by this guard for a caller who got that far.
 *
 * The staff case holds EVERY global grant, so the refusal is shown to be the
 * governance rule and not a missing code.
 *
 * ─── What is real ─────────────────────────────────────────────────────────
 *
 * The Fastify instance, the Better Auth session, the tenant transaction, RLS,
 * `loadActor` and `rules.ts`. Only the Postmark client is replaced — the
 * assertions are about who may cause a send, and a refused request must cause
 * none, which a spy can say and a real network call cannot.
 *
 * ─── Tokens are stored as digests (drizzle/0004) ──────────────────────────
 *
 * The last describe block is about that, not about authorization: the token
 * is minted at send time, only its sha256 is stored, and the copy in the
 * email is the only copy. It reads the token out of the email the route
 * actually sent and presents it to the real `validate` route.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import sensible from "@fastify/sensible";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import type postgres from "postgres";
import { randomUUID, createHash } from "node:crypto";
import { withTestDb, connectAsAppRole } from "../../test/db-harness.js";
import { createAuth } from "../../auth/auth.js";
import { betterAuthPlugin } from "../../auth/fastify.js";
import { completeOnboarding } from "../../auth/onboarding.js";
import { authPlugin } from "../../plugins/auth.js";
import { invitationRoutes } from "../invitations.js";
import { withTenant, type TenantTx } from "../../db/with-tenant.js";
import { PERMISSION_CODES } from "../../trpc/authorization/permission.js";

const sendEmail = vi.hoisted(() => vi.fn());

vi.mock("../../lib/postmark.js", () => ({
  getDefaultPostmarkClient: () => ({ sendEmail }),
}));

beforeEach(() => {
  sendEmail.mockReset();
  sendEmail.mockResolvedValue({ MessageID: "test-message-id", ErrorCode: 0 });
});

const PASSWORD = "correct-horse-battery-staple";

type CallerRole = "admin" | "staff" | "board_member";

interface InvitationState {
  /** Hex of `token_sha256`, or null for a never-sent invitation. */
  digest: string | null;
  status: string;
  sent_at: string | null;
  invited_by: string | null;
}

interface Harness {
  /** POST `url` as the signed-in caller; returns the status code. */
  post: (url: string) => Promise<number>;
  /** GET the public validate route with `token`, unauthenticated. */
  validate: (token: string) => Promise<{ status: number; valid?: boolean }>;
  invitationId: string;
  callerAccountId: string;
  /** The plaintext of the seeded token, or null when seeded unsent. */
  seededToken: string | null;
  readInvitation: () => Promise<InvitationState>;
  /** The whole invitation row, as JSON text. */
  rowText: () => Promise<string>;
}

interface Options {
  /**
   * `true` (default): the invitation was already sent, so it has a digest and
   * someone holds the matching link. `false`: freshly created, no token yet.
   */
  sent?: boolean;
}

const sha256Hex = (token: string) => createHash("sha256").update(token, "utf8").digest("hex");

/** The token in the Nth email the route sent, read out of its link. */
function emailedToken(n: number): string {
  // Decoded the way a browser decodes an `href`: Handlebars escapes the `=`
  // in `?token=` as `&#x3D;`.
  const body = (sendEmail.mock.calls[n]![0] as { HtmlBody: string }).HtmlBody.replace(
    /&#x3D;/g,
    "=",
  ).replace(/&amp;/g, "&");
  const match = /\/invite\/accept\?token=([^"&\s<]+)/.exec(body);
  expect(match, "the email carries an acceptance link").not.toBeNull();
  return decodeURIComponent(match![1]!);
}

/**
 * One town, a signed-in caller of `role`, and a pending invitation for a
 * DIFFERENT person — so every case is a caller acting on someone else's
 * invitation, which is the only case the routes exist for.
 */
async function withCaller(
  role: CallerRole,
  fn: (h: Harness) => Promise<void>,
  opts: Options = {},
): Promise<void> {
  const sent = opts.sent ?? true;
  const seededToken = sent ? `tok-${randomUUID()}` : null;
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
      await server.register(invitationRoutes, { prefix: "/api" });

      try {
        const email = "caller@example.gov";
        await auth.api.signUpEmail({ body: { email, password: PASSWORD, name: "Caller" } });
        const [row] = await client<{ id: string }[]>`
          SELECT id FROM better_auth."user" WHERE email = ${email}`;
        await client`UPDATE better_auth."user" SET "emailVerified" = true WHERE id = ${row!.id}`;

        // Onboarding makes the caller the town's administrator; every other
        // role is that account demoted, exactly as the board-scope suite does.
        const onboarded = await completeOnboarding(db, {
          authUserId: row!.id,
          townName: "Newcastle",
        });
        const seed = <T>(inner: (tx: TenantTx) => Promise<T>) =>
          withTenant(db, { townId: onboarded.townId }, inner);

        const inviteePersonId = randomUUID();
        const inviteeAccountId = randomUUID();
        const invitationId = randomUUID();

        await seed(async (tx) => {
          if (role !== "admin") {
            const global = Object.fromEntries(
              (role === "staff" ? PERMISSION_CODES : []).map((code) => [code, true]),
            );
            await tx.execute(sql`
              UPDATE user_account
                 SET role = ${role}::user_role,
                     permissions = ${JSON.stringify({ global, board_overrides: [] })}::jsonb
               WHERE id = ${onboarded.userAccountId}
            `);
          }
          await tx.execute(sql`
            INSERT INTO person (id, town_id, name, email)
            VALUES (${inviteePersonId}, ${onboarded.townId}, 'Pat Invitee', 'pat@example.test')
          `);
          await tx.execute(sql`
            INSERT INTO user_account (id, person_id, town_id, role, permissions)
            VALUES (${inviteeAccountId}, ${inviteePersonId}, ${onboarded.townId},
                    'admin'::user_role, '{"global":{},"board_overrides":[]}'::jsonb)
          `);
          await tx.execute(sql`
            INSERT INTO invitation (id, person_id, user_account_id, town_id, token_sha256,
                                    status, expires_at, role, sent_at)
            VALUES (${invitationId}, ${inviteePersonId}, ${inviteeAccountId}, ${onboarded.townId},
                    ${seededToken === null ? null : sql`sha256(convert_to(${seededToken}, 'UTF8'))`},
                    'pending', now() + interval '7 days', 'admin',
                    ${sent ? sql`now() - interval '1 day'` : null})
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
          post: async (url) =>
            (await server.inject({ method: "POST", url, headers: { cookie } })).statusCode,
          validate: async (token) => {
            const res = await server.inject({
              method: "GET",
              url: `/api/invitations/validate?token=${encodeURIComponent(token)}`,
            });
            const body = res.statusCode === 200 ? (res.json() as { valid?: boolean }) : {};
            return { status: res.statusCode, valid: body.valid };
          },
          invitationId,
          callerAccountId: onboarded.userAccountId,
          seededToken,
          readInvitation: async () => {
            const rows = (await seed((tx) =>
              tx.execute(sql`
                SELECT encode(token_sha256, 'hex') AS digest, status,
                       sent_at::text AS sent_at, invited_by::text AS invited_by
                  FROM invitation WHERE id = ${invitationId}
              `),
            )) as unknown as InvitationState[];
            return rows[0]!;
          },
          rowText: async () => {
            const rows = (await seed((tx) =>
              tx.execute(sql`
                SELECT row_to_json(i)::text AS t FROM invitation i WHERE id = ${invitationId}
              `),
            )) as unknown as { t: string }[];
            return rows[0]!.t;
          },
        });
      } finally {
        await server.close();
      }
    } finally {
      await client.end();
    }
  });
}

describe.each(["board_member", "staff"] as const)(
  "a %s is refused, and nothing changes",
  (role) => {
    it("POST /invitations/:id/send → 403, no email, invitation untouched", async () => {
      await withCaller(role, async (h) => {
        const before = await h.readInvitation();

        expect(await h.post(`/api/invitations/${h.invitationId}/send`)).toBe(403);

        expect(sendEmail).not.toHaveBeenCalled();
        expect(await h.readInvitation()).toEqual(before);
      });
    });

    it("POST /invitations/:id/resend → 403, token NOT rotated, no email", async () => {
      await withCaller(role, async (h) => {
        const before = await h.readInvitation();

        expect(await h.post(`/api/invitations/${h.invitationId}/resend`)).toBe(403);

        expect(sendEmail).not.toHaveBeenCalled();
        // The harm this route could do was the reissue, which ran BEFORE the
        // send — so the token is the assertion, not the email.
        expect(await h.readInvitation()).toEqual(before);
      });
    });
  },
);

describe("an administrator is not blocked by the guard", () => {
  it("POST /invitations/:id/send → 200, one email, recorded as sent by the caller", async () => {
    await withCaller("admin", async (h) => {
      expect(await h.post(`/api/invitations/${h.invitationId}/send`)).toBe(200);

      expect(sendEmail).toHaveBeenCalledTimes(1);
      const after = await h.readInvitation();
      expect(after.sent_at).not.toBeNull();
      expect(after.invited_by).toBe(h.callerAccountId);
    });
  });

  it("POST /invitations/:id/resend → 200, token rotated, one email", async () => {
    await withCaller("admin", async (h) => {
      const before = await h.readInvitation();

      expect(await h.post(`/api/invitations/${h.invitationId}/resend`)).toBe(200);

      expect(sendEmail).toHaveBeenCalledTimes(1);
      expect((await h.readInvitation()).digest).not.toBe(before.digest);
    });
  });
});

describe("tokens are stored as digests, and the email holds the only copy", () => {
  it("a never-sent invitation has no token; /send mints one and stores only its hash", async () => {
    await withCaller(
      "admin",
      async (h) => {
        expect((await h.readInvitation()).digest).toBeNull();

        expect(await h.post(`/api/invitations/${h.invitationId}/send`)).toBe(200);

        const token = emailedToken(0);
        // 256 random bits, base64url — not a UUID from the database.
        expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
        // Stored as its sha256, computed independently here…
        expect((await h.readInvitation()).digest).toBe(sha256Hex(token));
        // …and the token itself is nowhere in the row.
        expect(await h.rowText()).not.toContain(token);
        // The emailed link works end to end through the public route.
        expect(await h.validate(token)).toEqual({ status: 200, valid: true });
      },
      { sent: false },
    );
  });

  it("an existing link keeps working — stored digests are looked up by hashing what is presented", async () => {
    await withCaller("admin", async (h) => {
      expect(await h.validate(h.seededToken!)).toEqual({ status: 200, valid: true });
      // Presenting the digest instead of the token gets nothing: the stored
      // value is not a credential.
      expect((await h.validate((await h.readInvitation()).digest!)).status).toBe(404);
    });
  });

  it("/resend kills the old link and the new one works", async () => {
    await withCaller("admin", async (h) => {
      expect(await h.post(`/api/invitations/${h.invitationId}/resend`)).toBe(200);

      const fresh = emailedToken(0);
      expect(fresh).not.toBe(h.seededToken);
      expect((await h.readInvitation()).digest).toBe(sha256Hex(fresh));
      expect(await h.validate(fresh)).toEqual({ status: 200, valid: true });
      expect((await h.validate(h.seededToken!)).status).toBe(404);
    });
  });
});
