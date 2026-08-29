/**
 * Stage 1, Task D1f — the three error kinds the migrated Fastify routes
 * produce, and the three status codes they mean.
 *
 * Extracted from `routes/files.ts`, where D1e wrote it, because D1f puts
 * `documents.ts` and `minutes.ts` on the same authorization layer and a second
 * copy of this mapping is exactly the drift this codebase keeps finding. There
 * is one rule about which refusal is a 403 and which is a 404, and it has one
 * implementation.
 *
 * A refusal is 403 with the rule's own message, which names the action code
 * and says who can grant it. A missing record is 404 — and a record in another
 * town is ALSO 404, because RLS made it invisible before any rule ran, so the
 * two are indistinguishable to a handler and must stay that way: a 403 for one
 * and a 404 for the other would confirm the existence of another town's
 * records. A malformed path or an unacceptable file is 400.
 *
 * Anything else is re-thrown, so an unexpected failure is a 500 with a stack
 * in the log rather than a plausible-looking 4xx.
 */

import type { FastifyReply, FastifyRequest } from "fastify";
import { AuthorizationError } from "../trpc/authorization/permission.js";
import { StoragePathError } from "../storage/paths.js";
import { DocumentNotFoundError } from "../storage/documents.js";

export async function handleRouteErrors<T>(
  request: FastifyRequest,
  reply: FastifyReply,
  fn: () => Promise<T>,
): Promise<T | FastifyReply> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof AuthorizationError) {
      return reply.code(403).send({ error: "Forbidden", message: err.message });
    }
    if (err instanceof DocumentNotFoundError) {
      return reply.code(404).send({ error: "Not Found", message: err.message });
    }
    if (err instanceof StoragePathError) {
      return reply.code(400).send({ error: "Bad Request", message: err.message });
    }
    request.log.error({ err }, "route failed");
    throw err;
  }
}
