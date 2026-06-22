/**
 * Back-compat redirect → the canonical People directory (`/people`), preserving
 * the query string. The town-level page was briefly shipped at `/members`.
 */

import { redirect } from "react-router";

export function clientLoader({ request }: { request: Request }) {
  const url = new URL(request.url);
  throw redirect("/people" + url.search);
}

export default function RedirectPeople() {
  return null;
}
