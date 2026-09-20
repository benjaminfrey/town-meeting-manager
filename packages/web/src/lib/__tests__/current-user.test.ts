/**
 * `fetchCurrentUser` — the one place a permissions matrix enters the browser.
 *
 * The database stores matrices in BOTH spellings. `packages/api/drizzle/seed/seed.sql`
 * writes the Deputy Clerk's grants keyed by action CODE (`{"A2": true, …}`),
 * while other rows use action NAMES. The server copes: `authorization/permission.ts`
 * runs `normalisePermissionsMatrix` on every resolution. The browser did not —
 * it passed `response.permissions` straight through — so a code-keyed account
 * resolved to NO permissions client-side and every button gated on
 * `hasPermission` was hidden, for writes the server would have allowed
 * (backlog 6).
 *
 * `hasPermission`'s own doc comment says it outright: "It takes an
 * ALREADY-NORMALISED matrix … or half the accounts in the system silently
 * resolve to no permissions at all." The client was the half.
 *
 * Normalising HERE rather than in each screen is deliberate: this is the only
 * boundary the matrix crosses, so every consumer — `usePermission`,
 * `PermissionGate`, every screen calling `hasPermission` — is fixed at once,
 * and a new screen cannot reintroduce the gap by forgetting a step.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { hasPermission } from "@town-meeting/shared";

const apiJson = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api-client", () => ({ apiJson }));

const { fetchCurrentUser } = await import("../current-user.js");

const BOARD = "bbbb1111-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

/** `GET /api/me`'s shape, with the permissions matrix under test. */
function meResponse(permissions: unknown) {
  return {
    id: "aaaa2222-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    authUserId: "auth-1",
    personId: "22222222-2222-4222-8222-222222222222",
    email: "smitchell@newcastle.me.us",
    emailVerified: true,
    townId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    role: "staff",
    govTitle: "Deputy Clerk",
    permissions,
  };
}

beforeEach(() => {
  apiJson.mockReset();
});

describe("fetchCurrentUser normalises the permissions matrix (backlog 6)", () => {
  it("resolves a CODE-keyed matrix, the spelling the seed writes", async () => {
    // Exactly the Deputy Clerk row from packages/api/drizzle/seed/seed.sql.
    apiJson.mockResolvedValue(
      meResponse({
        global: { A2: true, A3: true, A6: true, M1: true, R1: true },
        board_overrides: [],
      }),
    );

    const user = await fetchCurrentUser();

    // Before normalisation this was `false`: the button was hidden for an
    // account the server would have allowed to write.
    expect(hasPermission(user.permissions!, "edit_agenda", BOARD, "staff")).toBe(true);
    expect(hasPermission(user.permissions!, "generate_ai_minutes", BOARD, "staff")).toBe(false);
  });

  it("still resolves a NAME-keyed matrix", async () => {
    apiJson.mockResolvedValue(meResponse({ global: { edit_agenda: true }, board_overrides: [] }));

    const user = await fetchCurrentUser();

    expect(hasPermission(user.permissions!, "edit_agenda", BOARD, "staff")).toBe(true);
    expect(hasPermission(user.permissions!, "edit_draft_minutes", BOARD, "staff")).toBe(false);
  });

  it("normalises board_overrides too, not only the global grants", async () => {
    // A board-scoped grant in the code spelling is the same trap one level
    // down, and overrides take precedence over global — so a matrix that
    // normalises only `global` answers the wrong question for that board.
    apiJson.mockResolvedValue(
      meResponse({
        global: {},
        board_overrides: [{ board_id: BOARD, permissions: { A2: true } }],
      }),
    );

    const user = await fetchCurrentUser();

    expect(hasPermission(user.permissions!, "edit_agenda", BOARD, "staff")).toBe(true);
    expect(hasPermission(user.permissions!, "edit_agenda", "other-board", "staff")).toBe(false);
  });

  it("leaves a missing matrix null rather than inventing an empty one", async () => {
    apiJson.mockResolvedValue(meResponse(null));

    const user = await fetchCurrentUser();

    expect(user.permissions).toBeNull();
  });
});
