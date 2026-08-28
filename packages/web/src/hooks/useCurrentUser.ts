/**
 * The current user's identity, town and permissions.
 *
 * ─── Stage 1, Task C2: this no longer decodes anything ────────────────────
 *
 * It used to base64-decode the Supabase access token and read custom claims
 * that `custom_access_token_hook()` injected. Phase B deleted GoTrue and that
 * hook with it. The facts now come from `GET /api/me`, which reads them out of
 * `user_account` through row level security — see `lib/current-user.ts` for
 * the full rationale and for the historical `role` collision that must not be
 * reintroduced.
 *
 * The hook's signature is unchanged on purpose. Thirty-odd components call it
 * and every one of them wants the same thing; changing the shape as well as
 * the source would have buried this migration inside an unrelated refactor.
 * `AuthProvider` owns the fetch, so the value is synchronous here and
 * `useAuth().isLoading` stays true until it has arrived — which is what stops
 * `ProtectedRoute` from bouncing a signed-in user into the onboarding wizard
 * while the answer is still in flight.
 */

import { useAuth } from "@/providers/AuthProvider";

export type { CurrentUser } from "@/lib/current-user";

export function useCurrentUser() {
  return useAuth().currentUser;
}
