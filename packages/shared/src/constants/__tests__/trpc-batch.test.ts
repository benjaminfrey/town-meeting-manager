import { describe, expect, it } from "vitest";
import { TRPC_BATCH_PATH_LENGTH_LIMIT, TRPC_BATCH_URL_LIMIT } from "../trpc-batch.js";

/**
 * The invariant that actually matters, one level above either constant's own
 * value — added in the single fix wave after wave 5's whole-branch review
 * (finding M1), which found the CLIENT half of this pair completely
 * unpinned: `packages/web/src/lib/trpc.ts:95`'s
 * `maxURLLength: TRPC_BATCH_URL_LIMIT` (and its import) could be deleted with
 * web green, typecheck green, and lint clean.
 *
 * `../trpc-batch.ts`'s own header states the relationship in prose — the
 * client bound is "deliberately set to trip well before the server bound
 * could ever be reached" — but nothing in the repository checked it. If
 * `TRPC_BATCH_URL_LIMIT` ever grows to meet or exceed
 * `TRPC_BATCH_PATH_LENGTH_LIMIT`, the client stops splitting a batch before
 * the server's Fastify `maxParamLength` would refuse it, and the exact 404
 * `packages/api/src/trpc/__tests__/http-batch.test.ts` exists to pin comes
 * back — just later, once a batch grows past whichever bound is smaller.
 *
 * This says nothing about either constant's absolute size (that argument is
 * `trpc-batch.ts`'s own doc comment's job); it says only that the ordering
 * between them can never invert.
 */
describe("the tRPC batch bounds (Phase E, wave 5 fix wave — finding M1)", () => {
  it("keeps the client's batch-URL cap strictly below the server's batch-path cap", () => {
    expect(TRPC_BATCH_URL_LIMIT).toBeLessThan(TRPC_BATCH_PATH_LENGTH_LIMIT);
  });
});
