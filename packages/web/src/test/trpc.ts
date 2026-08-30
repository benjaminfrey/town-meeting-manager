/**
 * The tRPC test harness — mock the TRANSPORT, not the options proxy.
 *
 * Phase E, unit 0, task 5. This file exists because of a specific, measured
 * failure in the way task 4's screen test was written.
 *
 * That test did `vi.mock("@/lib/trpc", () => ({ trpc: { board: { detail: {
 * queryOptions: () => ({ queryKey: ["board.detail", input], queryFn: ... })
 * }}}}))`. Two things follow from replacing the proxy itself:
 *
 *  1. **The query keys are invented by the test.** `["board.detail", input]`
 *     is not the key the real proxy produces, so no test written that way can
 *     assert that a writer's `invalidateQueries(trpc.board.pathFilter())`
 *     reaches the screen's read. A reviewer deleted `NoticeTemplateEditor`'s
 *     `pathFilter()` call and ran the whole suite: 940 tests, nothing red.
 *  2. **Nothing binds the payload to the router.** Renaming `name` to `nayme`
 *     inside that mock left `tsc --noEmit` at exit 0, because the mock's
 *     return type was inferred from the mock. Any column the assertions do
 *     not name could drift from the procedure with typecheck and tests both
 *     green.
 *
 * `installTRPCFetchStub` fixes both by leaving `@/lib/trpc` entirely alone.
 * The real `createTRPCClient` / `createTRPCOptionsProxy` run, so real query
 * keys are produced and `trpc.<router>.pathFilter()` really matches them; the
 * only thing replaced is `globalThis.fetch`, which is the actual boundary
 * between the app and the API. And `TestHandlers` is keyed by `AppRouter`'s
 * own flattened procedure paths, so a handler for a procedure that does not
 * exist (`"board.statz"`), or a payload missing a column the procedure
 * selects (`nayme` for `name`), is a compile error. Both were confirmed by
 * mutation, not assumed.
 */

import { afterEach, beforeEach, expect, vi } from "vitest";
import type { AnyProcedure, inferProcedureInput, inferProcedureOutput } from "@trpc/server";
import type { AppRouter } from "@town-meeting/api/trpc/router";

type UnionToIntersection<U> = (U extends unknown ? (k: U) => void : never) extends (
  k: infer I,
) => void
  ? I
  : never;

/**
 * Flatten the router tree into `{ "board.detail": <procedure>, ... }`.
 *
 * `AppRouter["_def"]["procedures"]` is nested at the TYPE level — its keys are
 * `board`, `town`, `whoami`, `permissions`, with sub-routers as values —
 * even though at RUNTIME the same object is keyed by dotted path (which is
 * what `packages/api/src/trpc/__tests__/router-wiring.test.ts` walks, and why
 * that file needs a cast to index it by string). Using the unflattened type
 * here still COMPILES — `board` is there as a key, `inferProcedureInput` of a
 * sub-router is `never`, and the handler map would accept nothing and check
 * nothing. That is exactly the class of silently-vacuous type this file
 * exists to stop, and it was caught by mutating a payload and finding the
 * error message named `board` rather than `board.detail`.
 *
 * A sub-router survives into this map as its bare record of children (see
 * `DecorateCreateRouterOptions`), not as a `Router`, so the discriminator is
 * "is this a procedure", not "is this a router".
 */
type FlattenProcedures<TRecord, TPrefix extends string = ""> = UnionToIntersection<
  {
    [K in keyof TRecord & string]: TRecord[K] extends AnyProcedure
      ? { [Key in `${TPrefix}${K}`]: TRecord[K] }
      : FlattenProcedures<TRecord[K], `${TPrefix}${K}.`>;
  }[keyof TRecord & string]
>;

/** Every procedure on the root router, keyed by its dotted name. */
type Procedures = FlattenProcedures<AppRouter["_def"]["procedures"]>;

export type ProcedurePath = keyof Procedures & string;

/**
 * A handler per procedure the screen under test calls.
 *
 * Both halves are inferred from the router: the argument is the procedure's
 * parsed input, the return value must satisfy its output. A handler may throw
 * `trpcTestError(code)` to exercise a failure branch.
 */
export type TestHandlers = Partial<{
  [P in ProcedurePath]: Procedures[P] extends AnyProcedure
    ? (input: inferProcedureInput<Procedures[P]>) => inferProcedureOutput<Procedures[P]>
    : never;
}>;

/**
 * The tRPC error codes a web screen can meaningfully branch on.
 *
 * `CONFLICT` added in Phase E, wave 1, Task 5 — `town.setPortalAddress` is
 * the first procedure a screen test needed to simulate it for
 * (`SetPortalAddressModal.test.tsx`). Corrected in the review round after
 * that task shipped: the first version of this comment claimed
 * `trpcTestError("CONFLICT")` "typechecked fine" against the pre-widening
 * union and only failed at runtime — that is FALSE, and stated with more
 * confidence than the one command that would have settled it. A reviewer
 * removed `| "CONFLICT"` from this union and ran `tsc`: `TS2345: Argument of
 * type '"CONFLICT"' is not assignable to parameter of type 'TestErrorCode'`,
 * pointing at the exact call site. `TestHandlers`' own typing (this file's
 * header comment) infers a handler's input/output from the real router;
 * `trpcTestError`'s parameter is plainly typed `TestErrorCode`, so a string
 * literal outside the union was never going to compile. There is no type
 * hole here — there never was.
 *
 * What actually happened, and the real lesson: `SetPortalAddressModal.test.tsx`
 * was written and run with `vitest` alone, which does not evaluate types, so
 * the missing-union-member mistake surfaced as a confusing RUNTIME failure
 * instead — `@trpc/client`'s own `transformResult` throwing
 * `TransformResultError` ("Unable to transform response from server"),
 * because the code did not even get far enough to be a `TestErrorCode`
 * question; vitest just ran the (type-incorrect) code as JavaScript, `code:
 * undefined` reached `transformResult`, and its own shape check rejected it
 * with a message naming none of this. Seeing a confusing runtime failure and
 * concluding something about the TYPE SYSTEM without running `tsc` first is
 * exactly the mistake conventions item 8's "floor" section warns against — "a
 * green vitest run is not a typecheck" cuts both ways: it also means a RED
 * vitest run is not a type verdict either. `npx turbo run typecheck --force`
 * would have named the real, narrower problem (a request to add `CONFLICT` to
 * this union) in one line, instead of a paragraph of runtime archaeology.
 *
 * The union genuinely was incomplete, though — that part of the original
 * diagnosis holds. Every code the API can currently answer
 * (`NOT_FOUND`/`FORBIDDEN`/`CONFLICT`/`BAD_REQUEST`/`UNAUTHORIZED`, plus
 * `INTERNAL_SERVER_ERROR` for the generic case) is listed below now. Add the
 * next `TRPC_ERROR_CODE_KEY` this harness does not yet cover
 * (`@trpc/server`'s own list has more — `PAYMENT_REQUIRED`,
 * `PRECONDITION_FAILED`, `TOO_MANY_REQUESTS`, …) the same way, at the point a
 * real procedure needs a test to simulate it — TypeScript will refuse any
 * call site that gets ahead of this list, which is the correct behavior and
 * always was.
 */
export type TestErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "INTERNAL_SERVER_ERROR";

const JSONRPC_CODE: Record<TestErrorCode, number> = {
  BAD_REQUEST: -32600,
  UNAUTHORIZED: -32001,
  FORBIDDEN: -32003,
  NOT_FOUND: -32004,
  CONFLICT: -32009,
  INTERNAL_SERVER_ERROR: -32603,
};

const HTTP_STATUS: Record<TestErrorCode, number> = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INTERNAL_SERVER_ERROR: 500,
};

/**
 * Thrown from a handler to make the procedure answer with a real tRPC error
 * envelope, so the component's own `isTRPCClientError(err) && err.data?.code
 * === "NOT_FOUND"` narrowing runs for real rather than being simulated.
 */
class TestTRPCError extends Error {
  constructor(readonly code: TestErrorCode) {
    super(code);
    this.name = "TestTRPCError";
  }
}

export function trpcTestError(code: TestErrorCode): never {
  throw new TestTRPCError(code);
}

interface StubbedCall {
  paths: string[];
  inputs: Record<string, unknown>;
}

export interface TRPCFetchStub {
  /** Every `/api/trpc` request the client made, in order. */
  calls: StubbedCall[];
  /** How many times a given procedure has been requested. */
  countFor(path: ProcedurePath): number;
}

function parseRequest(input: unknown, init?: RequestInit): { url: URL; body?: string } {
  const href =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : String((input as { url?: string }).url ?? input);
  // A relative `/api/trpc/...` needs a base to parse; the origin is irrelevant
  // because only the pathname and the query are read back out.
  return { url: new URL(href, "http://localhost"), body: init?.body as string | undefined };
}

/**
 * Replace `globalThis.fetch` for the current test file, answering
 * `/api/trpc/...` from `handlers` and leaving every other URL to fail loudly.
 *
 * ─── COLLECTION SCOPE ONLY ────────────────────────────────────────────────
 *
 * Call this at module or `describe` scope — above your `it(...)` blocks —
 * exactly once per file. It installs the stub in a `beforeEach` and restores
 * the original `fetch` in an `afterEach`, so every test starts from a clean
 * transport and nothing leaks into the next file.
 *
 * Calling it from inside a test body throws. That is not pedantry: vitest
 * SILENTLY IGNORES a lifecycle hook registered while a test is running, so
 * the internal `afterEach` would never run, `globalThis.fetch` would stay
 * stubbed after the file finished, and the guarantee in this comment would be
 * a lie that no test could detect. The first version of this helper did
 * exactly that. Failing at the call is the only version of this that a
 * reviewer can trust.
 *
 * Per-test variation belongs in mutable state the handlers close over (see
 * `server` in `routes/__tests__/boards.$boardId.test.tsx`), not in a second
 * install.
 */
export function installTRPCFetchStub(handlers: TestHandlers): TRPCFetchStub {
  assertCollectionScope("installTRPCFetchStub");

  const record: TRPCFetchStub = {
    calls: [],
    countFor: (path) => record.calls.filter((c) => c.paths.includes(path)).length,
  };

  const stub = vi.fn((input: unknown, init?: RequestInit) => {
    const { url, body } = parseRequest(input, init);

    if (!url.pathname.startsWith("/api/trpc")) {
      return Promise.reject(new Error(`installTRPCFetchStub: unexpected fetch to ${url.pathname}`));
    }

    const isBatch = url.searchParams.get("batch") === "1";
    const paths = url.pathname
      .slice("/api/trpc".length)
      .replace(/^\//, "")
      .split(",")
      .filter(Boolean);

    // Queries arrive as GET with `?input={"0":{...}}`; mutations as POST with
    // the same index-keyed object as the body. Non-batched requests carry the
    // bare input, which is index 0 of a one-element batch.
    let inputs: Record<string, unknown> = {};
    const raw = body ?? url.searchParams.get("input");
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      inputs = isBatch ? (parsed as Record<string, unknown>) : { 0: parsed };
    }

    record.calls.push({ paths, inputs });

    const envelopes = paths.map((path, index) => {
      const handler = handlers[path as ProcedurePath] as ((input: unknown) => unknown) | undefined;
      if (!handler) {
        return errorEnvelope(
          "INTERNAL_SERVER_ERROR",
          `installTRPCFetchStub: no handler for "${path}"`,
          path,
        );
      }
      try {
        return { result: { data: handler(inputs[String(index)]) } };
      } catch (err) {
        if (err instanceof TestTRPCError) return errorEnvelope(err.code, err.code, path);
        throw err;
      }
    });

    const payload = isBatch ? envelopes : envelopes[0];
    return Promise.resolve(
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  });

  // Not `vi.stubGlobal` / `vi.unstubAllGlobals`: that pair restores EVERY
  // global a file has stubbed, so this helper would silently undo an
  // unrelated stub the test author installed. Save and restore just `fetch`.
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    record.calls.length = 0;
    globalThis.fetch = stub as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  return record;
}

/**
 * Refuse a helper call made from inside a running test.
 *
 * `expect.getState().currentTestName` is set only while a test executes; at
 * collection time — module body, `describe` body — it is undefined. That is
 * the one signal available before the ignored-hook damage is done.
 */
export function assertCollectionScope(helper: string): void {
  if (expect.getState().currentTestName) {
    throw new Error(
      `${helper}() was called inside a test body. Vitest silently ignores ` +
        "beforeEach/afterEach registered while a test is running, so this helper's " +
        "setup and teardown would never run and its state would leak into the next " +
        `test. Move the ${helper}() call above your it(...) blocks — module or ` +
        "describe scope — and put per-test variation in mutable state the handlers " +
        "close over.",
    );
  }
}

function errorEnvelope(code: TestErrorCode, message: string, path: string) {
  return {
    error: {
      message,
      code: JSONRPC_CODE[code],
      data: { code, httpStatus: HTTP_STATUS[code], path },
    },
  };
}
