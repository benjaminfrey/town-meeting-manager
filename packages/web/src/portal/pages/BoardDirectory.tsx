import { useEffect, useState } from "react";
import { Building2, Users } from "lucide-react";
import { usePortal } from "../PortalProvider";
import { usePortalMeta } from "@/lib/portal/seo";
import { fetchBoards } from "@/lib/portal-api";
import type { PortalBoardSummary } from "@town-meeting/shared";

function formatBoardType(type: string): string {
  return type
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function Spinner() {
  return (
    <div className="flex justify-center py-12">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-slate-600" />
    </div>
  );
}

export default function BoardDirectory() {
  const { townId, townName, sealUrl } = usePortal();

  usePortalMeta({
    title: `Boards & Committees - ${townName}`,
    description: `Directory of boards, committees, and members for ${townName}.`,
    siteName: townName ?? undefined,
    ogImage: sealUrl,
  });

  const [boards, setBoards] = useState<PortalBoardSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        setError(null);
        const data = await fetchBoards(townId);
        if (!cancelled) {
          setBoards(data);
        }
      } catch {
        if (!cancelled) {
          setError("Unable to load boards. Please try again later.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [townId]);

  return (
    <div>
      <section className="mb-8">
        <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900 sm:text-3xl">
          <Building2 className="h-7 w-7 text-slate-500" aria-hidden="true" />
          Boards &amp; Committees
        </h1>
      </section>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-center">
          <p className="text-red-800">{error}</p>
        </div>
      )}

      {loading && <Spinner />}

      {!loading && !error && boards.length === 0 && (
        <p className="text-sm text-slate-500">No active boards.</p>
      )}

      {!loading && !error && boards.length > 0 && (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {boards.map((board) => (
            <a
              key={board.id}
              href={`/boards/${board.id}`}
              className="group rounded-lg border border-gray-200 bg-white p-6 shadow-sm transition-colors hover:border-blue-300 hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
            >
              <h2 className="text-lg font-semibold text-slate-900 group-hover:text-blue-900">
                {board.name}
              </h2>

              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700">
                  {formatBoardType(board.board_type)}
                </span>
                {board.elected_or_appointed && (
                  <span className="inline-flex items-center rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700">
                    {board.elected_or_appointed === "elected"
                      ? "Elected"
                      : "Appointed"}
                  </span>
                )}
              </div>

              <p className="mt-3 flex items-center gap-1.5 text-sm text-slate-500">
                <Users className="h-4 w-4" aria-hidden="true" />
                {board.member_count}{" "}
                {board.member_count === 1 ? "Member" : "Members"}
              </p>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
