/**
 * Back-compat redirect → the canonical Home (`/`), preserving the query string.
 * Used for the legacy `/home` and `/dashboard` paths that older links,
 * bookmarks, and push-notification URLs may still point at.
 */

import { redirect } from "react-router";

export function clientLoader({ request }: { request: Request }) {
  const url = new URL(request.url);
  throw redirect("/" + url.search);
}

export default function RedirectHome() {
  return null;
}
