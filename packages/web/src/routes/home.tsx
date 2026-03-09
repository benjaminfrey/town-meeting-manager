import { redirect } from "react-router";

export function clientLoader() {
  // Redirect root to dashboard
  // Will redirect to /login if not authenticated in session 02.03
  throw redirect("/dashboard");
}

export default function Home() {
  // This should never render due to the redirect in clientLoader
  return null;
}
