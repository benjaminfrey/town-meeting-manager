/**
 * Stage 1, Task C2 — the one place this app talks to its own API.
 *
 * ─── What this replaces ───────────────────────────────────────────────────
 *
 *     const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:3001";
 *
 * That line appeared verbatim in six files under three different names
 * (`API_BASE`, `apiBase`, `API_URL`), and every call site around it repeated
 * the same four steps by hand: read the Supabase session, pull the access
 * token out of it, set an `Authorization: Bearer` header, and check `res.ok`.
 * Twenty-two call sites, each an independent chance to get one of the four
 * wrong — and none of them passed `credentials`, which is the one that matters
 * now that the session is a cookie.
 *
 * ─── The origin decision, which is the reason this file exists ────────────
 *
 * `VITE_API_URL` defaulted to `http://localhost:3001` while Vite serves the
 * app on `5173`, so **development was cross-origin**. `.env.production.example`
 * pointed it at `https://api.townmeetingmanager.com` while the app is served
 * from `https://app.townmeetingmanager.com`, so **production was cross-origin
 * too — but at a different pair of origins**. Meanwhile Task C1's entire
 * session design, and the nginx config it shipped, assume the API is
 * SAME-ORIGIN at `/api/`.
 *
 * Cross-origin cookies need `SameSite=None`, which means the browser attaches
 * them to requests from any site, which means CSRF is held off by nothing but
 * a header check. Same-origin lets the cookie stay `SameSite=Lax` and lets the
 * browser enforce it. So the base URL is gone rather than centralised: every
 * request from this app is a RELATIVE `/api/...` URL, which is same-origin by
 * construction and cannot be configured into a different topology.
 *
 * The two halves that make that true:
 *   - production — `infrastructure/nginx/nginx.conf` proxies `/api/` on the
 *     `app.` server block to the API process;
 *   - development — `packages/web/vite.config.ts` proxies `/api` to
 *     `localhost:3001` with `changeOrigin: false`, so even the `Host` header
 *     matches what nginx forwards.
 *
 * ─── Why a helper and not a convention ────────────────────────────────────
 *
 * Twenty-two correct call sites are worth less than one correct helper,
 * because the twenty-third will be written by someone who did not read any of
 * this. Sending `credentials` is a property of talking to this API, so it
 * lives with the thing that talks to it.
 *
 * The public portal (`lib/portal-api.ts`) deliberately does NOT use this. It
 * is unauthenticated by design — anonymous residents reading published
 * meetings — and giving it credentials would attach a signed-in clerk's
 * session to page views that must behave identically for everyone.
 */

/** Thrown for any non-2xx response, carrying whatever the API said. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Build the URL for an API path.
 *
 * `path` is relative to the API root and may start with or without `/api`.
 * The result is always root-relative, so it is same-origin with the page no
 * matter where the app is deployed.
 */
function apiUrl(path: string): string {
  if (path.startsWith("/api/")) return path;
  return `/api/${path.replace(/^\/+/, "")}`;
}

/**
 * Extract the most useful message a Fastify error response carries.
 *
 * `@fastify/sensible` replies `{ statusCode, error, message }`; the tenant
 * bridge's 403 in particular carries a sentence written for the person reading
 * it, and discarding it in favour of "Request failed: 403" would throw away
 * the only actionable part of the response.
 */
async function errorFrom(response: Response): Promise<ApiError> {
  let body: unknown;
  let message = `${response.status} ${response.statusText}`;
  try {
    const text = await response.text();
    if (text) {
      try {
        body = JSON.parse(text);
        const parsed = body as { message?: unknown; error?: unknown };
        if (typeof parsed.message === "string" && parsed.message) message = parsed.message;
        else if (typeof parsed.error === "string" && parsed.error) message = parsed.error;
      } catch {
        body = text;
        message = text.slice(0, 500);
      }
    }
  } catch {
    // A body that cannot be read is not worth failing over — the status is
    // still the useful part.
  }
  return new ApiError(response.status, message, body);
}

export interface ApiFetchOptions extends Omit<RequestInit, "body"> {
  /** Serialised as JSON with the matching content type. */
  json?: unknown;
}

/**
 * Call this application's API.
 *
 * Returns the raw `Response` — use `apiJson` when you want the parsed body and
 * an exception on failure. The session cookie is attached here, once, so no
 * call site has to remember to.
 */
export async function apiFetch(path: string, options: ApiFetchOptions = {}): Promise<Response> {
  const { json, headers, ...rest } = options;

  const finalHeaders = new Headers(headers);
  let body: BodyInit | undefined;
  if (json !== undefined) {
    body = JSON.stringify(json);
    if (!finalHeaders.has("Content-Type")) finalHeaders.set("Content-Type", "application/json");
  }

  return fetch(apiUrl(path), {
    ...rest,
    headers: finalHeaders,
    body,
    // The whole point of this module. Requests are same-origin, so
    // `same-origin` would also send the cookie — `include` is stated because
    // it is the property being relied on, and a reader should not have to
    // work out whether the URL happened to be relative.
    credentials: "include",
  });
}

/**
 * Call the API and parse a JSON body, throwing `ApiError` on any non-2xx.
 *
 * The old call sites did `if (!res.ok) throw new Error("Failed to …")`, which
 * replaced the server's explanation with a generic one at the exact moment the
 * user needed the explanation. This keeps it.
 */
export async function apiJson<T = unknown>(
  path: string,
  options: ApiFetchOptions = {},
): Promise<T> {
  const response = await apiFetch(path, options);
  if (!response.ok) throw await errorFrom(response);
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}
