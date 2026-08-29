import { normaliseSubdomain } from "@town-meeting/shared";

/**
 * Detect if the current hostname is a portal subdomain.
 * Returns the subdomain string or null if not a portal.
 *
 * In dev mode (localhost), supports ?portal=subdomain query param.
 *
 * ─── Task D1b: one list, two directions ───────────────────────────────────
 *
 * The reserved-name list and the label rules used to live here, and a second
 * copy of the reserved list is what the API would have needed to refuse
 * `app`/`api`/`www` as a saved portal address. Two lists that must agree and
 * are edited by different people agree only until the first edit, so both
 * sides now read `normaliseSubdomain` from `@town-meeting/shared`.
 *
 * This function asks it the negative question — "is the hostname in the
 * browser a town's portal?" — and a reserved or malformed label answers no,
 * which is exactly the behaviour the previous local list gave.
 */
export function detectPortalSubdomain(hostname: string): string | null {
  // Dev mode: check query param
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname.startsWith("localhost:")) {
    const params = new URLSearchParams(window.location.search);
    return normaliseSubdomain(params.get("portal"));
  }

  // Production: extract subdomain from hostname
  // Expected format: subdomain.townmeetingmanager.com
  const parts = hostname.split(".");
  if (parts.length < 3) return null;

  return normaliseSubdomain(parts[0]);
}
