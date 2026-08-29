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

import { afterEach, vi } from "vitest";
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

/** The tRPC error codes a web screen can meaningfully branch on. */
export type TestErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "INTERNAL_SERVER_ERROR";

const JSONRPC_CODE: Record<TestErrorCode, number> = {
  BAD_REQUEST: -32600,
  UNAUTHORIZED: -32001,
  FORBIDDEN: -32003,
  NOT_FOUND: -32004,
  INTERNAL_SERVER_ERROR: -32603,
};

const HTTP_STATUS: Record<TestErrorCode, number> = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
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
 * Registers its own `afterEach` restore, so a file that calls this cannot
 * leak a stubbed `fetch` into the next one.
 */
export function installTRPCFetchStub(handlers: TestHandlers): TRPCFetchStub {
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

  vi.stubGlobal("fetch", stub);
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  return record;
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
