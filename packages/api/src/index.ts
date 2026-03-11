/**
 * API server entry point.
 *
 * Starts the Fastify server and handles graceful shutdown.
 */

import { buildServer } from "./server.js";
import { closeBrowser } from "./services/puppeteer.js";

const port = Number(process.env.PORT ?? 3001);

const server = await buildServer();

try {
  await server.listen({ port, host: "0.0.0.0" });
} catch (err) {
  server.log.error(err);
  process.exit(1);
}

async function shutdown() {
  server.log.info("Shutting down...");
  await closeBrowser();
  await server.close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
