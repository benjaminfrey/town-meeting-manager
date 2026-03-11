import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { Building2, Users, ChevronRight, Calendar } from "lucide-react";
import { usePortal } from "../PortalProvider";
import { usePortalMeta } from "@/lib/portal/seo";
import { fetchBoardDetail } from "@/lib/portal-api";
import type { PortalBoardDetail } from "@town-meeting/shared";

function formatBoardType(type: string): string {
  return type
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function formatDate(date: string): string {
  return new Date(date + "T00:00:00").toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function Spinner() {
  return (
    <div className="flex justify-center py-12">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-slate-600" />
    </div>
  );
}

export default function BoardDetail() {
  const { townId, townName, sealUrl } = usePortal();
  const { boardId } = useParams<{ boardId: string }>();
  const [board, setBoard] = useState<PortalBoardDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  usePortalMeta(board ? {
    title: `${board.name} - ${townName}`,
    description: `Members and meeting information for ${board.name}.`,
    siteName: townName ?? undefined,
    ogImage: sealUrl,
  } : null);

  useEffect(() => {
    if (!boardId) return;
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        setError(null);
        const data = await fetchBoardDetail(townId, boardId!);
        if (!cancelled) {
          setBoard(data);
        }
      } catch {
        if (!cancelled) {
          setError("Unable to load board details. Please try again later.");
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
  }, [townId, boardId]);

  if (loading) return <Spinner />;

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-center">
        <p className="text-red-800">{error}</p>
      </div>
    );
  }

  if (!board) return null;

  return (
    <div>
      {/* Breadcrumb */}
      <nav aria-label="Breadcrumb" className="mb-6">
        <ol className="flex items-center gap-1 text-sm text-slate-500">
          <li>
            <a
              href="/boards"
              className="font-medium text-blue-700 underline hover:text-blue-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
            >
              Boards
            </a>
          </li>
          <li aria-hidden="true">
            <ChevronRight className="h-4 w-4" />
          </li>
          <li className="font-medium text-slate-700">{board.name}</li>
        </ol>
      </nav>

      {/* Board Header Card */}
      <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900 sm:text-3xl">
              <Building2
                className="h-7 w-7 text-slate-500"
                aria-hidden="true"
              />
              {board.name}
            </h1>

            <div className="mt-3 flex flex-wrap items-center gap-2">
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
              <span className="inline-flex items-center gap-1 text-sm text-slate-500">
                <Users className="h-4 w-4" aria-hidden="true" />
                {board.member_count}{" "}
                {board.member_count === 1 ? "Member" : "Members"}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Member Roster */}
      <section className="mt-6" aria-labelledby="members-heading">
        <h2
          id="members-heading"
          className="mb-4 text-lg font-semibold text-slate-900"
        >
          Current Members
        </h2>

        {board.members.length === 0 ? (
          <p className="text-sm text-slate-500">No active members.</p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-gray-200">
            <table className="w-full">
              <thead className="bg-slate-100">
                <tr>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">
                    Name
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">
                    Title / Seat
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">
                    Term Start
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">
                    Term End
                  </th>
                </tr>
              </thead>
              <tbody>
                {board.members.map((member, i) => (
                  <tr key={i}>
                    <td className="border-t px-4 py-3 text-sm text-gray-600">
                      {member.name}
                    </td>
                    <td className="border-t px-4 py-3 text-sm text-gray-600">
                      {member.seat_title || "\u2014"}
                    </td>
                    <td className="border-t px-4 py-3 text-sm text-gray-600">
                      {member.term_start ? formatDate(member.term_start) : "\u2014"}
                    </td>
                    <td className="border-t px-4 py-3 text-sm text-gray-600">
                      {member.term_end ? formatDate(member.term_end) : "\u2014"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Upcoming Meetings Link */}
      <div className="mt-6">
        <a
          href={`/meetings?board=${board.id}`}
          className="inline-flex items-center gap-1 text-sm font-medium text-blue-700 underline hover:text-blue-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        >
          <Calendar className="h-4 w-4" aria-hidden="true" />
          View upcoming meetings for this board
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </a>
      </div>
    </div>
  );
}
