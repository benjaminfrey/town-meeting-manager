/**
 * Invitation tokens: how one is made, and how the database recognises it.
 *
 * The database never holds a token — only `sha256(token)`, in
 * `invitation.token_sha256` and `better_auth.invitation_tenant.token_sha256`
 * (see `drizzle/0004_hash_invitation_tokens.sql`). A token exists in exactly
 * two places: the email that delivers it and the request that presents it
 * back. So:
 *
 *   - it is minted HERE, in the API, at the moment it is sent — never by
 *     `gen_random_uuid()` in an INSERT, because a value generated inside the
 *     database and stored only as a digest could never be emailed;
 *   - every read or write compares DIGESTS, through `invitationTokenDigest`,
 *     which is the only place the expression is written in TypeScript. It
 *     must stay byte-identical to what 0002's backfill and 0004's backfill
 *     computed, or every link already in an inbox stops resolving.
 */

import { randomBytes } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";

/**
 * A new invitation token: 32 random bytes, base64url — 43 characters, safe in
 * a query string without encoding. 256 bits is why an unsalted fast hash is
 * the right store for it: there is nothing to guess.
 */
export function mintInvitationToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * The SQL expression for a presented token's digest. Hashed in the database
 * rather than in Node so it is the same expression, character for character,
 * as the migrations that computed every stored digest.
 */
export function invitationTokenDigest(token: string): SQL {
  return sql`sha256(convert_to(${token}, 'UTF8'))`;
}
