/**
 * `agendaTemplate.*` — reads scoped by board, writes scoped by template,
 * all admin-gated except the reads (tenancy-only, matching `board.ts`).
 *
 * Every cross-tenant case runs through `connectAsAppRole`, wrapped with
 * `testDb()` into the same Drizzle handle `seedTown`/`seedActor`/`contextFor`
 * expect — the owner connection `withTestDb` hands back is a superuser and
 * RLS does not bind it, so a cross-tenant assertion on that handle would pass
 * with RLS switched off entirely. See `board.test.ts`'s own header for the
 * same discipline, applied identically here.
 */

import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { withTestDb, connectAsAppRole } from "../../../test/db-harness.js";
import {
  seedTown,
  seedActor,
  contextFor,
  seedBoard,
  testDb,
  inTown,
  expectTrpcError,
  type TestDb,
  type TownFixture,
} from "../../__tests__/fixtures.js";
import { appRouter } from "../../router.js";
import { toRows } from "../../../db/rows.js";
import type { AgendaTemplateSection } from "@town-meeting/shared";

/** A minimal, schema-valid section array — one fixed section. */
function sampleSections(title = "Call to Order"): AgendaTemplateSection[] {
  return [
    {
      title,
      sort_order: 0,
      section_type: "procedural",
      is_fixed: true,
      description: null,
      default_items: [],
      minutes_behavior: "timestamp_only",
      show_item_commentary: false,
    },
  ];
}

interface RawTemplateRow {
  id: string;
  board_id: string;
  name: string;
  is_default: boolean;
  sections: unknown;
}

/** Insert a template directly, bypassing the router, for test setup. */
async function seedTemplate(
  db: TestDb,
  town: TownFixture,
  boardId: string,
  opts: { name: string; isDefault?: boolean; sections?: unknown[] },
): Promise<string> {
  const id = randomUUID();
  const sectionsJson = JSON.stringify(opts.sections ?? sampleSections());
  await inTown(db, town, async (tx) => {
    await tx.execute(sql`
      INSERT INTO agenda_template (id, board_id, town_id, name, is_default, sections)
      VALUES (${id}, ${boardId}, ${town.townId}, ${opts.name}, ${opts.isDefault ?? false},
              ${sectionsJson}::jsonb)
    `);
  });
  return id;
}

async function readTemplate(
  db: TestDb,
  town: TownFixture,
  templateId: string,
): Promise<RawTemplateRow | null> {
  const rows = await inTown(db, town, (tx) =>
    tx
      .execute(
        sql`
        SELECT id, board_id, name, is_default, sections
        FROM agenda_template WHERE id = ${templateId}
      `,
      )
      .then((r) => toRows<RawTemplateRow>(r, (m) => new Error(m))),
  );
  return rows[0] ?? null;
}

async function countTemplatesForBoard(
  db: TestDb,
  town: TownFixture,
  boardId: string,
): Promise<number> {
  const rows = await inTown(db, town, (tx) =>
    tx
      .execute(sql`SELECT count(*)::int AS count FROM agenda_template WHERE board_id = ${boardId}`)
      .then((r) => toRows<{ count: number }>(r, (m) => new Error(m))),
  );
  return rows[0]?.count ?? 0;
}

describe("agendaTemplate.list", () => {
  it("returns a board's templates, defaults first then alphabetically", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const boardId = await seedBoard(db, town, { name: "Assessors" });
        await seedTemplate(db, town, boardId, { name: "Zoning Special", isDefault: false });
        const defaultId = await seedTemplate(db, town, boardId, {
          name: "Alpha Regular",
          isDefault: true,
        });
        const actor = await seedActor(db, town, { role: "staff", global: [] });

        const caller = appRouter.createCaller(contextFor(db, town, actor));
        const rows = await caller.agendaTemplate.list({ boardId });

        expect(rows.map((r) => r.id)).toEqual([defaultId, expect.any(String)]);
        expect(rows[0]?.is_default).toBe(true);
        expect(rows[1]?.name).toBe("Zoning Special");
      } finally {
        await app.end();
      }
    });
  });

  it("does not return another board's templates", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const boardId = await seedBoard(db, town, { name: "Assessors" });
        const otherBoardId = await seedBoard(db, town, { name: "Zoning Board" });
        await seedTemplate(db, town, otherBoardId, { name: "Not This Board's" });
        const actor = await seedActor(db, town, { role: "staff", global: [] });

        const caller = appRouter.createCaller(contextFor(db, town, actor));
        const rows = await caller.agendaTemplate.list({ boardId });

        expect(rows).toEqual([]);
      } finally {
        await app.end();
      }
    });
  });

  it("answers NOT_FOUND for a board in another town, rather than a convincing empty list", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const mine = await seedTown(db, "Newcastle");
        const theirs = await seedTown(db, "Bristol");
        const foreign = await seedBoard(db, theirs, { name: "Their Board" });
        const actor = await seedActor(db, mine, { role: "staff", global: [] });

        const caller = appRouter.createCaller(contextFor(db, mine, actor));
        await expect(caller.agendaTemplate.list({ boardId: foreign })).rejects.toThrow(/NOT_FOUND/);
      } finally {
        await app.end();
      }
    });
  });

  it("answers NOT_FOUND for a board id that never existed", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const actor = await seedActor(db, town, { role: "staff", global: [] });

        const caller = appRouter.createCaller(contextFor(db, town, actor));
        await expect(caller.agendaTemplate.list({ boardId: randomUUID() })).rejects.toThrow(
          /NOT_FOUND/,
        );
      } finally {
        await app.end();
      }
    });
  });
});

describe("agendaTemplate.detail", () => {
  it("returns a template of the caller's own town", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const boardId = await seedBoard(db, town, { name: "Assessors" });
        const templateId = await seedTemplate(db, town, boardId, { name: "Regular Meeting" });
        const actor = await seedActor(db, town, { role: "staff", global: [] });

        const caller = appRouter.createCaller(contextFor(db, town, actor));
        const template = await caller.agendaTemplate.detail({ templateId });

        expect(template.name).toBe("Regular Meeting");
        expect(template.sections).toEqual(sampleSections());
      } finally {
        await app.end();
      }
    });
  });

  it("answers NOT_FOUND for a template in another town", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const mine = await seedTown(db, "Newcastle");
        const theirs = await seedTown(db, "Bristol");
        const theirBoard = await seedBoard(db, theirs, { name: "Their Board" });
        const theirTemplate = await seedTemplate(db, theirs, theirBoard, { name: "Theirs" });
        const actor = await seedActor(db, mine, { role: "staff", global: [] });

        const caller = appRouter.createCaller(contextFor(db, mine, actor));
        await expect(caller.agendaTemplate.detail({ templateId: theirTemplate })).rejects.toThrow(
          /NOT_FOUND/,
        );
      } finally {
        await app.end();
      }
    });
  });

  it("answers NOT_FOUND for an id that never existed", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const actor = await seedActor(db, town, { role: "staff", global: [] });

        const caller = appRouter.createCaller(contextFor(db, town, actor));
        await expect(caller.agendaTemplate.detail({ templateId: randomUUID() })).rejects.toThrow(
          /NOT_FOUND/,
        );
      } finally {
        await app.end();
      }
    });
  });
});

describe("agendaTemplate.countForBoard", () => {
  it("counts a board's templates", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const boardId = await seedBoard(db, town, { name: "Assessors" });
        await seedTemplate(db, town, boardId, { name: "One" });
        await seedTemplate(db, town, boardId, { name: "Two" });
        const actor = await seedActor(db, town, { role: "staff", global: [] });

        const caller = appRouter.createCaller(contextFor(db, town, actor));
        const count = await caller.agendaTemplate.countForBoard({ boardId });

        expect(count).toBe(2);
        expect(typeof count).toBe("number");
      } finally {
        await app.end();
      }
    });
  });

  it("answers NOT_FOUND for a board in another town, rather than a convincing 0", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const mine = await seedTown(db, "Newcastle");
        const theirs = await seedTown(db, "Bristol");
        const foreign = await seedBoard(db, theirs, { name: "Their Board" });
        const actor = await seedActor(db, mine, { role: "staff", global: [] });

        const caller = appRouter.createCaller(contextFor(db, mine, actor));
        await expect(caller.agendaTemplate.countForBoard({ boardId: foreign })).rejects.toThrow(
          /NOT_FOUND/,
        );
      } finally {
        await app.end();
      }
    });
  });
});

describe("agendaTemplate.insert", () => {
  it("refuses a caller who is not an administrator, and writes nothing", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const boardId = await seedBoard(db, town, { name: "Assessors" });

        for (const role of ["staff", "board_member"] as const) {
          const actor = await seedActor(db, town, { role, global: [] });
          const caller = appRouter.createCaller(contextFor(db, town, actor));
          const err = await expectTrpcError(() =>
            caller.agendaTemplate.insert({
              boardId,
              name: "New Template",
              sections: sampleSections(),
            }),
          );
          expect([role, err.code]).toEqual([role, "FORBIDDEN"]);
        }

        expect(await countTemplatesForBoard(db, town, boardId)).toBe(0);
      } finally {
        await app.end();
      }
    });
  });

  it("answers FORBIDDEN even when a refused caller's input also fails validation (the reorder pin)", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const actor = await seedActor(db, town, { role: "staff", global: [] });
        const caller = appRouter.createCaller(contextFor(db, town, actor));

        // `boardId` fails `.uuid()` at parse time.
        const err = await expectTrpcError(() =>
          caller.agendaTemplate.insert({
            boardId: "not-a-uuid",
            name: "New Template",
            sections: sampleSections(),
          }),
        );
        expect(err.code).toBe("FORBIDDEN");
      } finally {
        await app.end();
      }
    });
  });

  it("lets an administrator create a template with the sections it sends", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const boardId = await seedBoard(db, town, { name: "Assessors" });
        const admin = await seedActor(db, town, { role: "admin" });
        const caller = appRouter.createCaller(contextFor(db, town, admin));

        const sections = sampleSections("Public Comment");
        const result = await caller.agendaTemplate.insert({
          boardId,
          name: "Special Meeting",
          sections,
        });
        expect(result.name).toBe("Special Meeting");

        const row = await readTemplate(db, town, result.id);
        expect(row).toMatchObject({
          board_id: boardId,
          name: "Special Meeting",
          is_default: false,
        });
        expect(row?.sections).toEqual(sections);
      } finally {
        await app.end();
      }
    });
  });

  /**
   * The FK-bypasses-RLS hazard conventions item 3 names directly, reproduced
   * for `agenda_template.board_id` the same way it was first found for
   * `person.insertStaffAccount`'s `personId` in wave 1: without
   * `assertBoardExists`, `agenda_template_board_id_fkey` alone would let this
   * write succeed against another town's board, creating a row invisible to
   * the town it actually landed on and permanently orphaned there.
   */
  it("answers NOT_FOUND for a boardId belonging to another town, and creates no row", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const mine = await seedTown(db, "Newcastle");
        const theirs = await seedTown(db, "Bristol");
        const foreignBoard = await seedBoard(db, theirs, { name: "Their Board" });
        const admin = await seedActor(db, mine, { role: "admin" });
        const caller = appRouter.createCaller(contextFor(db, mine, admin));

        const err = await expectTrpcError(() =>
          caller.agendaTemplate.insert({
            boardId: foreignBoard,
            name: "Hijacked Template",
            sections: sampleSections(),
          }),
        );
        expect(err.code).toBe("NOT_FOUND");
        expect(await countTemplatesForBoard(db, theirs, foreignBoard)).toBe(0);
      } finally {
        await app.end();
      }
    });
  });

  it("answers CONFLICT for a name already used on the same board, and writes nothing new", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const boardId = await seedBoard(db, town, { name: "Assessors" });
        await seedTemplate(db, town, boardId, { name: "Regular Meeting" });
        const admin = await seedActor(db, town, { role: "admin" });
        const caller = appRouter.createCaller(contextFor(db, town, admin));

        const err = await expectTrpcError(() =>
          caller.agendaTemplate.insert({
            boardId,
            name: "Regular Meeting",
            sections: sampleSections(),
          }),
        );
        expect(err.code).toBe("CONFLICT");
        expect(await countTemplatesForBoard(db, town, boardId)).toBe(1);
      } finally {
        await app.end();
      }
    });
  });
});

describe("agendaTemplate.update", () => {
  it("refuses a caller who is not an administrator, and writes nothing", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const boardId = await seedBoard(db, town, { name: "Assessors" });
        const templateId = await seedTemplate(db, town, boardId, { name: "Regular Meeting" });

        for (const role of ["staff", "board_member"] as const) {
          const actor = await seedActor(db, town, { role, global: [] });
          const caller = appRouter.createCaller(contextFor(db, town, actor));
          const err = await expectTrpcError(() =>
            caller.agendaTemplate.update({
              templateId,
              name: "Renamed",
              sections: sampleSections("Different"),
            }),
          );
          expect([role, err.code]).toEqual([role, "FORBIDDEN"]);
        }

        const row = await readTemplate(db, town, templateId);
        expect(row?.name).toBe("Regular Meeting");
      } finally {
        await app.end();
      }
    });
  });

  it("answers FORBIDDEN even when a refused caller's input also fails validation (the reorder pin)", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const actor = await seedActor(db, town, { role: "staff", global: [] });
        const caller = appRouter.createCaller(contextFor(db, town, actor));

        // `templateId` fails `.uuid()` at parse time.
        const err = await expectTrpcError(() =>
          caller.agendaTemplate.update({
            templateId: "not-a-uuid",
            name: "Renamed",
            sections: sampleSections(),
          }),
        );
        expect(err.code).toBe("FORBIDDEN");
      } finally {
        await app.end();
      }
    });
  });

  it("lets an administrator rename a template and replace its sections", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const boardId = await seedBoard(db, town, { name: "Assessors" });
        const templateId = await seedTemplate(db, town, boardId, { name: "Regular Meeting" });
        const admin = await seedActor(db, town, { role: "admin" });
        const caller = appRouter.createCaller(contextFor(db, town, admin));

        const newSections = sampleSections("New Business");
        const result = await caller.agendaTemplate.update({
          templateId,
          name: "Special Meeting",
          sections: newSections,
        });
        expect(result.name).toBe("Special Meeting");

        const row = await readTemplate(db, town, templateId);
        expect(row?.name).toBe("Special Meeting");
        expect(row?.sections).toEqual(newSections);
      } finally {
        await app.end();
      }
    });
  });

  it("answers NOT_FOUND for a template in another town, and writes nothing", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const mine = await seedTown(db, "Newcastle");
        const theirs = await seedTown(db, "Bristol");
        const theirBoard = await seedBoard(db, theirs, { name: "Their Board" });
        const theirTemplate = await seedTemplate(db, theirs, theirBoard, { name: "Theirs" });
        const admin = await seedActor(db, mine, { role: "admin" });
        const caller = appRouter.createCaller(contextFor(db, mine, admin));

        const err = await expectTrpcError(() =>
          caller.agendaTemplate.update({
            templateId: theirTemplate,
            name: "Hijacked",
            sections: sampleSections(),
          }),
        );
        expect(err.code).toBe("NOT_FOUND");

        const row = await readTemplate(db, theirs, theirTemplate);
        expect(row?.name).toBe("Theirs");
      } finally {
        await app.end();
      }
    });
  });

  it("answers CONFLICT when renaming to a name already used on the same board, and writes nothing", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const boardId = await seedBoard(db, town, { name: "Assessors" });
        await seedTemplate(db, town, boardId, { name: "Regular Meeting" });
        const templateId = await seedTemplate(db, town, boardId, { name: "Special Meeting" });
        const admin = await seedActor(db, town, { role: "admin" });
        const caller = appRouter.createCaller(contextFor(db, town, admin));

        const err = await expectTrpcError(() =>
          caller.agendaTemplate.update({
            templateId,
            name: "Regular Meeting",
            sections: sampleSections(),
          }),
        );
        expect(err.code).toBe("CONFLICT");

        const row = await readTemplate(db, town, templateId);
        expect(row?.name).toBe("Special Meeting");
      } finally {
        await app.end();
      }
    });
  });
});

describe("agendaTemplate.setDefault", () => {
  it("refuses a caller who is not an administrator, and writes nothing", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const boardId = await seedBoard(db, town, { name: "Assessors" });
        const defaultId = await seedTemplate(db, town, boardId, {
          name: "Regular",
          isDefault: true,
        });
        const otherId = await seedTemplate(db, town, boardId, { name: "Special" });

        for (const role of ["staff", "board_member"] as const) {
          const actor = await seedActor(db, town, { role, global: [] });
          const caller = appRouter.createCaller(contextFor(db, town, actor));
          const err = await expectTrpcError(() =>
            caller.agendaTemplate.setDefault({ templateId: otherId }),
          );
          expect([role, err.code]).toEqual([role, "FORBIDDEN"]);
        }

        expect((await readTemplate(db, town, defaultId))?.is_default).toBe(true);
        expect((await readTemplate(db, town, otherId))?.is_default).toBe(false);
      } finally {
        await app.end();
      }
    });
  });

  it("answers FORBIDDEN even when a refused caller's input also fails validation (the reorder pin)", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const actor = await seedActor(db, town, { role: "staff", global: [] });
        const caller = appRouter.createCaller(contextFor(db, town, actor));

        const err = await expectTrpcError(() =>
          caller.agendaTemplate.setDefault({ templateId: "not-a-uuid" }),
        );
        expect(err.code).toBe("FORBIDDEN");
      } finally {
        await app.end();
      }
    });
  });

  it("atomically swaps the default within a board, never leaving zero or two", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const boardId = await seedBoard(db, town, { name: "Assessors" });
        const oldDefault = await seedTemplate(db, town, boardId, {
          name: "Regular",
          isDefault: true,
        });
        const newDefault = await seedTemplate(db, town, boardId, { name: "Special" });
        const admin = await seedActor(db, town, { role: "admin" });
        const caller = appRouter.createCaller(contextFor(db, town, admin));

        const result = await caller.agendaTemplate.setDefault({ templateId: newDefault });
        expect(result.is_default).toBe(true);

        expect((await readTemplate(db, town, oldDefault))?.is_default).toBe(false);
        expect((await readTemplate(db, town, newDefault))?.is_default).toBe(true);
      } finally {
        await app.end();
      }
    });
  });

  it("does not disturb a DIFFERENT board's default", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const boardA = await seedBoard(db, town, { name: "Assessors" });
        const boardB = await seedBoard(db, town, { name: "Zoning Board" });
        const aDefault = await seedTemplate(db, town, boardA, {
          name: "A Regular",
          isDefault: true,
        });
        const bDefault = await seedTemplate(db, town, boardB, {
          name: "B Regular",
          isDefault: true,
        });
        const aOther = await seedTemplate(db, town, boardA, { name: "A Special" });
        const admin = await seedActor(db, town, { role: "admin" });
        const caller = appRouter.createCaller(contextFor(db, town, admin));

        await caller.agendaTemplate.setDefault({ templateId: aOther });

        expect((await readTemplate(db, town, aDefault))?.is_default).toBe(false);
        expect((await readTemplate(db, town, aOther))?.is_default).toBe(true);
        // Board B's default is untouched by the WHERE clause scoping to
        // board A's rows only.
        expect((await readTemplate(db, town, bDefault))?.is_default).toBe(true);
      } finally {
        await app.end();
      }
    });
  });

  it("answers NOT_FOUND for a template in another town, and changes nothing", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const mine = await seedTown(db, "Newcastle");
        const theirs = await seedTown(db, "Bristol");
        const theirBoard = await seedBoard(db, theirs, { name: "Their Board" });
        const theirDefault = await seedTemplate(db, theirs, theirBoard, {
          name: "Theirs",
          isDefault: true,
        });
        const admin = await seedActor(db, mine, { role: "admin" });
        const caller = appRouter.createCaller(contextFor(db, mine, admin));

        const err = await expectTrpcError(() =>
          caller.agendaTemplate.setDefault({ templateId: theirDefault }),
        );
        expect(err.code).toBe("NOT_FOUND");
        expect((await readTemplate(db, theirs, theirDefault))?.is_default).toBe(true);
      } finally {
        await app.end();
      }
    });
  });
});

describe("agendaTemplate.delete", () => {
  it("refuses a caller who is not an administrator, and writes nothing", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const boardId = await seedBoard(db, town, { name: "Assessors" });
        const templateId = await seedTemplate(db, town, boardId, { name: "Regular Meeting" });

        for (const role of ["staff", "board_member"] as const) {
          const actor = await seedActor(db, town, { role, global: [] });
          const caller = appRouter.createCaller(contextFor(db, town, actor));
          const err = await expectTrpcError(() => caller.agendaTemplate.delete({ templateId }));
          expect([role, err.code]).toEqual([role, "FORBIDDEN"]);
        }

        expect(await readTemplate(db, town, templateId)).not.toBeNull();
      } finally {
        await app.end();
      }
    });
  });

  it("answers FORBIDDEN even when a refused caller's input also fails validation (the reorder pin)", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const actor = await seedActor(db, town, { role: "staff", global: [] });
        const caller = appRouter.createCaller(contextFor(db, town, actor));

        const err = await expectTrpcError(() =>
          caller.agendaTemplate.delete({ templateId: "not-a-uuid" }),
        );
        expect(err.code).toBe("FORBIDDEN");
      } finally {
        await app.end();
      }
    });
  });

  it("lets an administrator delete a template", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const boardId = await seedBoard(db, town, { name: "Assessors" });
        const templateId = await seedTemplate(db, town, boardId, { name: "Regular Meeting" });
        const admin = await seedActor(db, town, { role: "admin" });
        const caller = appRouter.createCaller(contextFor(db, town, admin));

        const result = await caller.agendaTemplate.delete({ templateId });
        expect(result.id).toBe(templateId);

        expect(await readTemplate(db, town, templateId)).toBeNull();
      } finally {
        await app.end();
      }
    });
  });

  it("answers NOT_FOUND for a template in another town, and deletes nothing", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const mine = await seedTown(db, "Newcastle");
        const theirs = await seedTown(db, "Bristol");
        const theirBoard = await seedBoard(db, theirs, { name: "Their Board" });
        const theirTemplate = await seedTemplate(db, theirs, theirBoard, { name: "Theirs" });
        const admin = await seedActor(db, mine, { role: "admin" });
        const caller = appRouter.createCaller(contextFor(db, mine, admin));

        const err = await expectTrpcError(() =>
          caller.agendaTemplate.delete({ templateId: theirTemplate }),
        );
        expect(err.code).toBe("NOT_FOUND");
        expect(await readTemplate(db, theirs, theirTemplate)).not.toBeNull();
      } finally {
        await app.end();
      }
    });
  });

  it("answers NOT_FOUND for an id that never existed", async () => {
    await withTestDb(async (client) => {
      const app = await connectAsAppRole(client);
      try {
        const db = testDb(app);
        const town = await seedTown(db);
        const admin = await seedActor(db, town, { role: "admin" });
        const caller = appRouter.createCaller(contextFor(db, town, admin));

        const err = await expectTrpcError(() =>
          caller.agendaTemplate.delete({ templateId: randomUUID() }),
        );
        expect(err.code).toBe("NOT_FOUND");
      } finally {
        await app.end();
      }
    });
  });
});
