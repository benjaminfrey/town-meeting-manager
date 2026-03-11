import { useState } from "react";
import { Building, Menu, Search, X } from "lucide-react";
import { usePortal } from "./PortalProvider";

function getMunicipalityLabel(type: string): string {
  switch (type?.toLowerCase()) {
    case "city":
      return "City";
    case "village":
      return "Village";
    case "borough":
      return "Borough";
    default:
      return "Town";
  }
}

const NAV_ITEMS = [
  { label: "Meetings", href: "/meetings" },
  { label: "Boards", href: "/boards" },
  { label: "Calendar", href: "/calendar" },
];

export function PortalLayout({ children }: { children: React.ReactNode }) {
  const { townName, sealUrl, municipalityType, contactName, contactRole } =
    usePortal();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [showMobileSearch, setShowMobileSearch] = useState(false);

  const municipalityLabel = getMunicipalityLabel(municipalityType);
  const fullName = `${municipalityLabel} of ${townName}`;

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      window.location.href = `/search?q=${encodeURIComponent(searchQuery.trim())}`;
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      {/* Skip to content */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-slate-900 focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        Skip to content
      </a>

      {/* Header */}
      <header className="bg-slate-800 text-white">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-4 sm:px-6">
          {sealUrl ? (
            <img
              src={sealUrl}
              alt={`${fullName} seal`}
              className="h-12 w-12 rounded-full object-cover"
            />
          ) : (
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-700">
              <Building className="h-6 w-6 text-slate-300" />
            </div>
          )}
          <div className="flex-1">
            <h1 className="text-lg font-bold leading-tight sm:text-xl">
              {fullName}
            </h1>
            <p className="text-sm text-slate-300">Municipal Government</p>
          </div>

          {/* Desktop search */}
          <form
            role="search"
            aria-label="Search portal"
            onSubmit={handleSearch}
            className="hidden sm:flex sm:items-center"
          >
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search agendas and minutes..."
                className="w-full max-w-xs rounded-md border border-slate-600 bg-slate-700 py-1.5 pl-9 pr-3 text-sm text-white placeholder-slate-400 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
              />
            </div>
          </form>

          {/* Mobile search toggle */}
          <button
            type="button"
            onClick={() => setShowMobileSearch(!showMobileSearch)}
            className="inline-flex items-center justify-center rounded-md p-2 text-slate-300 hover:bg-slate-700 hover:text-white focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-400 sm:hidden"
            aria-label={showMobileSearch ? "Close search" : "Open search"}
          >
            {showMobileSearch ? (
              <X className="h-5 w-5" />
            ) : (
              <Search className="h-5 w-5" />
            )}
          </button>
        </div>

        {/* Mobile search bar (expanded) */}
        {showMobileSearch && (
          <div className="border-t border-slate-700 px-4 py-3 sm:hidden">
            <form
              role="search"
              aria-label="Search portal"
              onSubmit={handleSearch}
            >
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search agendas and minutes..."
                  autoFocus
                  className="w-full rounded-md border border-slate-600 bg-slate-700 py-2 pl-10 pr-3 text-sm text-white placeholder-slate-400 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
                />
              </div>
            </form>
          </div>
        )}
      </header>

      {/* Navigation */}
      <nav className="bg-slate-700" aria-label="Main navigation">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          {/* Desktop nav */}
          <ul className="hidden sm:flex sm:gap-1">
            {NAV_ITEMS.map((item) => (
              <li key={item.href}>
                <a
                  href={item.href}
                  className="inline-block px-4 py-2.5 text-sm font-medium text-slate-200 transition-colors hover:bg-slate-600 hover:text-white focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-400"
                >
                  {item.label}
                </a>
              </li>
            ))}
          </ul>

          {/* Mobile nav toggle */}
          <div className="flex sm:hidden">
            <button
              type="button"
              onClick={() => setMobileNavOpen(!mobileNavOpen)}
              className="inline-flex items-center gap-2 px-3 py-2.5 text-sm font-medium text-slate-200 hover:text-white focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-400"
              aria-expanded={mobileNavOpen}
              aria-controls="mobile-nav"
            >
              {mobileNavOpen ? (
                <X className="h-5 w-5" />
              ) : (
                <Menu className="h-5 w-5" />
              )}
              Menu
            </button>
          </div>

          {/* Mobile nav menu */}
          {mobileNavOpen && (
            <ul
              id="mobile-nav"
              className="border-t border-slate-600 pb-2 sm:hidden"
            >
              {NAV_ITEMS.map((item) => (
                <li key={item.href}>
                  <a
                    href={item.href}
                    className="block px-4 py-2.5 text-sm font-medium text-slate-200 hover:bg-slate-600 hover:text-white focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-400"
                    onClick={() => setMobileNavOpen(false)}
                  >
                    {item.label}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      </nav>

      {/* Main content */}
      <main id="main-content" className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
        {children}
      </main>

      {/* Footer */}
      <footer className="bg-slate-800 text-gray-300">
        <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-medium text-white">{fullName}</p>
              <p className="mt-1 text-sm">
                Contact: {contactRole}
                {contactName && ` \u00B7 ${contactName}`}
              </p>
            </div>
            <div className="text-sm">
              <p>
                Powered by{" "}
                <a
                  href="https://townmeetingmanager.com"
                  className="underline hover:text-white focus:outline-none focus:ring-2 focus:ring-blue-400"
                >
                  Town Meeting Manager
                </a>
              </p>
              <a
                href="/accessibility"
                className="mt-1 inline-block underline hover:text-white focus:outline-none focus:ring-2 focus:ring-blue-400"
              >
                Accessibility Statement
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
