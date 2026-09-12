/**
 * Phase E, wave 5, Task 7's fix round — the batch-path bound, shared between
 * server and client because the two ends must agree which of them fails
 * first.
 *
 * ─── The defect this closes ───────────────────────────────────────────────
 *
 * `httpBatchLink` (`packages/web/src/lib/trpc.ts`) coalesces every query a
 * screen fires in one tick into ONE HTTP request: `/api/trpc/a,b,c?batch=1`.
 * The comma-joined procedure NAMES land in a single dynamic path segment, and
 * Fastify's router (`find-my-way`) bounds every such segment with
 * `maxParamLength` — **100 characters by default**, a limit sized for an id
 * or a slug, never audited against a batch of tRPC paths. The live meeting
 * screen composes a six-procedure batch (`exhibit.byMeeting`,
 * `voteRecord.byMeeting`, `guestSpeaker.byMeeting`,
 * `agendaItemTransition.byMeeting`, `executiveSession.byMeeting`,
 * `boardMember.activeCountForBoard`) whose joined path is 151-152 characters
 * — over the default before tRPC ever sees the request, so the route 404s.
 * React Query's `retry: 2` re-batches into smaller groups and the screen
 * still renders, which is why this was invisible in the browser: it costs a
 * wasted round trip and a 404 on every load, and is a hard failure the
 * moment a query client disables retry.
 *
 * ─── Why a bigger bound alone is not the whole fix ────────────────────────
 *
 * A limit sized to fit today's longest batch (six procedures, ~151 chars)
 * and nothing more fails the exact same way the next time a screen's loader
 * grows a seventh query or a router gains a longer name — silently, because
 * nothing here stops the client from composing an arbitrarily long batch.
 * `TRPC_BATCH_URL_LIMIT` is the other half: it caps the URL `httpBatchLink`
 * is willing to build and, when a batch WOULD exceed it, `@trpc/client`
 * automatically splits that tick's queries into more than one HTTP request
 * instead of ever sending an oversized one. So growth past today's six
 * procedures costs an extra round trip — the same graceful cost the SSE
 * reconnect and the notification sweep already accept elsewhere in this
 * codebase — rather than a 404 that only retry happens to paper over.
 * `TRPC_BATCH_PATH_LENGTH_LIMIT` is what the split is measured against
 * having enough headroom to matter for: the client bound is deliberately
 * set to trip well before the server bound could ever be reached.
 *
 * ─── Sizing `TRPC_BATCH_PATH_LENGTH_LIMIT`, and what raising it costs ─────
 *
 * `maxParamLength` exists to bound work `find-my-way` does on untrusted
 * input, but the check itself (`matchedParam.length > maxParamLength`, in
 * `find-my-way`'s route matcher) is a single length comparison on a string
 * Node has *already* fully received and parsed — it costs nothing extra to
 * compare against a bigger number. The real bound on how large that string
 * can even get is upstream of Fastify entirely: Node's HTTP parser refuses
 * (431) any request whose request-line-plus-headers exceeds
 * `--max-http-header-size` (16KB by default), and in production
 * `infrastructure/nginx/nginx.conf` sits in front of that with its own
 * `large_client_header_buffers` ceiling. So raising `maxParamLength` from
 * 100 to a few thousand does not admit any request shape that was not
 * already going to reach Fastify's router — it only stops Fastify from
 * being STRICTER than the transport underneath it for a path segment that
 * is, by construction here, a list of dotted procedure names rather than
 * user-supplied data of unbounded size.
 *
 * 4096 is chosen with headroom on both sides: comfortably below the 16KB
 * transport ceiling (so it adds no meaningful exposure even under that
 * ceiling), and roughly 27x today's real 151-character batch — enough for
 * procedure names to grow, for a screen to compose two or three times as
 * many reads as the live meeting screen's six, or both, without silently
 * regressing. It is not "unlimited": an actually pathological batch (many
 * hundreds of procedures) still 404s, which is the correct outcome for a
 * batch that large — but `TRPC_BATCH_URL_LIMIT` below means a legitimate
 * screen never gets there, because the client splits first.
 *
 * ─── Sizing `TRPC_BATCH_URL_LIMIT` ─────────────────────────────────────────
 *
 * Half of the path bound (2048), and measured against the WHOLE url
 * (`httpBatchLink`'s `maxURLLength` includes the `?batch=1&input=...` query
 * string, not just the path segment) rather than only the procedure-name
 * segment `TRPC_BATCH_PATH_LENGTH_LIMIT` bounds. Because the path segment is
 * always a strict subset of the full URL, a client that never builds a URL
 * longer than 2048 characters never builds a path segment longer than 2048
 * characters either — leaving a full 2x margin under the server's 4096
 * before the two bounds could ever collide, and covering the case a bare
 * path-length comparison would miss: a batch of few, short procedure names
 * carrying large `input` payloads.
 */

/**
 * Fastify's `maxParamLength` for the `/api/trpc/*` mount — the ceiling on the
 * comma-joined procedure-names segment of a batched request's path.
 *
 * See this file's header for why 4096 is safe to raise to (the check is O(1)
 * against a string the transport layer has already bounded far below this)
 * and why it is not itself the whole fix (`TRPC_BATCH_URL_LIMIT` is).
 *
 * Pinned by `packages/api/src/trpc/__tests__/http-batch.test.ts`, which drives
 * a real Fastify server with a batch sized to have 404d under the old
 * default and asserts 200.
 */
export const TRPC_BATCH_PATH_LENGTH_LIMIT = 4096;

/**
 * `httpBatchLink`'s `maxURLLength` — the ceiling on the WHOLE url (path plus
 * `?batch=1&input=...`) the web client is willing to build for one batched
 * request before splitting that tick's queries across more than one HTTP
 * request.
 *
 * Deliberately half of `TRPC_BATCH_PATH_LENGTH_LIMIT` and measured against
 * more of the URL than that bound covers — see this file's header for both
 * the margin and why the wider measurement matters. Consumed by
 * `packages/web/src/lib/trpc.ts`.
 */
export const TRPC_BATCH_URL_LIMIT = 2048;
