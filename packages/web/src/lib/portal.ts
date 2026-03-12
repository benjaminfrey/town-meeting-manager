const RESERVED_SUBDOMAINS = new Set([
  "app",
  "api",
  "supabase",
  "www",
  "mail",
  "smtp",
]);

/**
 * Detect if the current hostname is a portal subdomain.
 * Returns the subdomain string or null if not a portal.
 *
 * In dev mode (localhost), supports ?portal=subdomain query param.
 */
export function detectPortalSubdomain(hostname: string): string | null {
  // Dev mode: check query param
  if (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname.startsWith("localhost:")
  ) {
    const params = new URLSearchParams(window.location.search);
    return params.get("portal") || null;
  }

  // Production: extract subdomain from hostname
  // Expected format: subdomain.townmeetingmanager.com
  const parts = hostname.split(".");
  if (parts.length < 3) return null;

  const subdomain = parts[0]!.toLowerCase();
  if (RESERVED_SUBDOMAINS.has(subdomain)) return null;

  return subdomain;
}
