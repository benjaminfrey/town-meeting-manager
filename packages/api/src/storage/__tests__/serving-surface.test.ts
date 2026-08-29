/**
 * Stage 1, Task D1e — what is reachable from outside, pinned.
 *
 * Two of this task's guarantees are not properties of any TypeScript function:
 *
 *   1. The public asset root is served by nginx at the `seals/` SUBTREE, not
 *      at the root. Even a file written beside `seals/` by something that
 *      bypassed `storage/paths.ts` is not served.
 *   2. The document root is `internal`, so no client request can reach it —
 *      only a response this application produced, carrying `X-Accel-Redirect`.
 *
 * Both live in `infrastructure/nginx/nginx.conf`, which nothing else in this
 * repository reads. A config change that quietly undid either would pass every
 * other test in the suite, and would not be visible in a diff to anyone who
 * was not looking for it. So it is pinned here, the way
 * `routes/__tests__/public-route-inventory.test.ts` pins the public routes:
 * the point is to make a change to the exposure surface impossible to make
 * accidentally.
 *
 * The third section pins the owner's decision that `board_only` and
 * `admin_only` exhibits stay out of the portal.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { withTestDb, connectAsAppRole } from "../../test/db-harness.js";
import { buildPortalApp } from "../../test/portal-app.js";
import { inTown, seedTown, testDb } from "../../trpc/__tests__/fixtures.js";
import { portalVisibleExhibits, portalCanSelectExhibit } from "../../trpc/authorization/rules.js";
import {
  writeFileDurably,
  DOCUMENT_FILE_MODE,
  DOCUMENT_DIRECTORY_MODE,
  PUBLIC_ASSET_FILE_MODE,
  PUBLIC_ASSET_DIRECTORY_MODE,
} from "../store.js";

const REPO_ROOT = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../../..");
const NGINX = fs.readFileSync(path.join(REPO_ROOT, "infrastructure/nginx/nginx.conf"), "utf-8");
const COMPOSE = fs.readFileSync(
  path.join(REPO_ROOT, "infrastructure/docker-compose.production.yml"),
  "utf-8",
);

describe("the public asset root is exposed as a subtree, not as a root", () => {
  it("serves /public-assets/seals/ and never /public-assets/ itself", () => {
    expect(NGINX).toContain("location /public-assets/seals/ {");
    // A bare `location /public-assets/` would serve whatever else ever landed
    // in that tree. There must not be one.
    expect(NGINX).not.toMatch(/location\s+\/public-assets\/\s*\{/);
  });

  it("aliases it at the seals directory, not at the root of the volume", () => {
    const aliases = [
      ...NGINX.matchAll(/location \/public-assets\/seals\/ \{[^}]*?alias ([^;]+);/gs),
    ];
    expect(aliases.length).toBeGreaterThan(0);
    for (const match of aliases) {
      expect(match[1]!.trim()).toBe("/var/lib/tmm/public/seals/");
    }
  });

  it("serves it with nosniff and a sandbox, because the bytes are uploaded", () => {
    // The seal is an image an administrator uploaded, served from the
    // application's own origin with no route in front. `sealExtensionFor`
    // refuses anything that is not a PNG or a JPEG, and these headers are the
    // second line: even if a byte pattern ever fooled the sniffer, the browser
    // is told not to sniff and not to execute.
    const block = NGINX.match(/location \/public-assets\/seals\/ \{.*?\n\s*\}/s)?.[0] ?? "";
    expect(block).toContain("X-Content-Type-Options");
    expect(block).toContain("nosniff");
    expect(block).toContain("sandbox");
  });
});

describe("the document root is internal", () => {
  it("marks /__documents/ internal, so no client can request it", () => {
    const block = NGINX.match(/location \/__documents\/ \{.*?\n\s*\}/s)?.[0];
    expect(block).toBeTruthy();
    expect(block).toContain("internal;");
    expect(block).toContain("alias /var/lib/tmm/documents/;");
  });

  it("is internal on the portal host too, and reachable only via /api/portal/", () => {
    // ─── Stage 1, Task D1f changed what this pins ──────────────────────
    //
    // D1e asserted the document root was ABSENT from the portal host, because
    // the portal served no stored documents. It serves two now — the minutes
    // and agenda PDFs the portal UI links from three pages, which answered 500
    // on every input until D1f — so the location has to exist for
    // `X-Accel-Redirect` to resolve.
    //
    // What replaces "absent" is not weaker, and this test says which property
    // is now doing the work. `internal` means nginx answers 404 to any CLIENT
    // request for /__documents/...; the only way in is an X-Accel-Redirect on
    // a response an upstream produced. On this host the only upstream under
    // /api/ is /api/portal/ — everything else there is 404'd — so the only
    // handlers that can emit one are in `routes/portal.ts`, where every
    // document is gated by a publication predicate. Both halves are asserted:
    // drop `internal;` and this fails, and widen the proxy back to all of
    // /api/ and the last assertion in the block below fails.
    const portalBlock = NGINX.match(/server_name ~\^\(\?<subdomain>.*?\n\s*\}\n\}/s)?.[0];
    expect(portalBlock).toBeTruthy();
    expect(portalBlock).toContain("location /public-assets/seals/ {");

    const documents = portalBlock?.match(/location \/__documents\/ \{.*?\n\s*\}/s)?.[0];
    expect(documents).toBeTruthy();
    expect(documents).toContain("internal;");
    expect(documents).toContain("alias /var/lib/tmm/documents/;");
  });

  it("leaves Phase C's sibling-subdomain hardening intact", () => {
    // Do-not-weaken pin. Task C2 narrowed the portal host to /api/portal/ and
    // 404s everything else under /api/. Neither of this task's locations is
    // under /api/, so nothing here relaxes it — asserted rather than assumed.
    expect(NGINX).toContain("location /api/portal/ {");
    expect(NGINX).toContain("location /api/ { return 404; }");
  });
});

describe("the portal serves public exhibits only", () => {
  /**
   * Seed one town with a meeting whose agenda is published and which carries
   * one exhibit of each visibility tier, and return the three exhibit ids.
   */
  async function seedThreeTiers(db: ReturnType<typeof testDb>) {
    const town = await seedTown(db, "Portalville");
    const meetingId = randomUUID();
    const sectionId = randomUUID();
    const itemId = randomUUID();
    const ids: Record<string, string> = {};

    await inTown(db, town, async (tx) => {
      await tx.execute(sql`
        INSERT INTO meeting (id, board_id, town_id, title, scheduled_date, status, agenda_status)
        VALUES (${meetingId}, ${town.boardId}, ${town.townId}, 'Regular', CURRENT_DATE,
                'adjourned', 'published')
      `);
      await tx.execute(sql`
        INSERT INTO agenda_item (id, meeting_id, town_id, section_type, sort_order, title)
        VALUES (${sectionId}, ${meetingId}, ${town.townId}, 'business', 0, 'New Business')
      `);
      await tx.execute(sql`
        INSERT INTO agenda_item (id, meeting_id, town_id, section_type, sort_order, title,
                                 parent_item_id)
        VALUES (${itemId}, ${meetingId}, ${town.townId}, 'business', 1, 'Item', ${sectionId})
      `);
      for (const visibility of ["public", "board_only", "admin_only"] as const) {
        const id = randomUUID();
        ids[visibility] = id;
        await tx.execute(sql`
          INSERT INTO exhibit (id, agenda_item_id, town_id, title, file_storage_path,
                               file_type, file_size, visibility)
          VALUES (${id}, ${itemId}, ${town.townId}, ${`${visibility} EXHIBIT TITLE`},
                  'exhibits/a/b/c.pdf', 'application/pdf', 10, ${visibility}::exhibit_visibility)
        `);
      }
    });

    return { town, meetingId, itemId, ids };
  }

  it("never puts a board_only or admin_only exhibit in the route's response", async () => {
    // This used to be a source-text pin —
    // `expect(PORTAL_ROUTE).toContain('.eq("visibility", "public")')` — from
    // when the portal read through PostgREST and nothing in this package could
    // drive it. D1b moved the portal onto tenant-scoped Drizzle and that
    // string went with it, so the pin failed in the merged tree.
    //
    // The intent was right and is kept; the mechanism is not. A source-text
    // assertion breaks on every refactor that does not change behaviour, and
    // holds for every refactor that does — a query could keep that exact
    // substring and still leak, if the filter moved onto the wrong subquery.
    // So this now asks the real route, over a `tmm_app` connection with row
    // level security on, and reads the bytes that would go to a resident.
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const { town, meetingId, ids } = await seedThreeTiers(testDb(client));
        const server = await buildPortalApp(app);
        try {
          const res = await server.inject({
            method: "GET",
            url: `/api/portal/${town.townId}/meetings/${meetingId}/agenda`,
            headers: { "x-town-subdomain": "portalville" },
          });

          expect(res.statusCode).toBe(200);
          // The positive control. Without it the negatives below would hold
          // for a route that returned an empty agenda, or a 404.
          expect(res.body).toContain(ids.public);
          expect(res.body).toContain("public EXHIBIT TITLE");

          expect(res.body).not.toContain(ids.board_only);
          expect(res.body).not.toContain("board_only EXHIBIT TITLE");
          expect(res.body).not.toContain(ids.admin_only);
          expect(res.body).not.toContain("admin_only EXHIBIT TITLE");
        } finally {
          await server.close();
        }
      } finally {
        await app.end();
      }
    });
  });

  it("excludes both non-public tiers from the portal rule", async () => {
    // And the rule on its own, on real rows: `board_only` is the disclosure
    // case worth pinning, because it is the tier a clerk reaches for when
    // material is for the board and not yet for the public.
    await withTestDb(async (client) => {
      const db = testDb(client);
      const { town, itemId, ids } = await seedThreeTiers(db);

      const rows = await inTown(
        db,
        town,
        async (tx) =>
          (await tx.execute(
            sql`SELECT id, visibility::text AS visibility FROM exhibit WHERE agenda_item_id = ${itemId}`,
          )) as unknown as Array<{
            id: string;
            visibility: "public" | "board_only" | "admin_only";
          }>,
      );
      expect(rows).toHaveLength(3);

      const visible = portalVisibleExhibits(rows);
      expect(visible.map((r) => r.id)).toEqual([ids.public]);
      expect(portalCanSelectExhibit({ visibility: "board_only" })).toBe(false);
      expect(portalCanSelectExhibit({ visibility: "admin_only" })).toBe(false);
    });
  });
});

/**
 * ─── The modes the two roots are written with ─────────────────────────────
 *
 * The other property that is not a property of any TypeScript function, and
 * the one that was wrong. `writeFileDurably` wrote every file `0640` and the
 * API container ran as root with no group arrangement, so every stored file
 * landed `root:root 0640`. `infrastructure/nginx/nginx.conf` sets
 * `user nginx;`, which means the WORKERS — the processes that open a seal for
 * a static request and a minutes PDF for an `X-Accel-Redirect` — are
 * unprivileged and got `EACCES` on every read. Correct in every test, dead
 * behind nginx.
 *
 * The fix has two halves and this pins both: the modes here, and the shared
 * group in the compose file. There is no test that can open a file as the
 * `nginx` user, so what is asserted is the pair of facts that make the read
 * work — group-readable bits on this side, nginx's group as the API's primary
 * group on that side.
 */
describe("what the API writes is readable by nginx and by nothing else", () => {
  async function writeInto(root: string, relative: string) {
    const absolute = await writeFileDurably(root, relative, new Uint8Array([1, 2, 3]));
    const fileMode = (await fsp.stat(absolute)).mode & 0o777;
    const directoryMode = (await fsp.stat(path.dirname(absolute))).mode & 0o777;
    const rootMode = (await fsp.stat(root)).mode & 0o777;
    return { absolute, fileMode, directoryMode, rootMode };
  }

  it("writes documents group-readable and NOT world-readable", async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), "tmm-documents-"));
    try {
      const written = await writeInto(root, "minutes/town/meeting/doc.pdf");
      // 0640: the API and nginx's group. Not `others` — the `storage-data`
      // volume is mounted by the Supabase Storage container too, so "other"
      // is a real process, and 0644 here would hand it every town's draft
      // minutes.
      expect(written.fileMode.toString(8)).toBe(DOCUMENT_FILE_MODE.toString(8));
      expect(written.fileMode & 0o004).toBe(0); // world-readable: never
      expect(written.fileMode & 0o040).toBe(0o040); // group-readable: required
      // Directories need group `x` or nginx cannot traverse to the file, and
      // must not be world-traversable for the same reason as above.
      for (const mode of [written.directoryMode, written.rootMode]) {
        expect(mode.toString(8)).toBe(DOCUMENT_DIRECTORY_MODE.toString(8));
        expect(mode & 0o050).toBe(0o050);
        expect(mode & 0o007).toBe(0);
      }
    } finally {
      await fsp.rm(root, { recursive: true, force: true });
    }
  });

  it("writes public assets world-readable but never world-writable", async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), "tmm-public-"));
    const previous = process.env.PUBLIC_ASSET_ROOT;
    // `storageModesFor` compares against `publicAssetRoot()`, which reads this
    // at call time — so this is what makes the write below take the public
    // branch rather than the default-deny one.
    process.env.PUBLIC_ASSET_ROOT = root;
    try {
      const written = await writeInto(root, "seals/town.png");
      expect(written.fileMode.toString(8)).toBe(PUBLIC_ASSET_FILE_MODE.toString(8));
      // nginx serves these to the anonymous internet, so world-readable is a
      // restatement of what the root is for. World-WRITABLE is the thing that
      // must never happen: they are served from the application's own origin.
      expect(written.fileMode & 0o004).toBe(0o004);
      expect(written.fileMode & 0o022).toBe(0);
      expect(written.directoryMode.toString(8)).toBe(PUBLIC_ASSET_DIRECTORY_MODE.toString(8));
      expect(written.directoryMode & 0o022).toBe(0);
    } finally {
      if (previous === undefined) delete process.env.PUBLIC_ASSET_ROOT;
      else process.env.PUBLIC_ASSET_ROOT = previous;
      await fsp.rm(root, { recursive: true, force: true });
    }
  });

  it("sets the mode regardless of the process umask", async () => {
    // The reason `writeFileDurably` calls `chmod`/`fchmod` rather than
    // relying on the `mode` argument to `open`/`mkdir`: that argument is
    // masked by the umask, so a deployment running `umask 027` would strip
    // the group read bit off the public root and take nginx's access away
    // again — this exact bug, arriving through a different door.
    const previousUmask = process.umask(0o077);
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), "tmm-umask-"));
    try {
      const written = await writeInto(root, "minutes/town/meeting/doc.pdf");
      expect(written.fileMode & 0o040).toBe(0o040);
      expect(written.directoryMode & 0o050).toBe(0o050);
    } finally {
      process.umask(previousUmask);
      await fsp.rm(root, { recursive: true, force: true });
    }
  });

  it("runs the API container in nginx's group, which is the other half", () => {
    // The modes above are only readable by nginx if the files are GROUP-OWNED
    // by nginx. Nothing in this process can assert a container's group, so the
    // compose declaration is pinned instead — the same way this file pins the
    // nginx locations. 101 is the `nginx` uid/gid in `nginx:*-alpine`, which
    // the compose file also names.
    expect(COMPOSE).toMatch(/user:\s*"\$\{TMM_ASSET_UID:-0\}:\$\{TMM_ASSET_GID:-101\}"/);
    expect(COMPOSE).toContain("image: nginx:1.27-alpine");
    // And nginx must still drop its workers to an unprivileged user — if it
    // ever ran them as root the group would not matter, but neither would any
    // of the rest of this file.
    expect(NGINX).toMatch(/^user\s+nginx;/m);
  });
});
