/**
 * `tsx src/dev/seed-dev-logins-cli.ts` — dev only.
 *
 * Wraps `seedDevLogins` with the database handle and Better Auth instance that
 * `scripts/dev/reset-local-db.sh` cannot build in bash. Prints one line per
 * login so a developer can see what to sign in as.
 *
 * `no-console` is repo-wide `error` (only warn/error allowed) because a
 * `console.log` in application code is usually a forgotten debug statement.
 * This file's whole job is printing to stdout for a developer to read, so
 * that rule is disabled here, not weakened globally.
 */
/* eslint-disable no-console */
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { createAuth } from "../auth/auth.js";
import { seedDevLogins, SEED_TOWN_ID } from "./seed-dev-logins.js";

const DATABASE_URL = process.env.DATABASE_URL;
const PASSWORD = process.env.DEV_PASSWORD ?? "TownMeeting!Dev1";
const TOWN_ID = process.env.DEV_TOWN_ID ?? SEED_TOWN_ID;

if (!DATABASE_URL) {
  console.error("seed-dev-logins: DATABASE_URL is required");
  process.exit(1);
}

const client = postgres(DATABASE_URL, { max: 1, onnotice: () => {} });
try {
  const db = drizzle(client);
  const auth = createAuth({
    db,
    secret: process.env.BETTER_AUTH_SECRET ?? "dev-secret-0123456789abcdef0123456789",
    baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:5173",
    sendAuthEmail: async () => {},
  });

  const seeded = await seedDevLogins(db, auth, PASSWORD, TOWN_ID);
  if (seeded.length === 0) {
    console.log("seed-dev-logins: every account already has a login; nothing to do");
  }
  for (const login of seeded) {
    console.log(`seed-dev-logins: ${login.email}  (password: ${PASSWORD})`);
  }
} finally {
  await client.end();
}
