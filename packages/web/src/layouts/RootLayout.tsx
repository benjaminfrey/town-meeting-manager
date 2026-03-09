import { useState } from "react";
import { Link, Outlet, useLocation } from "react-router";
import { ErrorBoundary } from "react-error-boundary";
import {
  LayoutDashboard,
  List,
  CalendarDays,
  Settings,
  Menu,
  X,
  Sun,
  Moon,
  Monitor,
  Wifi,
  WifiOff,
} from "lucide-react";
import { APP_NAME } from "@town-meeting/shared";
import { useTheme } from "@/providers/ThemeProvider";
import { ErrorFallback } from "@/components/ErrorFallback";
import { cn } from "@/lib/utils";

const navItems = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Boards", href: "/boards/overview", icon: List },
  { label: "Meetings", href: "/meetings/upcoming", icon: CalendarDays },
  { label: "Settings", href: "/settings", icon: Settings },
];

function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  const cycleTheme = () => {
    if (theme === "light") setTheme("dark");
    else if (theme === "dark") setTheme("system");
    else setTheme("light");
  };

  return (
    <button
      onClick={cycleTheme}
      className="inline-flex h-9 w-9 items-center justify-center rounded-md border bg-background text-sm font-medium shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground"
      title={`Theme: ${theme}`}
    >
      {theme === "light" && <Sun className="h-4 w-4" />}
      {theme === "dark" && <Moon className="h-4 w-4" />}
      {theme === "system" && <Monitor className="h-4 w-4" />}
      <span className="sr-only">Toggle theme ({theme})</span>
    </button>
  );
}

function SyncStatusIndicator() {
  // Placeholder — will be connected to PowerSync in session 02.02
  return (
    <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
      <Wifi className="h-4 w-4 text-green-500" />
      <span className="hidden sm:inline">Synced</span>
    </div>
  );
}

function Sidebar({ onClose }: { onClose?: () => void }) {
  const location = useLocation();

  return (
    <div className="flex h-full w-64 flex-col border-r bg-sidebar text-sidebar-foreground">
      {/* Sidebar header */}
      <div className="flex h-14 items-center justify-between border-b px-4">
        <Link to="/dashboard" className="text-lg font-semibold">
          {APP_NAME}
        </Link>
        {onClose && (
          <button
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-sidebar-accent md:hidden"
          >
            <X className="h-4 w-4" />
            <span className="sr-only">Close sidebar</span>
          </button>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 p-3">
        {navItems.map((item) => {
          const isActive = location.pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              to={item.href}
              onClick={onClose}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Sidebar footer */}
      <div className="border-t p-3">
        <div className="rounded-md bg-sidebar-accent/50 px-3 py-2 text-xs text-sidebar-foreground/60">
          Town Meeting Manager
        </div>
      </div>
    </div>
  );
}

export default function RootLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Desktop sidebar */}
      <div className="hidden md:flex">
        <Sidebar />
      </div>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/50"
            onClick={() => setSidebarOpen(false)}
          />
          {/* Sidebar panel */}
          <div className="fixed inset-y-0 left-0 z-50 w-64">
            <Sidebar onClose={() => setSidebarOpen(false)} />
          </div>
        </div>
      )}

      {/* Main content area */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Header */}
        <header className="flex h-14 items-center gap-4 border-b bg-background px-4">
          {/* Mobile menu button */}
          <button
            onClick={() => setSidebarOpen(true)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border bg-background text-sm font-medium shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground md:hidden"
          >
            <Menu className="h-4 w-4" />
            <span className="sr-only">Open sidebar</span>
          </button>

          {/* Header title - mobile only */}
          <span className="text-lg font-semibold md:hidden">{APP_NAME}</span>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Header actions */}
          <div className="flex items-center gap-3">
            <SyncStatusIndicator />
            <ThemeToggle />
            {/* User menu placeholder */}
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-xs font-medium text-primary-foreground">
              U
            </div>
          </div>
        </header>

        {/* Main content with error boundary */}
        <main className="flex-1 overflow-auto">
          <ErrorBoundary FallbackComponent={ErrorFallback}>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}
