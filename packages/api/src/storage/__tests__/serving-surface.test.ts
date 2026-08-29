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
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { withTestDb } from "../../test/db-harness.js";
import { inTown, seedTown, testDb } from "../../trpc/__tests__/fixtures.js";
import { portalVisibleExhibits, portalCanSelectExhibit } from "../../trpc/authorization/rules.js";

const REPO_ROOT = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../../..");
const NGINX = fs.readFileSync(path.join(REPO_ROOT, "infrastructure/nginx/nginx.conf"), "utf-8");
const PORTAL_ROUTE = fs.readFileSync(
  path.join(REPO_ROOT, "packages/api/src/routes/portal.ts"),
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

  it("is absent from the portal host, which serves anonymous residents", () => {
    // The portal server block renders town-authored content for people with no
    // session. It gets the public seal subtree and nothing else.
    const portalBlock = NGINX.match(/server_name ~\^\(\?<subdomain>.*?\n\s*\}\n\}/s)?.[0];
    expect(portalBlock).toBeTruthy();
    expect(portalBlock).toContain("location /public-assets/seals/ {");
    // The DIRECTIVE, not the string: the block carries a comment saying why
    // the document root is deliberately absent, and a substring check on the
    // path would be satisfied by that comment. (It was, first time.)
    expect(portalBlock).not.toMatch(/location\s+\/__documents\//);
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
  it("filters at the query, so a board_only exhibit never enters portal output", () => {
    // Pinned as source text because this query runs through PostgREST against
    // a service-role client — deliberately still, portal document serving is
    // out of this task's scope — and there is no harness in this package that
    // can drive it. What can be pinned is that the constraint is there.
    expect(PORTAL_ROUTE).toContain('.eq("visibility", "public")');
  });

  it("excludes both non-public tiers from the portal rule", async () => {
    // And the behavioural half, on real rows: `board_only` is the disclosure
    // case worth pinning, because it is the tier a clerk reaches for when
    // material is for the board and not yet for the public.
    await withTestDb(async (client) => {
      const db = testDb(client);
      const town = await seedTown(db, "Portalville");

      const meetingId = randomUUID();
      const itemId = randomUUID();
      const ids: Record<string, string> = {};
      await inTown(db, town, async (tx) => {
        await tx.execute(sql`
          INSERT INTO meeting (id, board_id, town_id, title, scheduled_date, status)
          VALUES (${meetingId}, ${town.boardId}, ${town.townId}, 'Regular', CURRENT_DATE, 'adjourned')
        `);
        await tx.execute(sql`
          INSERT INTO agenda_item (id, meeting_id, town_id, section_type, title)
          VALUES (${itemId}, ${meetingId}, ${town.townId}, 'business', 'Item')
        `);
        for (const visibility of ["public", "board_only", "admin_only"] as const) {
          const id = randomUUID();
          ids[visibility] = id;
          await tx.execute(sql`
            INSERT INTO exhibit (id, agenda_item_id, town_id, title, file_storage_path,
                                 file_type, file_size, visibility)
            VALUES (${id}, ${itemId}, ${town.townId}, ${visibility}, 'exhibits/a/b/c.pdf',
                    'application/pdf', 10, ${visibility}::exhibit_visibility)
          `);
        }
      });

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
