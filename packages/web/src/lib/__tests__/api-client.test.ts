/**
 * Stage 1, Task C2 — the API client, pinned.
 *
 * ─── Why this file exists ─────────────────────────────────────────────────
 *
 * Before this task there were twenty-two hand-written `fetch` calls to this
 * API across eleven files, and `grep -rn "credentials:" packages/web/src`
 * returned ZERO. Every one of them would have silently failed to send the
 * session cookie the moment the app was not same-origin with the API — which,
 * as `api-client.ts`'s header records, was the configured state in BOTH
 * development and production.
 *
 * Centralising them is only worth something if the centre is correct and stays
 * correct. Two properties matter, and they are the first two tests:
 *
 *   1. **Credentials are always attached.** This is the whole point.
 *   2. **URLs are root-relative.** A base URL is what made the app
 *      cross-origin; if one ever comes back, so does the cookie problem, and
 *      it comes back silently.
 *
 * The rest cover the error path, because the old call sites replaced the
 * server's explanation with "Failed to …" at exactly the moment the user
 * needed the explanation — including the tenant bridge's 403, whose message is
 * a sentence telling the reader to ask an administrator.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { apiFetch, apiJson, ApiError } from "../api-client";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("apiFetch", () => {
  it("always sends credentials, so the session cookie is attached", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
    await apiFetch("/api/me");

    const [, init] = fetchMock.mock.calls[0]!;
    expect(init.credentials).toBe("include");
  });

  it("sends credentials even when the caller passes its own RequestInit", async () => {
    // The failure this guards: a call site adds `headers` or `signal` and, by
    // spreading last, quietly replaces the option everything depends on.
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
    await apiFetch("/api/me", {
      method: "POST",
      headers: { "X-Test": "1" },
      credentials: "omit",
    } as Parameters<typeof apiFetch>[1]);

    const [, init] = fetchMock.mock.calls[0]!;
    expect(init.credentials).toBe("include");
    expect(new Headers(init.headers).get("X-Test")).toBe("1");
  });

  it("builds ROOT-RELATIVE urls — there is no base origin to configure", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}));

    await apiFetch("/api/invitations/abc/send");
    await apiFetch("invitations/abc/send");
    await apiFetch("/invitations/abc/send");

    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([
      "/api/invitations/abc/send",
      "/api/invitations/abc/send",
      "/api/invitations/abc/send",
    ]);
    for (const [url] of fetchMock.mock.calls) {
      expect(url).not.toMatch(/^https?:\/\//);
    }
  });

  it("serialises `json` with the matching content type", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}));
    await apiFetch("/api/onboarding", { method: "POST", json: { townName: "Newcastle" } });

    const [, init] = fetchMock.mock.calls[0]!;
    expect(init.body).toBe('{"townName":"Newcastle"}');
    expect(new Headers(init.headers).get("Content-Type")).toBe("application/json");
  });
});

describe("apiJson", () => {
  it("returns the parsed body on success", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ townId: "town-1" }, 201));
    await expect(apiJson("/api/onboarding", { method: "POST" })).resolves.toEqual({
      townId: "town-1",
    });
  });

  it("keeps the server's message instead of replacing it with a generic one", async () => {
    // The tenant bridge's 403 says what actually resolves the situation — ask
    // an administrator, or get a new invitation. `Failed to load` would throw
    // that away.
    const message = "Your account is not linked to a town yet, so there is nothing for it to open.";
    fetchMock.mockResolvedValue(
      jsonResponse({ statusCode: 403, error: "Forbidden", message }, 403),
    );

    await expect(apiJson("/api/me")).rejects.toMatchObject({
      name: "ApiError",
      status: 403,
      message,
    });
  });

  it("throws ApiError with the status, so callers can branch on 401 vs 409", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ message: "already has a town" }, 409));

    const error = await apiJson("/api/onboarding", { method: "POST" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(409);
  });

  it("survives an error response that is not JSON", async () => {
    // nginx's own 502 page, for instance — a client that threw while parsing
    // the error would replace a useful status with a SyntaxError.
    fetchMock.mockResolvedValue(new Response("<html>502 Bad Gateway</html>", { status: 502 }));

    const error = await apiJson("/api/me").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(502);
  });

  it("handles a 204 with no body", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(apiJson("/api/notifications/push/unsubscribe")).resolves.toBeUndefined();
  });
});
