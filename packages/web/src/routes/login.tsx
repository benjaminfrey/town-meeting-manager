import type { Route } from "./+types/login";
import { RouteErrorBoundary } from "@/components/RouteErrorBoundary";

export async function clientLoader() {
  // Will check auth state in session 02.03
  return {};
}

export default function Login() {
  return (
    <div className="rounded-lg border bg-card p-6 text-card-foreground shadow-sm">
      <h2 className="text-lg font-semibold">Sign In</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Authentication will be configured in session 02.03.
      </p>

      {/* Placeholder login form */}
      <div className="mt-6 space-y-4">
        <div className="space-y-2">
          <label
            htmlFor="email"
            className="text-sm font-medium leading-none"
          >
            Email
          </label>
          <input
            id="email"
            type="email"
            placeholder="admin@yourtown.gov"
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          />
        </div>
        <div className="space-y-2">
          <label
            htmlFor="password"
            className="text-sm font-medium leading-none"
          >
            Password
          </label>
          <input
            id="password"
            type="password"
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          />
        </div>
        <button className="inline-flex h-10 w-full items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90">
          Sign in
        </button>
      </div>
    </div>
  );
}

export { RouteErrorBoundary as ErrorBoundary };
