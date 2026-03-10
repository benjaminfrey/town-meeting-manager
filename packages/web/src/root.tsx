import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  isRouteErrorResponse,
} from "react-router";
import type { Route } from "./+types/root";
import { ThemeProvider } from "@/providers/ThemeProvider";
import { AuthProvider, useAuth } from "@/providers/AuthProvider";
import { PowerSyncProvider } from "@/providers/PowerSyncProvider";
import { Toaster } from "@/components/ui/sonner";
import { supabase } from "@/lib/supabase";
import "./app.css";

const powersyncUrl = import.meta.env.VITE_POWERSYNC_URL || "http://localhost:8080";

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
        {/* Inline script to prevent FOUC for dark mode */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  var theme = localStorage.getItem('tmm-theme');
                  if (theme === 'dark' || (!theme && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
                    document.documentElement.classList.add('dark');
                  }
                } catch(e) {}
              })();
            `,
          }}
        />
      </head>
      <body className="min-h-screen bg-background font-sans antialiased">
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

/**
 * Inner component that reads auth state and passes it to PowerSyncProvider.
 * Must be a child of AuthProvider to access useAuth().
 */
function AppWithAuth() {
  const { isAuthenticated } = useAuth();

  return (
    <PowerSyncProvider
      supabaseClient={supabase}
      powersyncUrl={powersyncUrl}
      authenticated={isAuthenticated}
    >
      <Outlet />
      <Toaster position="top-right" richColors closeButton />
    </PowerSyncProvider>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <AppWithAuth />
      </AuthProvider>
    </ThemeProvider>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let message = "Oops!";
  let details = "An unexpected error occurred.";
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "404" : "Error";
    details =
      error.status === 404
        ? "The requested page could not be found."
        : error.statusText || details;
  } else if (import.meta.env.DEV && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="mx-auto max-w-md rounded-lg border bg-card p-8 text-card-foreground shadow-sm">
        <h1 className="text-2xl font-bold">{message}</h1>
        <p className="mt-2 text-muted-foreground">{details}</p>
        {stack && (
          <pre className="mt-4 max-h-60 overflow-auto rounded bg-muted p-4 text-xs">
            <code>{stack}</code>
          </pre>
        )}
      </div>
    </main>
  );
}
