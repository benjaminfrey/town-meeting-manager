/**
 * Stage 1, Task D1e — the authorization on the two rebuilt features, against
 * a real database.
 *
 * Every actor here is loaded by `loadActor()` from a real `user_account` row,
 * inside `withTenant()`, exactly as `__tests__/fixtures.ts` explains: an actor
 * a test hand-builds is an actor whose shape the test author chose, and this
 * project has more than once shipped an authorization layer that was green
 * against a matrix nobody stores.
 *
 * ─── What these tests exist to catch ──────────────────────────────────────
 *
 * Both features have never worked, so there is no regression to guard — there
 * is a disclosure to prevent, and it has a specific shape. Before this task, a
 * minutes PDF was written to a bucket declared `public = true` at
 * `${townId}/meetings/${meetingId}/minutes-${Date.now()}.pdf`, and the portal
 * publishes both ids. The first test below is the one that matters: a caller
 * without R4 cannot read a draft.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { sql } from "drizzle-orm";
import type postgres from "postgres";
import { withTestDb, connectAsAppRole } from "../../test/db-harness.js";
import {
  expectRefusal,
  inTown,
  seedActor,
  seedBoardSeat,
  seedTown,
  testDb,
  type TestDb,
  type TownFixture,
} from "../../trpc/__tests__/fixtures.js";
import type { TenantTx } from "../../db/with-tenant.js";
import {
  DocumentNotFoundError,
  createExhibitFromUpload,
  deleteExhibit,
  resolveExhibitForDownload,
  resolveMinutesDocumentForDownload,
  setTownSeal,
  clearTownSeal,
} from "../documents.js";
import { StoragePathError, MAX_UPLOAD_BYTES } from "../paths.js";
import { fileExists } from "../store.js";

// ─── Test roots ───────────────────────────────────────────────────────
//
// Both roots point at a temporary directory for the whole file. Reading them
// from the environment at call time is what makes this possible, and is also
// how production points them at the shared volume.

let tempRoot: string;
let previousEnv: { pub?: string; doc?: string };

beforeAll(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "tmm-storage-"));
  previousEnv = { pub: process.env.PUBLIC_ASSET_ROOT, doc: process.env.DOCUMENT_ROOT };
  process.env.PUBLIC_ASSET_ROOT = path.join(tempRoot, "public");
  process.env.DOCUMENT_ROOT = path.join(tempRoot, "documents");
});

afterAll(async () => {
  if (previousEnv.pub === undefined) delete process.env.PUBLIC_ASSET_ROOT;
  else process.env.PUBLIC_ASSET_ROOT = previousEnv.pub;
  if (previousEnv.doc === undefined) delete process.env.DOCUMENT_ROOT;
  else process.env.DOCUMENT_ROOT = previousEnv.doc;
  await fs.rm(tempRoot, { recursive: true, force: true });
});

// ─── Fixtures for the rows these rules read ───────────────────────────

const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);
const PDF = Buffer.from("%PDF-1.7\n% a tiny but genuine-looking pdf\n");

async function seedMeeting(db: TestDb, town: TownFixture, boardId: string): Promise<string> {
  const meetingId = randomUUID();
  await inTown(db, town, async (tx) => {
    await tx.execute(sql`
      INSERT INTO meeting (id, board_id, town_id, title, scheduled_date, status)
      VALUES (${meetingId}, ${boardId}, ${town.townId}, 'Regular Meeting',
              CURRENT_DATE, 'adjourned')
    `);
  });
  return meetingId;
}

async function seedAgendaItem(db: TestDb, town: TownFixture, meetingId: string): Promise<string> {
  const itemId = randomUUID();
  await inTown(db, town, async (tx) => {
    await tx.execute(sql`
      INSERT INTO agenda_item (id, meeting_id, town_id, section_type, title)
      VALUES (${itemId}, ${meetingId}, ${town.townId}, 'business', 'An item')
    `);
  });
  return itemId;
}

async function seedMinutes(
  db: TestDb,
  town: TownFixture,
  meetingId: string,
  status: "draft" | "review" | "approved" | "published",
  storagePath: string | null,
): Promise<string> {
  const id = randomUUID();
  await inTown(db, town, async (tx) => {
    await tx.execute(sql`
      INSERT INTO minutes_document (id, meeting_id, town_id, status, pdf_storage_path)
      VALUES (${id}, ${meetingId}, ${town.townId}, ${status}::minutes_document_status,
              ${storagePath})
    `);
  });
  return id;
}

async function seedExhibit(
  db: TestDb,
  town: TownFixture,
  agendaItemId: string,
  visibility: "public" | "board_only" | "admin_only",
  overrides: { fileType?: string; storagePath?: string } = {},
): Promise<string> {
  const id = randomUUID();
  await inTown(db, town, async (tx) => {
    await tx.execute(sql`
      INSERT INTO exhibit (id, agenda_item_id, town_id, title, file_storage_path,
                           file_type, file_size, file_name, visibility)
      VALUES (${id}, ${agendaItemId}, ${town.townId}, 'An attachment',
              ${overrides.storagePath ?? `exhibits/${town.townId}/${agendaItemId}/${id}.pdf`},
              ${overrides.fileType ?? "application/pdf"}, 10, 'attachment.pdf',
              ${visibility}::exhibit_visibility)
    `);
  });
  return id;
}

/** Run `fn` with a live database, a town and two boards. */
async function withTown(
  fn: (ctx: { db: TestDb; town: TownFixture; client: postgres.Sql }) => Promise<void>,
): Promise<void> {
  await withTestDb(async (client) => {
    const db = testDb(client);
    const town = await seedTown(db);
    await fn({ db, town, client });
  });
}

/**
 * Two towns, on a connection that RLS actually binds.
 *
 * `withTestDb` hands back the database OWNER, and every supported setup runs
 * that as a superuser — so row level security does not apply to it, however
 * FORCEd the tables are (`test/db-harness.ts` says so in its header). A
 * cross-tenant test on that connection passes with RLS switched off entirely,
 * which is a test of nothing. Every assertion below that claims "town A cannot
 * see town B" therefore runs as `tmm_app`, the non-owner role production uses.
 *
 * The permission tests above deliberately do NOT: they are about rules in
 * TypeScript, and the owner connection keeps them honest about which layer
 * refused. When a rule is what should refuse, RLS must not be able to refuse
 * first and make the test green for the wrong reason.
 */
async function withTwoTownsAsAppRole(
  fn: (ctx: { db: TestDb; townA: TownFixture; townB: TownFixture }) => Promise<void>,
): Promise<void> {
  await withTestDb(async (owner) => {
    const app = await connectAsAppRole(owner);
    try {
      const db = testDb(app);
      await fn({ db, townA: await seedTown(db, "Alpha"), townB: await seedTown(db, "Bravo") });
    } finally {
      await app.end();
    }
  });
}

function tx<T>(db: TestDb, town: TownFixture, fn: (tx: TenantTx) => Promise<T>): Promise<T> {
  return inTown(db, town, fn);
}

// ═══════════════════════════════════════════════════════════════════════
// Minutes — rule 9
// ═══════════════════════════════════════════════════════════════════════

describe("fetching a minutes PDF", () => {
  it("refuses a caller with no R4 for that board when the minutes are a DRAFT", async () => {
    // THE test for this task. This is the disclosure the design exists to
    // close: unadopted minutes, previously readable by path from a bucket
    // declared `public = true`, at a path built from two ids the public
    // portal publishes.
    await withTown(async ({ db, town }) => {
      const meetingId = await seedMeeting(db, town, town.boardId);
      const relative = `minutes/${town.townId}/${meetingId}/${randomUUID()}.pdf`;
      const draft = await seedMinutes(db, town, meetingId, "draft", relative);

      // A staff account holding a real permission — just not R4 on this board.
      const { actor } = await seedActor(db, town, { role: "staff", global: ["A2"] });

      await expectRefusal(
        () => tx(db, town, (t) => resolveMinutesDocumentForDownload(t, actor, draft)),
        { code: "R4" },
      );
    });
  });

  it("refuses in-review minutes too — 'draft' is not the only unadopted state", async () => {
    await withTown(async ({ db, town }) => {
      const meetingId = await seedMeeting(db, town, town.boardId);
      const inReview = await seedMinutes(db, town, meetingId, "review", "minutes/x/y/z.pdf");
      const { actor } = await seedActor(db, town, { role: "staff", global: ["A2"] });

      await expectRefusal(
        () => tx(db, town, (t) => resolveMinutesDocumentForDownload(t, actor, inReview)),
        { code: "R4" },
      );
    });
  });

  it("allows a recording secretary holding R4 on THAT board, and not on another", async () => {
    // The board scoping is the half a global check silently loses. Both
    // shipped `designated_boards` templates grant R4 per board and nothing
    // globally, so a global resolver answers "no" to every secretary the
    // product has ever created — and a resolver that ignored the board would
    // also hand this actor the OTHER board's drafts.
    await withTown(async ({ db, town }) => {
      const own = await seedMeeting(db, town, town.boardId);
      const other = await seedMeeting(db, town, town.otherBoardId);
      const ownDraft = await seedMinutes(db, town, own, "draft", `minutes/a/b/${randomUUID()}.pdf`);
      const otherDraft = await seedMinutes(
        db,
        town,
        other,
        "draft",
        `minutes/a/b/${randomUUID()}.pdf`,
      );

      const { actor } = await seedActor(db, town, {
        role: "staff",
        boardOverrides: [{ boardId: town.boardId, permissions: { R4: true } }],
      });

      await expect(
        tx(db, town, (t) => resolveMinutesDocumentForDownload(t, actor, ownDraft)),
      ).resolves.toMatchObject({ contentType: "application/pdf" });

      await expectRefusal(
        () => tx(db, town, (t) => resolveMinutesDocumentForDownload(t, actor, otherDraft)),
        { code: "R4" },
      );
    });
  });

  it("lets any member of the town read APPROVED minutes — they are the record", async () => {
    await withTown(async ({ db, town }) => {
      const meetingId = await seedMeeting(db, town, town.boardId);
      const approved = await seedMinutes(
        db,
        town,
        meetingId,
        "approved",
        `minutes/a/b/${randomUUID()}.pdf`,
      );
      const { actor } = await seedActor(db, town, { role: "board_member" });

      await expect(
        tx(db, town, (t) => resolveMinutesDocumentForDownload(t, actor, approved)),
      ).resolves.toBeTruthy();
    });
  });

  it("answers NOT FOUND, not FORBIDDEN, for another town's minutes", async () => {
    // RLS makes town B's row invisible, so this function cannot tell a
    // cross-tenant id from a nonexistent one — and must not be able to. A 403
    // for one and a 404 for the other would confirm that the id exists, which
    // is a membership oracle over every other town's records.
    await withTwoTownsAsAppRole(async ({ db, townA, townB }) => {
      const meetingB = await seedMeeting(db, townB, townB.boardId);
      const draftB = await seedMinutes(db, townB, meetingB, "draft", "minutes/x/y/z.pdf");

      // An ADMINISTRATOR of town A: the strongest actor town A has, so a
      // refusal here is tenancy and not permissions.
      const { actor } = await seedActor(db, townA, { role: "admin" });

      await expect(
        tx(db, townA, (t) => resolveMinutesDocumentForDownload(t, actor, draftB)),
      ).rejects.toBeInstanceOf(DocumentNotFoundError);

      // And the same answer for an id that exists nowhere.
      await expect(
        tx(db, townA, (t) => resolveMinutesDocumentForDownload(t, actor, randomUUID())),
      ).rejects.toBeInstanceOf(DocumentNotFoundError);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Exhibits — rules 14, 15, 16
// ═══════════════════════════════════════════════════════════════════════

describe("fetching an exhibit", () => {
  async function scenario(db: TestDb, town: TownFixture) {
    const own = await seedMeeting(db, town, town.boardId);
    const other = await seedMeeting(db, town, town.otherBoardId);
    return {
      ownItem: await seedAgendaItem(db, town, own),
      otherItem: await seedAgendaItem(db, town, other),
    };
  }

  it("keeps a board_only exhibit from a caller with neither a seat nor A3", async () => {
    await withTown(async ({ db, town }) => {
      const { ownItem } = await scenario(db, town);
      const exhibit = await seedExhibit(db, town, ownItem, "board_only");
      const { actor } = await seedActor(db, town, { role: "staff", global: ["A2"] });

      await expectRefusal(() => tx(db, town, (t) => resolveExhibitForDownload(t, actor, exhibit)), {
        code: "A3",
      });
    });
  });

  it("scopes A3 to the BOARD: A3 on one board does not open the other's board_only exhibit", async () => {
    // The case the required test list singles out. A rule that checked only
    // the visibility TIER would pass this actor on both exhibits, and the
    // difference would never show up in a test that used one board.
    await withTown(async ({ db, town }) => {
      const { ownItem, otherItem } = await scenario(db, town);
      const mine = await seedExhibit(db, town, ownItem, "board_only");
      const theirs = await seedExhibit(db, town, otherItem, "board_only");

      const { actor } = await seedActor(db, town, {
        role: "staff",
        boardOverrides: [{ boardId: town.boardId, permissions: { A3: true } }],
      });

      await expect(
        tx(db, town, (t) => resolveExhibitForDownload(t, actor, mine)),
      ).resolves.toBeTruthy();

      await expectRefusal(() => tx(db, town, (t) => resolveExhibitForDownload(t, actor, theirs)), {
        code: "A3",
      });
    });
  });

  it("opens a board_only exhibit to the board_member ROLE, on any board", async () => {
    // Deliberately asserted, because it looks like a scoping hole and is not
    // one: rule 14's board_only tier reads `get_current_role() =
    // 'board_member'`, which was never board-qualified. Written down here so a
    // future reader finds the decision rather than "re-discovering" it.
    await withTown(async ({ db, town }) => {
      const { otherItem } = await scenario(db, town);
      const exhibit = await seedExhibit(db, town, otherItem, "board_only");
      const { actor, personId } = await seedActor(db, town, { role: "board_member" });
      await seedBoardSeat(db, town, personId, town.boardId);

      await expect(
        tx(db, town, (t) => resolveExhibitForDownload(t, actor, exhibit)),
      ).resolves.toBeTruthy();
    });
  });

  it("keeps an admin_only exhibit from a board member — the tiers differ for a reason", async () => {
    // `admin_only` is where a staff memo about a personnel matter lands. If
    // the two tiers behaved alike there would be no point having two.
    await withTown(async ({ db, town }) => {
      const { ownItem } = await scenario(db, town);
      const exhibit = await seedExhibit(db, town, ownItem, "admin_only");
      const { actor, personId } = await seedActor(db, town, { role: "board_member" });
      await seedBoardSeat(db, town, personId, town.boardId);

      await expectRefusal(() => tx(db, town, (t) => resolveExhibitForDownload(t, actor, exhibit)), {
        code: "A3",
      });
    });
  });

  it("refuses to fetch a URL exhibit, rather than proxying or redirecting to it", async () => {
    // `file_storage_path` holds `https://…` for a link exhibit. Fetching it
    // server-side would be request forgery; redirecting to it would be an open
    // redirect. And `resolveWithin` would refuse the value anyway.
    await withTown(async ({ db, town }) => {
      const { ownItem } = await scenario(db, town);
      const exhibit = await seedExhibit(db, town, ownItem, "public", {
        fileType: "url",
        storagePath: "https://169.254.169.254/latest/meta-data/",
      });
      const { actor } = await seedActor(db, town, { role: "admin" });

      await expect(
        tx(db, town, (t) => resolveExhibitForDownload(t, actor, exhibit)),
      ).rejects.toBeInstanceOf(StoragePathError);
    });
  });

  it("answers NOT FOUND for another town's exhibit", async () => {
    await withTwoTownsAsAppRole(async ({ db, townA, townB }) => {
      const meetingB = await seedMeeting(db, townB, townB.boardId);
      const itemB = await seedAgendaItem(db, townB, meetingB);
      const exhibitB = await seedExhibit(db, townB, itemB, "public");

      const { actor } = await seedActor(db, townA, { role: "admin" });
      await expect(
        tx(db, townA, (t) => resolveExhibitForDownload(t, actor, exhibitB)),
      ).rejects.toBeInstanceOf(DocumentNotFoundError);
    });
  });
});

describe("uploading an exhibit", () => {
  it("stores the file and the row together, board-scoped on A3", async () => {
    await withTown(async ({ db, town }) => {
      const meetingId = await seedMeeting(db, town, town.boardId);
      const itemId = await seedAgendaItem(db, town, meetingId);
      const { actor } = await seedActor(db, town, {
        role: "staff",
        boardOverrides: [{ boardId: town.boardId, permissions: { A3: true } }],
      });

      const created = await tx(db, town, (t) =>
        createExhibitFromUpload(t, actor, {
          agendaItemId: itemId,
          title: "Budget",
          exhibitType: "supporting_document",
          visibility: "public",
          declaredContentType: "application/pdf",
          originalFilename: "budget.pdf",
          bytes: PDF,
        }),
      );

      expect(created.fileSize).toBe(PDF.byteLength);
      const stored = await tx(db, town, async (t) => {
        const rows = await t.execute(
          sql`SELECT file_storage_path FROM exhibit WHERE id = ${created.id}`,
        );
        return (rows as unknown as Array<{ file_storage_path: string }>)[0]!.file_storage_path;
      });
      expect(stored).toBe(`exhibits/${town.townId}/${itemId}/${created.id}.pdf`);
      expect(await fileExists(process.env.DOCUMENT_ROOT!, stored)).toBe(true);
    });
  });

  it("refuses a clerk holding A3 on a DIFFERENT board", async () => {
    await withTown(async ({ db, town }) => {
      const meetingId = await seedMeeting(db, town, town.otherBoardId);
      const itemId = await seedAgendaItem(db, town, meetingId);
      const { actor } = await seedActor(db, town, {
        role: "staff",
        boardOverrides: [{ boardId: town.boardId, permissions: { A3: true } }],
      });

      await expectRefusal(
        () =>
          tx(db, town, (t) =>
            createExhibitFromUpload(t, actor, {
              agendaItemId: itemId,
              title: "",
              exhibitType: null,
              visibility: "public",
              declaredContentType: "application/pdf",
              originalFilename: "x.pdf",
              bytes: PDF,
            }),
          ),
        { code: "A3" },
      );
    });
  });

  it("refuses a file whose bytes disagree with the type the client declared", async () => {
    await withTown(async ({ db, town }) => {
      const meetingId = await seedMeeting(db, town, town.boardId);
      const itemId = await seedAgendaItem(db, town, meetingId);
      const { actor } = await seedActor(db, town, { role: "admin" });

      await expect(
        tx(db, town, (t) =>
          createExhibitFromUpload(t, actor, {
            agendaItemId: itemId,
            title: "",
            exhibitType: null,
            visibility: "public",
            declaredContentType: "application/pdf",
            originalFilename: "notreally.pdf",
            bytes: Buffer.from("<html><script>alert(1)</script></html>"),
          }),
        ),
      ).rejects.toBeInstanceOf(StoragePathError);
    });
  });

  it("enforces the 5 MB limit on the server, not only in the component", async () => {
    await withTown(async ({ db, town }) => {
      const meetingId = await seedMeeting(db, town, town.boardId);
      const itemId = await seedAgendaItem(db, town, meetingId);
      const { actor } = await seedActor(db, town, { role: "admin" });

      const oversized = Buffer.concat([PDF, Buffer.alloc(MAX_UPLOAD_BYTES)]);
      const err = await tx(db, town, (t) =>
        createExhibitFromUpload(t, actor, {
          agendaItemId: itemId,
          title: "",
          exhibitType: null,
          visibility: "public",
          declaredContentType: "application/pdf",
          originalFilename: "big.pdf",
          bytes: oversized,
        }),
      ).catch((e: unknown) => e);

      expect(err).toBeInstanceOf(StoragePathError);
      expect((err as Error).message).toContain("5 MB");
    });
  });

  it("leaves no orphaned file when the row cannot be inserted", async () => {
    // The owner's replace-not-versioned decision makes the ordering matter:
    // file first (so the old bytes are never removed before the new ones are
    // durable), row second, and a failed row deletes the file it wrote.
    await withTown(async ({ db, town }) => {
      const meetingId = await seedMeeting(db, town, town.boardId);
      const itemId = await seedAgendaItem(db, town, meetingId);
      const { actor } = await seedActor(db, town, { role: "admin" });

      const before = await countFiles(path.join(tempRoot, "documents"));
      await expect(
        tx(db, town, (t) =>
          createExhibitFromUpload(t, actor, {
            agendaItemId: itemId,
            title: "x",
            exhibitType: null,
            // An enum value the database will reject, so the INSERT fails
            // after the file is already on disk.
            visibility: "not_a_visibility" as never,
            declaredContentType: "application/pdf",
            originalFilename: "x.pdf",
            bytes: PDF,
          }),
        ),
      ).rejects.toBeTruthy();

      expect(await countFiles(path.join(tempRoot, "documents"))).toBe(before);
    });
  });
});

describe("deleting an exhibit", () => {
  it("requires A3 for that board — a board member may upload, not curate", async () => {
    await withTown(async ({ db, town }) => {
      const meetingId = await seedMeeting(db, town, town.boardId);
      const itemId = await seedAgendaItem(db, town, meetingId);
      const exhibit = await seedExhibit(db, town, itemId, "public");
      const { actor, personId } = await seedActor(db, town, { role: "board_member" });
      await seedBoardSeat(db, town, personId, town.boardId);

      await expectRefusal(() => tx(db, town, (t) => deleteExhibit(t, actor, exhibit)), {
        code: "A3",
      });
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════
// The town seal — the public root
// ═══════════════════════════════════════════════════════════════════════

describe("the town seal", () => {
  it("is admin-gated, and points seal_url at the one public prefix", async () => {
    await withTown(async ({ db, town }) => {
      const { actor } = await seedActor(db, town, { role: "admin" });
      const result = await tx(db, town, (t) => setTownSeal(t, actor, PNG));

      expect(result.sealUrl).toBe(`/public-assets/seals/${town.townId}.png`);
      expect(result.relativePath).toBe(`seals/${town.townId}.png`);
      expect(await fileExists(process.env.PUBLIC_ASSET_ROOT!, result.relativePath)).toBe(true);

      const stored = await tx(db, town, async (t) => {
        const rows = await t.execute(sql`SELECT seal_url FROM town WHERE id = ${town.townId}`);
        return (rows as unknown as Array<{ seal_url: string | null }>)[0]!.seal_url;
      });
      expect(stored).toBe(result.sealUrl);
    });
  });

  it("refuses a staff account holding every delegable permission", async () => {
    // `assertCanUpdateTown` is an ADMIN gate, not a code check: there is no
    // action code that grants editing the town record, so an actor with a
    // maximal matrix must still be refused.
    await withTown(async ({ db, town }) => {
      const { actor } = await seedActor(db, town, {
        role: "staff",
        global: ["A1", "A2", "A3", "M1", "R1", "R4", "C2"],
      });
      await expectRefusal(() => tx(db, town, (t) => setTownSeal(t, actor, PNG)));
      await expectRefusal(() => tx(db, town, (t) => clearTownSeal(t, actor)));
    });
  });

  it("refuses anything that is not a PNG or a JPEG, by its bytes", async () => {
    await withTown(async ({ db, town }) => {
      const { actor } = await seedActor(db, town, { role: "admin" });
      const publicFilesBefore = await countFiles(path.join(tempRoot, "public"));
      for (const payload of [
        Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>x</script></svg>'),
        Buffer.from("%PDF-1.7\n"),
        Buffer.from("<html><script>alert(1)</script>"),
      ]) {
        await expect(tx(db, town, (t) => setTownSeal(t, actor, payload))).rejects.toBeInstanceOf(
          StoragePathError,
        );
      }
      // …and nothing landed in the one directory nginx serves unguarded.
      // Counted as a delta, not against zero: the roots are shared across
      // every test in this file, and legitimate seals from other cases live
      // there too. What must be true is that a REFUSED upload adds nothing.
      expect(await countFiles(path.join(tempRoot, "public"))).toBe(publicFilesBefore);
    });
  });

  it("names the superseded file when the extension changes, so it can be swept", async () => {
    // Replace, not versioned. The sweep list is returned rather than deleted
    // inside the transaction: the old bytes go only after the row commits.
    await withTown(async ({ db, town }) => {
      const { actor } = await seedActor(db, town, { role: "admin" });
      const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

      const first = await tx(db, town, (t) => setTownSeal(t, actor, jpeg));
      expect(first.relativePath).toBe(`seals/${town.townId}.jpg`);

      const second = await tx(db, town, (t) => setTownSeal(t, actor, PNG));
      expect(second.relativePath).toBe(`seals/${town.townId}.png`);
      expect(second.supersededPaths).toEqual([`seals/${town.townId}.jpg`]);
      // The superseded file is still on disk at this point — deleting it is
      // the caller's post-commit step, and that ordering is the point.
      expect(await fileExists(process.env.PUBLIC_ASSET_ROOT!, first.relativePath)).toBe(true);
    });
  });

  it("takes the town from the ACTOR, so a caller cannot name another town's seal", async () => {
    await withTwoTownsAsAppRole(async ({ db, townA, townB }) => {
      const { actor } = await seedActor(db, townA, { role: "admin" });

      const result = await tx(db, townA, (t) => setTownSeal(t, actor, PNG));
      expect(result.relativePath).toContain(townA.townId);
      expect(result.relativePath).not.toContain(townB.townId);

      const townBSeal = await tx(db, townB, async (t) => {
        const rows = await t.execute(sql`SELECT seal_url FROM town WHERE id = ${townB.townId}`);
        return (rows as unknown as Array<{ seal_url: string | null }>)[0]!.seal_url;
      });
      expect(townBSeal).toBeNull();
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════
// The public root's standing invariant
// ═══════════════════════════════════════════════════════════════════════

describe("nothing but a seal reaches the public asset root", () => {
  it("holds only seals/<townId>.(png|jpg) after every operation in this file", async () => {
    // Not a unit test of one function — a sweep of the whole tree, after the
    // uploads, refusals and replacements above have all run against it. If any
    // code path anywhere put a non-seal in the public root, this is what
    // notices.
    const files = await listFiles(path.join(tempRoot, "public"));
    for (const relative of files) {
      expect(relative).toMatch(
        /^seals\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg)$/,
      );
    }
    // And the seal writer never wrote anything into the document root.
    const documents = await listFiles(path.join(tempRoot, "documents"));
    for (const relative of documents) {
      expect(relative.startsWith("seals/")).toBe(false);
    }
  });

  it("has no writer that accepts a caller-supplied path", async () => {
    // The structural half of the guarantee: `setTownSeal` takes bytes and
    // nothing else — there is no argument through which a path could arrive.
    // `paths.ts` exports exactly one builder for this root, and it assembles
    // `seals/<uuid>.<ext>` from a validated UUID and a sniffed extension.
    const module = await import("../documents.js");
    expect(module.setTownSeal.length).toBeLessThanOrEqual(4);
    const paths = await import("../paths.js");
    const publicBuilders = Object.keys(paths).filter((k) => k.toLowerCase().includes("seal"));
    // Every export naming the public root is about seals. Nothing else has a
    // way to address it.
    expect(publicBuilders.sort()).toEqual(
      [
        "SEAL_CONTENT_TYPES",
        "SEAL_EXTENSIONS",
        "absoluteSealUrl",
        "allSealRelativePaths",
        "sealExtensionFor",
        "sealRelativePath",
        "sealUrlFor",
      ].sort(),
    );
  });
});

// ─── Helpers ──────────────────────────────────────────────────────────

async function listFiles(root: string, prefix = ""): Promise<string[]> {
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const entry of entries) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...(await listFiles(path.join(root, entry.name), relative)));
    else out.push(relative);
  }
  return out;
}

async function countFiles(root: string): Promise<number> {
  return (await listFiles(root)).length;
}
