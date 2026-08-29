/**
 * Stage 1, Task D1b — what a town's portal subdomain may be.
 *
 * `town.subdomain` is the town's public identity: it is the hostname the
 * public portal is served from (`<subdomain>.townmeetingmanager.com`), the
 * value nginx extracts and forwards as `X-Town-Subdomain`, and — from D1b
 * onward — the value the API turns into a tenant context for every
 * unauthenticated portal request.
 *
 * That makes it three different kinds of thing at once, and each imposes a
 * constraint the others do not:
 *
 *   1. **A DNS label.** RFC 1123: 1–63 characters, ASCII letters, digits and
 *      hyphens, must start and end alphanumeric. A value outside that cannot
 *      be resolved, so a town that saved one would have a portal address that
 *      does not exist.
 *   2. **A routing key in nginx.** The server block matches
 *      `~^(?<subdomain>[^.]+)\.townmeetingmanager\.com$`, so anything with a
 *      dot in it would never reach the portal block at all.
 *   3. **A tenant selector.** It is the input to a database lookup on a
 *      sessionless request. Validating the shape BEFORE that lookup means a
 *      malformed or hostile header is refused without touching the database.
 *
 * ─── Why reserved names are refused rather than merely discouraged ────────
 *
 * `app.townmeetingmanager.com` is the application itself and `api.` is this
 * process. A town that claimed either would not get a portal — it would
 * shadow, or be shadowed by, an existing nginx server block, and which one
 * wins depends on nginx's matching order rather than on anything a town
 * administrator can see. `www.` and `mail.`/`smtp.` are the same problem for
 * the marketing site and for outbound mail; `supabase.` is the Kong host in
 * `infrastructure/nginx/nginx.conf`.
 *
 * The list is shared with `packages/web/src/lib/portal.ts`, which uses it for
 * the opposite purpose — deciding that the hostname in the browser is NOT a
 * portal — so the two must agree. They now do, because there is one list.
 */

/**
 * Hostnames this deployment already uses for something other than a town.
 *
 * Lower-case, and compared after normalisation.
 */
export const RESERVED_SUBDOMAINS: readonly string[] = [
  "admin",
  "api",
  "app",
  "assets",
  "cdn",
  "dev",
  "docs",
  "mail",
  "portal",
  "smtp",
  "staging",
  "static",
  "status",
  "supabase",
  "support",
  "test",
  "www",
];

/** RFC 1123 label: alphanumeric at both ends, hyphens allowed inside. */
const LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export const SUBDOMAIN_MAX_LENGTH = 63;

export type SubdomainRejection = "empty" | "too_long" | "malformed" | "reserved";

export type SubdomainCheck =
  | { readonly ok: true; readonly subdomain: string }
  | { readonly ok: false; readonly reason: SubdomainRejection; readonly message: string };

/**
 * Normalise and validate a candidate subdomain.
 *
 * Trims and lower-cases first — DNS is case-insensitive, so `Newcastle` and
 * `newcastle` are the same host, and storing both would let two towns hold
 * what is in fact one name while `town_subdomain_key` sees two distinct
 * strings. Everything downstream (the unique index, the header lookup, the
 * reserved-name check) therefore compares the normalised form only.
 *
 * Returns a discriminated result rather than throwing: the write path turns a
 * rejection into a message a clerk can act on, and the read path turns one
 * into a 404 without logging anything alarming. Neither wants an exception.
 */
export function checkSubdomain(value: unknown): SubdomainCheck {
  if (typeof value !== "string") {
    return {
      ok: false,
      reason: "empty",
      message: "A portal address is required.",
    };
  }

  const subdomain = value.trim().toLowerCase();

  if (subdomain.length === 0) {
    return {
      ok: false,
      reason: "empty",
      message: "A portal address is required.",
    };
  }

  if (subdomain.length > SUBDOMAIN_MAX_LENGTH) {
    return {
      ok: false,
      reason: "too_long",
      message: `A portal address can be at most ${SUBDOMAIN_MAX_LENGTH} characters long.`,
    };
  }

  if (!LABEL_RE.test(subdomain)) {
    return {
      ok: false,
      reason: "malformed",
      message:
        "A portal address can use only lowercase letters, numbers and hyphens, " +
        "and must start and end with a letter or number. It cannot contain dots, " +
        "spaces or underscores — it becomes part of a web address.",
    };
  }

  if (RESERVED_SUBDOMAINS.includes(subdomain)) {
    return {
      ok: false,
      reason: "reserved",
      message: `"${subdomain}" is reserved for the application itself and cannot be used as a portal address.`,
    };
  }

  return { ok: true, subdomain };
}

/**
 * The normalised subdomain, or `null` if the value is not a usable one.
 *
 * The read path's form: a portal request carrying a subdomain that could never
 * have been saved does not need to know WHY it is invalid, only that no town
 * can match it.
 */
export function normaliseSubdomain(value: unknown): string | null {
  const result = checkSubdomain(value);
  return result.ok ? result.subdomain : null;
}
