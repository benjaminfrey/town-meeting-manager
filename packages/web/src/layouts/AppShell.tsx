/**
 * AppShell — the single application shell for all authenticated routes.
 *
 * Replaces the former RootLayout (sidebar) + MinimalLayout (rice-paper) split.
 * Structure: persistent labeled sidebar + top bar + command palette, with a
 * calm rice-paper surface inside. One consistent navigation everywhere.
 */

import { useState } from "react";
import { Link, Outlet, useLocation } from "react-router";
import { ErrorBoundary } from "react-error-boundary";
import { useQuery } from "@tanstack/react-query";
import {
  Home as HomeIcon,
  CalendarDays,
  List,
  Users,
  FileText,
  Settings,
  Menu,
  X,
  Search,
  PanelLeftClose,
  PanelLeftOpen,
  Radio,
} from "lucide-react";
import { APP_NAME } from "@town-meeting/shared";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { supabase } from "@/lib/supabase";
import { ErrorFallback } from "@/components/ErrorFallback";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { ConnectionStatusBar } from "@/components/ConnectionStatusBar";
import { LogoutDialog } from "@/components/LogoutDialog";
import { NavigationProgress } from "@/components/NavigationProgress";
import { CommandPalette } from "@/components/CommandPalette";
import { cn } from "@/lib/utils";

interface NavItem {
  label: string;
  href: string;
  icon: typeof HomeIcon;
  exact?: boolean;
}

const navItems: NavItem[] = [
  { label: "Home", href: "/", icon: HomeIcon, exact: true },
  { label: "Meetings", href: "/meetings", icon: CalendarDays },
  { label: "Boards", href: "/boards", icon: List },
  { label: "People", href: "/people", icon: Users },
  { label: "Templates", href: "/templates", icon: FileText },
  { label: "Settings", href: "/settings", icon: Settings },
];

/** Returns the id of an in-progress meeting for this town, or null. */
function useLiveMeetingId(townId: string | null): string | null {
  const { data } = useQuery({
    queryKey: ["live-meeting-indicator", townId],
    queryFn: async () => {
      const { data } = await supabase
        .from("meeting")
        .select("id")
        .eq("town_id", townId as string)
        .in("status", ["open", "in_progress"])
        .order("started_at", { ascending: false })
        .limit(1);
      return (data?.[0]?.id as string | undefined) ?? null;
    },
    enabled: !!townId,
    refetchInterval: 30_000,
  });
  return data ?? null;
}

function Sidebar({
  onClose,
  collapsed,
  onToggleCollapse,
  liveMeetingId,
}: {
  onClose?: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  liveMeetingId: string | null;
}) {
  const location = useLocation();
  const isActive = (item: NavItem) =>
    item.exact
      ? location.pathname === item.href
      : location.pathname.startsWith(item.href);

  return (
    <div
      className={cn(
        "flex h-full flex-col border-r bg-sidebar text-sidebar-foreground transition-[width] duration-200",
        collapsed ? "w-14" : "w-56",
      )}
    >
      {/* Wordmark — links Home */}
      <div className="flex h-14 items-center justify-between border-b px-3">
        {!collapsed && (
          <Link
            to="/"
            onClick={onClose}
            className="truncate text-base font-semibold tracking-tight"
          >
            {APP_NAME}
          </Link>
        )}
        {onClose && (
          <button
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-sidebar-accent md:hidden"
          >
            <X className="h-4 w-4" />
            <span className="sr-only">Close navigation</span>
          </button>
        )}
        {onToggleCollapse && (
          <button
            onClick={onToggleCollapse}
            className={cn(
              "hidden h-8 w-8 items-center justify-center rounded-md hover:bg-sidebar-accent md:inline-flex",
              collapsed && "mx-auto",
            )}
            title={collapsed ? "Expand navigation" : "Collapse navigation"}
          >
            {collapsed ? (
              <PanelLeftOpen className="h-4 w-4" />
            ) : (
              <PanelLeftClose className="h-4 w-4" />
            )}
          </button>
        )}
      </div>

      {/* Navigation */}
      <nav className={cn("flex-1 space-y-1", collapsed ? "px-1.5 py-3" : "p-3")}>
        {navItems.map((item) => {
          const active = isActive(item);
          return (
            <Link
              key={item.href}
              to={item.href}
              onClick={onClose}
              title={collapsed ? item.label : undefined}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center rounded-md text-sm font-medium transition-colors",
                collapsed ? "justify-center px-0 py-2" : "gap-3 px-3 py-2",
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              )}
            >
              <item.icon className="h-4 w-4 flex-shrink-0" />
              {!collapsed && item.label}
            </Link>
          );
        })}
      </nav>

      {/* Live-meeting indicator */}
      {liveMeetingId && (
        <Link
          to={`/meetings/${liveMeetingId}/live`}
          onClick={onClose}
          title="A meeting is in progress"
          className={cn(
            "m-2 flex items-center rounded-md border border-red-300 bg-red-50 text-red-700 transition-colors hover:bg-red-100 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300",
            collapsed ? "justify-center p-2" : "gap-2 px-3 py-2 text-sm font-medium",
          )}
        >
          <Radio className="h-4 w-4 flex-shrink-0 animate-pulse" />
          {!collapsed && "Meeting live"}
        </Link>
      )}
    </div>
  );
}

export default function AppShell() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [cmdPaletteOpen, setCmdPaletteOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem("sidebar-collapsed") === "true";
    } catch {
      return false;
    }
  });
  const currentUser = useCurrentUser();
  const liveMeetingId = useLiveMeetingId(currentUser?.townId ?? null);

  const toggleSidebarCollapse = () => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("sidebar-collapsed", String(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  const initials = currentUser?.email
    ? currentUser.email.charAt(0).toUpperCase()
    : "U";

  return (
    <ProtectedRoute>
      <NavigationProgress />

      {/* Skip-to-content (WCAG 2.4.1) */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[10000] focus:inline-flex focus:items-center focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground focus:shadow-lg"
      >
        Skip to main content
      </a>

      <div className="flex h-screen overflow-hidden">
        {/* Desktop sidebar */}
        <div className="hidden md:flex">
          <Sidebar
            collapsed={sidebarCollapsed}
            onToggleCollapse={toggleSidebarCollapse}
            liveMeetingId={liveMeetingId}
          />
        </div>

        {/* Mobile sidebar drawer */}
        {sidebarOpen && (
          <div className="fixed inset-0 z-50 md:hidden">
            <div
              className="fixed inset-0 bg-black/50"
              onClick={() => setSidebarOpen(false)}
            />
            <div className="fixed inset-y-0 left-0 z-50 w-56">
              <Sidebar
                onClose={() => setSidebarOpen(false)}
                liveMeetingId={liveMeetingId}
              />
            </div>
          </div>
        )}

        {/* Main column */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Top bar */}
          <header className="flex h-14 items-center gap-3 border-b bg-background px-4">
            <button
              onClick={() => setSidebarOpen(true)}
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border bg-background text-sm transition-colors hover:bg-accent md:hidden"
            >
              <Menu className="h-4 w-4" />
              <span className="sr-only">Open navigation</span>
            </button>
            <span className="text-base font-semibold md:hidden">{APP_NAME}</span>

            <div className="flex-1" />

            {/* Command palette trigger */}
            <button
              onClick={() => setCmdPaletteOpen(true)}
              title="Search (⌘K)"
              className="inline-flex h-9 items-center gap-2 rounded-md border bg-background px-3 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <Search className="h-4 w-4" />
              <span className="hidden sm:inline">Search</span>
              <kbd className="hidden rounded border bg-muted px-1.5 text-[10px] sm:inline">
                ⌘K
              </kbd>
            </button>

            <ConnectionStatusBar />

            <LogoutDialog
              trigger={
                <button
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-xs font-medium text-primary-foreground transition-opacity hover:opacity-80"
                  title={currentUser?.email ?? "Account"}
                >
                  {initials}
                </button>
              }
            />
          </header>

          {/* Content */}
          <main id="main-content" className="flex-1 overflow-auto" tabIndex={-1}>
            <ErrorBoundary FallbackComponent={ErrorFallback}>
              <Outlet />
            </ErrorBoundary>
          </main>
        </div>
      </div>

      <CommandPalette open={cmdPaletteOpen} onOpenChange={setCmdPaletteOpen} />
    </ProtectedRoute>
  );
}
