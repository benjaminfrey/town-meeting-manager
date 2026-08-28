/**
 * Stage 1, Task C2 — who the signed-in user is, according to the database.
 *
 * ─── What this replaces, and the bug not to reintroduce ───────────────────
 *
 * `hooks/useCurrentUser.ts` used to base64-decode the Supabase access token
 * and read custom claims — `town_id`, `role`, `person_id`, `gov_title`,
 * `permissions` — that `custom_access_token_hook()` injected. Phase B deleted
 * GoTrue and that hook with it, so there is no token and there are no claims.
 * These facts now come from `GET /api/me`, which reads them from
 * `user_account` THROUGH row level security.
 *
 * The historical bug, recorded so it is not recreated: Supabase set
 * `payload.role = "authenticated"` on every token, colliding with this app's
 * own `role`. The old code filtered against a `VALID_ROLES` set before falling
 * through to `app_metadata.role` for that reason. **Better Auth has no such
 * collision** — verified, not assumed: its session user carries `id`, `email`,
 * `emailVerified`, `name`, `image` and timestamps, and no `role` field at all
 * (it would come from the admin plugin, which is not installed). More to the
 * point, `role` no longer travels in a token: the server reads
 * `user_account.role` and validates it against the same four values before
 * answering, and refuses rather than defaulting when it is unrecognised. The
 * old `?? "admin"` fallback — a missing claim meaning full administrator — is
 * gone from both ends.
 *
 * ─── `id` is `user_account.id` now ────────────────────────────────────────
 *
 * It used to be the GoTrue auth user id, while `CreateMeetingDialog` wrote it
 * straight into `meeting.created_by`, which is a foreign key to
 * `user_account(id)`. That worked only while the two ids coincided. Task G1
 * made the same correction to the API's `request.user.id`; this is the client
 * half. `authUserId` is reported separately for the rare caller that wants the
 * identity rather than the account.
 */

import type { UserRole, PermissionsMatrix } from "@town-meeting/shared";
import { apiJson } from "./api-client";

export interface CurrentUser {
  /**
   * `user_account.id` — NOT the auth provider's user id.
   *
   * `null` for an identity that has signed in but has no town yet, because
   * `user_account` rows only exist inside a town.
   */
  id: string | null;
  /** Better Auth's user id. The identity, as opposed to the account. */
  authUserId: string;
  /** PERSON entity ID from the user_account table (UUID) */
  personId: string | null;
  /** User's email address */
  email: string;
  /** Whether the address has been confirmed. */
  emailVerified: boolean;
  /** Town ID — null if no town set up yet (first-time admin) */
  townId: string | null;
  /** App role — null until the account belongs to a town */
  role: UserRole | null;
  /** Display title like "Town Clerk" — from user_account.gov_title */
  govTitle: string | null;
  /** JSONB permissions matrix from user_account */
  permissions: PermissionsMatrix | null;
}

/** The wire shape of `GET /api/me`. */
interface MeResponse {
  id: string | null;
  authUserId: string;
  personId: string | null;
  email: string;
  emailVerified: boolean;
  townId: string | null;
  role: string | null;
  govTitle: string | null;
  permissions: unknown;
}

const VALID_ROLES = new Set<UserRole>(["sys_admin", "admin", "staff", "board_member"]);

/**
 * Read the current identity from the API.
 *
 * Returns `null` when there is no session — a 401 is the expected answer for a
 * signed-out visitor, not an error worth surfacing. Everything else throws,
 * because a 403 or a 500 here means something is wrong that the user needs to
 * be told about rather than silently treated as "signed out", which would send
 * them round the login page in a loop.
 */
export async function fetchCurrentUser(): Promise<CurrentUser | null> {
  const response = await apiJson<MeResponse>("/api/me");

  const role = response.role;
  return {
    id: response.id,
    authUserId: response.authUserId,
    personId: response.personId,
    email: response.email,
    emailVerified: response.emailVerified,
    townId: response.townId,
    // An unrecognised role becomes `null`, never a default. The old code
    // defaulted to "admin", so an absent claim was a full administrator.
    role: role !== null && VALID_ROLES.has(role as UserRole) ? (role as UserRole) : null,
    govTitle: response.govTitle,
    permissions: isPermissionsMatrix(response.permissions) ? response.permissions : null,
  };
}

function isPermissionsMatrix(value: unknown): value is PermissionsMatrix {
  return !!value && typeof value === "object" && "global" in value;
}
