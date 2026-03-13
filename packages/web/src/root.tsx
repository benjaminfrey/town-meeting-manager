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
import { AuthProvider } from "@/providers/AuthProvider";
import { QueryProvider } from "@/providers/QueryProvider";
import { Toaster } from "@/components/ui/sonner";
import { detectPortalSubdomain } from "@/lib/portal";
import { PortalApp } from "@/portal/PortalApp";
import { InstallBanner } from "@/components/pwa/InstallBanner";
import { UpdateNotification } from "@/components/pwa/UpdateNotification";
import { NotificationPermissionPrompt } from "@/components/pwa/NotificationPermissionPrompt";
import "./app.css";

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
        {/* PWA meta tags */}
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#1e3a5f" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="TownMeet" />
        <link rel="apple-touch-icon" href="/icons/icon-192.png" />
        <link rel="icon" type="image/x-icon" href="/favicon.ico" />
        <link rel="icon" type="image/png" sizes="32x32" href="/icons/icon-32.png" />
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

export default function App() {
  const subdomain = detectPortalSubdomain(window.location.hostname);

  if (subdomain) {
    return <PortalApp subdomain={subdomain} />;
  }

  return (
    <ThemeProvider>
      <AuthProvider>
        <QueryProvider>
          <Outlet />
          <Toaster position="top-right" richColors closeButton />
          <UpdateNotification />
          <InstallBanner />
          <NotificationPermissionPrompt />
        </QueryProvider>
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
