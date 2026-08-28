/**
 * Stage 1, Task C2 — the Better Auth browser client.
 *
 * Replaces `supabase.auth.*`, which the API stopped accepting when Task G1
 * deleted the JWT verifier: the session is now an HTTP-only cookie set by
 * `/api/auth/*` and read by the tenant bridge, and there is no token for
 * JavaScript to hold, forward, or leak.
 *
 * ─── No `baseURL`, deliberately ───────────────────────────────────────────
 *
 * `basePath: "/api/auth"` with no origin makes every request root-relative and
 * therefore same-origin, which is what lets the session cookie stay
 * `SameSite=Lax`. Giving this a configurable origin would reintroduce exactly
 * the split `lib/api-client.ts`'s header describes: `VITE_API_URL` pointing
 * the browser at a different host from the one serving the app, in
 * development and production, at two different pairs of origins.
 *
 * The server half must agree: `BETTER_AUTH_URL` is the origin the BROWSER
 * loads the app from, because Better Auth derives `trustedOrigins` from it and
 * refuses any state-changing request whose `Origin` header does not match.
 *
 * ─── What replaced `onAuthStateChange` ────────────────────────────────────
 *
 * Supabase pushed auth events at subscribers because it held the session in
 * `localStorage` and refreshed it on a timer. A cookie session has no such
 * lifecycle in the page: the browser attaches it, the server validates it, and
 * `useSession()` is a subscription to the answer. `AuthProvider` is built on
 * that rather than on an event stream, which is why its `TOKEN_REFRESHED` and
 * `INITIAL_SESSION` branches are gone rather than translated.
 */

import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  basePath: "/api/auth",
  fetchOptions: {
    // Same-origin, so this is already the default — stated because it is the
    // property the whole session design rests on, and a default that changes
    // should break loudly here rather than silently everywhere.
    credentials: "include",
  },
});

// Deliberately NOT re-exported as loose `signIn` / `signOut` / `useSession`
// bindings. Destructuring them here produces a type TypeScript cannot name
// without reaching into `better-auth/dist`, and — more usefully — `authClient`
// at every call site says which client is being driven, which matters in a
// codebase that until this commit had two.
