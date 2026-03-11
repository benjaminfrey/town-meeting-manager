import { createContext, useContext, useEffect, useState } from "react";
import type { PortalTownInfo } from "@town-meeting/shared";
import { resolveSubdomain, PortalApiError } from "@/lib/portal-api";

interface PortalContextValue {
  townId: string;
  townName: string;
  sealUrl: string | null;
  municipalityType: string;
  contactName: string;
  contactRole: string;
  isLoading: boolean;
  error: string | null;
}

const PortalContext = createContext<PortalContextValue | null>(null);

export function usePortal(): PortalContextValue {
  const ctx = useContext(PortalContext);
  if (!ctx) {
    throw new Error("usePortal must be used within a PortalProvider");
  }
  return ctx;
}

export function PortalProvider({
  subdomain,
  children,
}: {
  subdomain: string;
  children: React.ReactNode;
}) {
  const [townInfo, setTownInfo] = useState<PortalTownInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function resolve() {
      try {
        setIsLoading(true);
        setError(null);
        const info = await resolveSubdomain(subdomain);
        if (!cancelled) {
          setTownInfo(info);
        }
      } catch (err) {
        if (!cancelled) {
          if (err instanceof PortalApiError && err.status === 404) {
            setError("not_found");
          } else {
            setError("unknown");
          }
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    resolve();
    return () => {
      cancelled = true;
    };
  }, [subdomain]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="flex flex-col items-center gap-3">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-slate-300 border-t-slate-700" />
          <p className="text-sm text-slate-500">Loading portal...</p>
        </div>
      </div>
    );
  }

  if (error || !townInfo) {
    return <TownNotFound subdomain={subdomain} />;
  }

  const value: PortalContextValue = {
    townId: townInfo.id,
    townName: townInfo.name,
    sealUrl: townInfo.seal_url,
    municipalityType: townInfo.municipality_type,
    contactName: townInfo.contact_name,
    contactRole: townInfo.contact_role,
    isLoading: false,
    error: null,
  };

  return (
    <PortalContext.Provider value={value}>{children}</PortalContext.Provider>
  );
}

function TownNotFound({ subdomain }: { subdomain: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="mx-auto max-w-md rounded-lg border border-gray-200 bg-white p-8 text-center shadow-sm">
        <h1 className="text-2xl font-bold text-gray-900">Town Not Found</h1>
        <p className="mt-3 text-gray-600">
          We couldn&apos;t find a portal for &ldquo;{subdomain}
          .townmeetingmanager.com&rdquo;.
        </p>
        <p className="mt-6 text-sm text-gray-500">
          Are you a town administrator?{" "}
          <a
            href="https://app.townmeetingmanager.com"
            className="font-medium text-blue-600 underline hover:text-blue-800"
          >
            Set up your portal at app.townmeetingmanager.com
          </a>
        </p>
      </div>
    </div>
  );
}
