import { useState } from "react";
import { Building, Menu, X } from "lucide-react";
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

  const municipalityLabel = getMunicipalityLabel(municipalityType);
  const fullName = `${municipalityLabel} of ${townName}`;

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
          <div>
            <h1 className="text-lg font-bold leading-tight sm:text-xl">
              {fullName}
            </h1>
            <p className="text-sm text-slate-300">Municipal Government</p>
          </div>
        </div>
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
