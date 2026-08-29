/**
 * Stage 1, Task D1b — the public portal, proven against a real database.
 *
 * Two properties, and the whole point of this file is that they are DIFFERENT
 * properties and neither one implies the other:
 *
 *   1. **Tenancy.** A portal request for town A cannot obtain a row of town B.
 *      Enforced by row level security, through the tenant context the
 *      subdomain resolves to — so the assertions below ask the routes for
 *      town B's ids while carrying town A's subdomain, rather than inspecting
 *      a query for an `.eq("town_id", …)`. A filter you can read is not a
 *      filter you have tested.
 *
 *   2. **Publication.** Within one town, only what the town has published.
 *      RLS says nothing about this: with tenancy alone, every draft agenda and
 *      every unadopted set of minutes would be served to the public, which is
 *      strictly worse than the service-role client this replaced. The
 *      `portalCanSelect*` predicates are what decide it, and each of the
 *      disclosure cases below fails if its predicate is reverted (that is what
 *      `scripts/mutate-authorization.py` checks; these are the tests it needs
 *      to find).
 *
 * Everything runs as `tmm_app` rather than the database owner. The owner is a
 * superuser and bypasses RLS, so the tenancy half of this file would pass on
 * an owner connection with row level security disabled entirely.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import sensible from "@fastify/sensible";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import type postgres from "postgres";
import { randomUUID } from "node:crypto";
import { withTestDb, connectAsAppRole } from "../../test/db-harness.js";
import { withTenant } from "../../db/with-tenant.js";
import { createAuth } from "../../auth/auth.js";
import { betterAuthPlugin } from "../../auth/fastify.js";
import { portalRoutes } from "../portal.js";

type Db = ReturnType<typeof drizzle>;

// ─── Fixture ─────────────────────────────────────────────────────────────
//
// One town that publishes things and one that does not want them published,
// plus a second town whose rows must never be reachable from the first.

interface TownSeed {
  townId: string;
  subdomain: string;
  boardId: string;
  archivedBoardId: string;
  publishedMeetingId: string;
  draftMeetingId: string;
  cancelledMeetingId: string;
  publishedMinutesMeetingId: string;
  draftMinutesMeetingId: string;
  publicExhibitId: string;
  boardOnlyExhibitId: string;
  adminOnlyExhibitId: string;
  activeMemberName: string;
  archivedMemberName: string;
}

async function seed(db: Db, label: string, subdomain: string): Promise<TownSeed> {
  const s: TownSeed = {
    townId: randomUUID(),
    subdomain,
    boardId: randomUUID(),
    archivedBoardId: randomUUID(),
    publishedMeetingId: randomUUID(),
    draftMeetingId: randomUUID(),
    cancelledMeetingId: randomUUID(),
    publishedMinutesMeetingId: randomUUID(),
    draftMinutesMeetingId: randomUUID(),
    publicExhibitId: randomUUID(),
    boardOnlyExhibitId: randomUUID(),
    adminOnlyExhibitId: randomUUID(),
    activeMemberName: `${label} Active Member`,
    archivedMemberName: `${label} Former Member`,
  };

  await withTenant(db, { townId: s.townId }, async (tx) => {
    await tx.execute(sql`
      INSERT INTO town (id, name, subdomain) VALUES (${s.townId}, ${label}, ${subdomain})
    `);
    await tx.execute(sql`
      INSERT INTO board (id, town_id, name, board_type) VALUES
        (${s.boardId}, ${s.townId}, ${`${label} Select Board`}, 'select_board'),
        (${s.archivedBoardId}, ${s.townId}, ${`${label} Disbanded Committee`}, 'other')
    `);
    await tx.execute(sql`
      UPDATE board SET archived_at = now() WHERE id = ${s.archivedBoardId}
    `);

    const meeting = (
      id: string,
      title: string,
      status: string,
      agendaStatus: string | null,
      date: string,
    ) => sql`
      INSERT INTO meeting (id, town_id, board_id, title, meeting_type, status,
                           agenda_status, scheduled_date, scheduled_time, location)
      VALUES (${id}, ${s.townId}, ${s.boardId}, ${title}, 'regular', ${status}::meeting_status,
              ${agendaStatus}, ${date}::date, '19:00', 'Town Hall')
    `;

    await tx.execute(
      meeting(
        s.publishedMeetingId,
        `${label} Public Meeting`,
        "noticed",
        "published",
        "2030-01-15",
      ),
    );
    await tx.execute(
      meeting(
        s.draftMeetingId,
        `${label} SECRET Draft Meeting`,
        "draft",
        "published",
        "2030-02-15",
      ),
    );
    await tx.execute(
      meeting(
        s.cancelledMeetingId,
        `${label} Cancelled Meeting`,
        "cancelled",
        "published",
        "2030-03-15",
      ),
    );
    await tx.execute(
      meeting(
        s.publishedMinutesMeetingId,
        `${label} Minuted Meeting`,
        "approved",
        "published",
        "2020-04-15",
      ),
    );
    await tx.execute(
      meeting(
        s.draftMinutesMeetingId,
        `${label} Unadopted Minutes Meeting`,
        "approved",
        "published",
        "2020-05-15",
      ),
    );

    // Agenda items on the published meeting, with one exhibit of each
    // visibility hung off the child item.
    const sectionId = randomUUID();
    const itemId = randomUUID();
    await tx.execute(sql`
      INSERT INTO agenda_item (id, meeting_id, town_id, section_type, sort_order, title)
      VALUES (${sectionId}, ${s.publishedMeetingId}, ${s.townId}, 'business', 0, 'New Business')
    `);
    await tx.execute(sql`
      INSERT INTO agenda_item (id, meeting_id, town_id, section_type, sort_order, title,
                               parent_item_id, description)
      VALUES (${itemId}, ${s.publishedMeetingId}, ${s.townId}, 'business', 1,
              ${`${label} Culvert Replacement`}, ${sectionId}, 'Award the contract')
    `);

    const exhibit = (id: string, title: string, visibility: string) => sql`
      INSERT INTO exhibit (id, town_id, agenda_item_id, title, file_storage_path,
                           file_type, file_size, visibility)
      VALUES (${id}, ${s.townId}, ${itemId}, ${title}, ${`/files/${id}.pdf`}, 'pdf', 1024,
              ${visibility}::exhibit_visibility)
    `;
    await tx.execute(exhibit(s.publicExhibitId, `${label} Public Exhibit`, "public"));
    await tx.execute(exhibit(s.boardOnlyExhibitId, `${label} BOARD ONLY Exhibit`, "board_only"));
    await tx.execute(exhibit(s.adminOnlyExhibitId, `${label} ADMIN ONLY Exhibit`, "admin_only"));

    // Minutes: one published, one still in draft.
    await tx.execute(sql`
      INSERT INTO minutes_document (id, town_id, meeting_id, status, html_rendered, published_at)
      VALUES (${randomUUID()}, ${s.townId}, ${s.publishedMinutesMeetingId}, 'published',
              ${`<p>${label} adopted minutes</p>`}, now())
    `);
    await tx.execute(sql`
      INSERT INTO minutes_document (id, town_id, meeting_id, status, html_rendered)
      VALUES (${randomUUID()}, ${s.townId}, ${s.draftMinutesMeetingId}, 'draft',
              ${`<p>${label} UNADOPTED draft minutes</p>`})
    `);

    // Two seats on the live board: one active, one no longer serving.
    for (const [name, status] of [
      [s.activeMemberName, "active"],
      [s.archivedMemberName, "archived"],
    ] as const) {
      const personId = randomUUID();
      await tx.execute(sql`
        INSERT INTO person (id, town_id, name) VALUES (${personId}, ${s.townId}, ${name})
      `);
      await tx.execute(sql`
        INSERT INTO board_member (id, person_id, board_id, town_id, term_start, status, seat_title)
        VALUES (${randomUUID()}, ${personId}, ${s.boardId}, ${s.townId}, CURRENT_DATE,
                ${status}::board_member_status, 'Selectperson')
      `);
    }
  });

  return s;
}

async function buildApp(client: postgres.Sql): Promise<FastifyInstance> {
  const db = drizzle(client);
  const server = Fastify({ logger: false });
  await server.register(sensible);
  // Registered exactly as `server.ts` registers it. The portal's tenant hook
  // reads `fastify.tenantDb`, which this plugin decorates, and the root
  // deny-by-default gate it installs runs in front of every portal route — so
  // this test also proves the two hooks compose in the right order.
  await server.register(betterAuthPlugin, {
    auth: createAuth({
      db,
      secret: "0123456789abcdef0123456789abcdef",
      baseURL: "http://localhost:3000",
      sendAuthEmail: async () => {},
    }),
    db,
    allowedOrigins: ["http://localhost:3000"],
  });
  await server.register(portalRoutes, { prefix: "/api/portal" });
  return server;
}

// One database for the whole file: the schema is expensive to build and every
// test below is a read.
let owner: postgres.Sql;
let app: postgres.Sql;
let server: FastifyInstance;
let A: TownSeed;
let B: TownSeed;
let release: (() => void) | undefined;
let finished: Promise<void>;

beforeAll(async () => {
  let ready: (() => void) | undefined;
  const started = new Promise<void>((resolve) => (ready = resolve));
  finished = withTestDb(async (ownerSql) => {
    owner = ownerSql;
    app = await connectAsAppRole(ownerSql);
    const db = drizzle(app);
    A = await seed(db, "Alpha", "alphatown");
    B = await seed(db, "Beta", "betatown");
    server = await buildApp(app);
    ready!();
    await new Promise<void>((resolve) => (release = resolve));
    await server.close();
    await app.end();
  });
  await Promise.race([started, finished]);
});

afterAll(async () => {
  release?.();
  await finished;
  void owner;
});

/**
 * A portal request as nginx would present it for town A's host.
 *
 * `null` means "send no `X-Town-Subdomain` at all" — deliberately not
 * `undefined`, which a default parameter silently replaces with A's subdomain.
 * The first draft of this file used `undefined` and the no-header test passed
 * a 200 as a 404 for exactly that reason.
 */
function get(url: string, subdomain: string | null = A.subdomain) {
  return server.inject({
    method: "GET",
    url,
    headers: subdomain === null ? {} : { "x-town-subdomain": subdomain },
  });
}

describe("the portal's tenant gate", () => {
  it("refuses a request with no X-Town-Subdomain at all", async () => {
    const res = await get(`/api/portal/${A.townId}/meetings`, null);
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain("Alpha");
  });

  it("refuses a forged subdomain no town has claimed, without a 500", async () => {
    for (const forged of ["nosuchtown", "app", "api", "../alphatown", "alpha town", ""]) {
      const res = await get(`/api/portal/${A.townId}/meetings`, forged);
      expect([forged, res.statusCode]).toEqual([forged, 404]);
      expect(res.body).not.toContain("Alpha");
    }
  });

  it("refuses a :townId that disagrees with the host it arrived on", async () => {
    // Town A's portal host asking for town B's id. Both towns exist and both
    // ids are real; what makes this a 404 is that they do not describe the
    // same town.
    const res = await get(`/api/portal/${B.townId}/meetings`);
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain("Beta");
  });

  it("serves the town the subdomain names", async () => {
    const res = await get("/api/portal/resolve");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: A.townId, name: "Alpha", subdomain: "alphatown" });
  });
});

describe("tenancy: town A's portal cannot obtain any row of town B", () => {
  it("never returns a B row from any list route", async () => {
    const urls = [
      `/api/portal/${A.townId}/meetings`,
      `/api/portal/${A.townId}/boards`,
      `/api/portal/${A.townId}/calendar?start=2000-01-01&end=2099-01-01`,
      `/api/portal/${A.townId}/search?q=culvert`,
      `/api/portal/${A.townId}/sitemap.xml`,
    ];
    for (const url of urls) {
      const res = await get(url);
      expect([url, res.statusCode]).toEqual([url, 200]);
      // Ids, not names: a name could coincide, an id cannot.
      for (const id of [B.townId, B.boardId, B.publishedMeetingId, B.publishedMinutesMeetingId]) {
        expect([url, res.body.includes(id)]).toEqual([url, false]);
      }
      expect([url, res.body.includes("Beta")]).toEqual([url, false]);
    }
  });

  it("404s on B's meeting, agenda, minutes and board even when named directly", async () => {
    // The `:townId` is A's, so the URL is internally consistent — only the
    // resource belongs to somebody else. This is the shape a bug would take if
    // the tenant context were bound but the row were fetched by id alone.
    const urls = [
      `/api/portal/${A.townId}/meetings/${B.publishedMeetingId}`,
      `/api/portal/${A.townId}/meetings/${B.publishedMeetingId}/agenda`,
      `/api/portal/${A.townId}/meetings/${B.publishedMinutesMeetingId}/minutes`,
      `/api/portal/${A.townId}/boards/${B.boardId}`,
    ];
    for (const url of urls) {
      const res = await get(url);
      expect([url, res.statusCode]).toEqual([url, 404]);
      expect([url, res.body.includes("Beta")]).toEqual([url, false]);
    }
  });

  it("searches only its own town, for a term both towns match", async () => {
    const res = await get(`/api/portal/${A.townId}/search?q=culvert`);
    expect(res.statusCode).toBe(200);
    const results = res.json().results as Array<{ title: string; meeting_id: string }>;
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.title.startsWith("Alpha"))).toBe(true);
    expect(results.some((r) => r.meeting_id === B.publishedMeetingId)).toBe(false);
  });
});

describe("publication: what a town has not published stays unpublished", () => {
  it("omits a DRAFT meeting from the list, the calendar and the sitemap", async () => {
    for (const url of [
      `/api/portal/${A.townId}/meetings`,
      `/api/portal/${A.townId}/calendar?start=2000-01-01&end=2099-01-01`,
      `/api/portal/${A.townId}/sitemap.xml`,
    ]) {
      const res = await get(url);
      expect([url, res.statusCode]).toEqual([url, 200]);
      expect([url, res.body.includes(A.draftMeetingId)]).toEqual([url, false]);
      expect([url, res.body.includes("SECRET")]).toEqual([url, false]);
      // …while the published one IS there, so the assertion above is not
      // passing because the route returned nothing.
      expect([url, res.body.includes(A.publishedMeetingId)]).toEqual([url, true]);
    }
  });

  it("404s a DRAFT meeting and its agenda, though its agenda_status is published", async () => {
    expect((await get(`/api/portal/${A.townId}/meetings/${A.draftMeetingId}`)).statusCode).toBe(
      404,
    );
    expect(
      (await get(`/api/portal/${A.townId}/meetings/${A.draftMeetingId}/agenda`)).statusCode,
    ).toBe(404);
  });

  it("keeps a DRAFT meeting out of full-text search", async () => {
    // The regression `drizzle/0002_portal_tenant.sql` § 2 closes: the baseline
    // `portal_search` filtered on `agenda_status` and never on the meeting's
    // own status, so an unannounced meeting's title, date, board and agenda
    // text were searchable while every other route hid it.
    const res = await get(`/api/portal/${A.townId}/search?q=culvert`);
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain(A.draftMeetingId);
    expect(res.body).not.toContain("SECRET");
  });

  it("404s a CANCELLED meeting's agenda even though the agenda was published", async () => {
    // The divergence this lift exists to remove: `/agenda` used to check
    // `agenda_status` alone, so a meeting cancelled after its agenda went out
    // kept serving it. `portalCanSelectAgenda` requires both.
    const res = await get(`/api/portal/${A.townId}/meetings/${A.cancelledMeetingId}/agenda`);
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain("Culvert");
  });

  it("omits an ARCHIVED board from the list, the sitemap, and its own page", async () => {
    const list = await get(`/api/portal/${A.townId}/boards`);
    expect(list.statusCode).toBe(200);
    expect(list.body).toContain(A.boardId);
    expect(list.body).not.toContain(A.archivedBoardId);
    expect(list.body).not.toContain("Disbanded");

    const sitemap = await get(`/api/portal/${A.townId}/sitemap.xml`);
    expect(sitemap.body).not.toContain(A.archivedBoardId);

    const detail = await get(`/api/portal/${A.townId}/boards/${A.archivedBoardId}`);
    expect(detail.statusCode).toBe(404);
  });

  it("names only ACTIVE board members", async () => {
    const res = await get(`/api/portal/${A.townId}/boards/${A.boardId}`);
    expect(res.statusCode).toBe(200);
    const members = res.json().members as Array<{ name: string }>;
    expect(members.map((m) => m.name)).toEqual([A.activeMemberName]);
    expect(res.body).not.toContain(A.archivedMemberName);
  });

  it("serves PUBLIC exhibits and withholds board_only and admin_only ones", async () => {
    const res = await get(`/api/portal/${A.townId}/meetings/${A.publishedMeetingId}/agenda`);
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain(A.publicExhibitId);
    expect(res.body).not.toContain(A.boardOnlyExhibitId);
    expect(res.body).not.toContain("BOARD ONLY");
    expect(res.body).not.toContain(A.adminOnlyExhibitId);
    expect(res.body).not.toContain("ADMIN ONLY");
  });

  it("serves PUBLISHED minutes and withholds draft ones", async () => {
    const published = await get(
      `/api/portal/${A.townId}/meetings/${A.publishedMinutesMeetingId}/minutes`,
    );
    expect(published.statusCode).toBe(200);
    expect(published.body).toContain("adopted minutes");

    const draft = await get(`/api/portal/${A.townId}/meetings/${A.draftMinutesMeetingId}/minutes`);
    expect(draft.statusCode).toBe(404);
    expect(draft.body).not.toContain("UNADOPTED");

    // …and the meeting page must not advertise minutes that do not exist for
    // the public, which is how a 404 becomes a support call.
    const meeting = await get(`/api/portal/${A.townId}/meetings/${A.draftMinutesMeetingId}`);
    expect(meeting.json().has_published_minutes).toBe(false);
  });

  it("does not link an unpublished agenda or unadopted minutes from the sitemap", async () => {
    const res = await get(`/api/portal/${A.townId}/sitemap.xml`);
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain(`/meetings/${A.publishedMinutesMeetingId}/minutes`);
    expect(res.body).not.toContain(`/meetings/${A.draftMinutesMeetingId}/minutes`);
  });
});

describe("the subdomain-routed SEO endpoints", () => {
  it("redirect to the canonical path for the town the host names", async () => {
    const sitemap = await get("/api/portal/sitemap");
    expect(sitemap.statusCode).toBe(302);
    expect(sitemap.headers.location).toBe(`/api/portal/${A.townId}/sitemap.xml`);

    const robots = await get("/api/portal/robots");
    expect(robots.statusCode).toBe(302);
    expect(robots.headers.location).toBe(`/api/portal/${A.townId}/robots.txt`);
  });

  it("advertise the town's own portal host in robots.txt", async () => {
    const res = await get(`/api/portal/${A.townId}/robots.txt`);
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("https://alphatown.townmeetingmanager.com/sitemap.xml");
    expect(res.body).not.toContain("betatown");
  });
});
