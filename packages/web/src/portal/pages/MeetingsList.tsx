import { useEffect, useState, useCallback } from "react";
import {
  Calendar,
  Clock,
  MapPin,
  FileText,
  ChevronRight,
} from "lucide-react";
import { usePortal } from "../PortalProvider";
import { usePortalMeta } from "@/lib/portal/seo";
import { fetchMeetings, fetchBoards } from "@/lib/portal-api";
import type {
  PortalMeetingSummary,
  PortalBoardSummary,
} from "@town-meeting/shared";

function formatDate(date: string): string {
  return new Date(date + "T00:00:00").toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function Spinner() {
  return (
    <div className="flex justify-center py-8">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-slate-600" />
    </div>
  );
}

const BOARD_BADGE_COLORS = [
  "bg-blue-100 text-blue-800",
  "bg-green-100 text-green-800",
  "bg-purple-100 text-purple-800",
  "bg-amber-100 text-amber-800",
  "bg-rose-100 text-rose-800",
  "bg-cyan-100 text-cyan-800",
  "bg-indigo-100 text-indigo-800",
  "bg-teal-100 text-teal-800",
];

function getBoardBadgeColor(boardId: string, boards: PortalBoardSummary[]): string {
  const index = boards.findIndex((b) => b.id === boardId);
  return BOARD_BADGE_COLORS[index >= 0 ? index % BOARD_BADGE_COLORS.length : 0]!;
}

function MeetingRow({
  meeting,
  boards,
}: {
  meeting: PortalMeetingSummary;
  boards: PortalBoardSummary[];
}) {
  const badgeColor = getBoardBadgeColor(meeting.board_id, boards);

  return (
    <li className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${badgeColor}`}
            >
              {meeting.board_name}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-600">
            <span className="flex items-center gap-1">
              <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
              {formatDate(meeting.scheduled_date)}
            </span>
            <span className="flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" aria-hidden="true" />
              {meeting.scheduled_time}
            </span>
            <span className="flex items-center gap-1">
              <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
              {meeting.location}
            </span>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-3">
          <a
            href={`/meetings/${meeting.id}`}
            className="text-sm font-medium text-blue-700 underline hover:text-blue-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          >
            Details
          </a>
          {meeting.has_published_agenda && (
            <a
              href={`/meetings/${meeting.id}/agenda`}
              className="inline-flex items-center gap-1 text-sm font-medium text-blue-700 underline hover:text-blue-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
            >
              <FileText className="h-3.5 w-3.5" aria-hidden="true" />
              Agenda
            </a>
          )}
          {meeting.has_published_minutes && (
            <a
              href={`/meetings/${meeting.id}/minutes`}
              className="inline-flex items-center gap-1 text-sm font-medium text-blue-700 underline hover:text-blue-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
            >
              <FileText className="h-3.5 w-3.5" aria-hidden="true" />
              Minutes
            </a>
          )}
        </div>
      </div>
    </li>
  );
}

export default function MeetingsList() {
  const { townId, townName, sealUrl } = usePortal();

  usePortalMeta({
    title: `Meetings - ${townName}`,
    description: `Upcoming and past meetings for ${townName} boards and committees.`,
    siteName: townName ?? undefined,
    ogImage: sealUrl,
  });

  const [meetings, setMeetings] = useState<PortalMeetingSummary[]>([]);
  const [boards, setBoards] = useState<PortalBoardSummary[]>([]);
  const [selectedBoard, setSelectedBoard] = useState<string>("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load boards for filter dropdown
  useEffect(() => {
    fetchBoards(townId)
      .then(setBoards)
      .catch(() => {
        /* boards filter is non-critical */
      });
  }, [townId]);

  // Load meetings
  const loadMeetings = useCallback(
    async (pageNum: number, boardFilter: string, append: boolean) => {
      try {
        if (append) {
          setLoadingMore(true);
        } else {
          setLoading(true);
        }
        setError(null);

        const params: { board?: string; page?: number } = { page: pageNum };
        if (boardFilter) params.board = boardFilter;

        const res = await fetchMeetings(townId, params);

        if (append) {
          setMeetings((prev) => [...prev, ...res.meetings]);
        } else {
          setMeetings(res.meetings);
        }
        setTotal(res.total);
        setPage(res.page);
      } catch {
        setError("Unable to load meetings. Please try again later.");
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [townId],
  );

  useEffect(() => {
    loadMeetings(1, selectedBoard, false);
  }, [selectedBoard, loadMeetings]);

  const today = new Date().toISOString().split("T")[0]!;
  const upcomingMeetings = meetings
    .filter((m) => m.scheduled_date >= today)
    .sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date));
  const pastMeetings = meetings
    .filter((m) => m.scheduled_date < today)
    .sort((a, b) => b.scheduled_date.localeCompare(a.scheduled_date));

  const hasMore = meetings.length < total;

  function handleLoadMore() {
    loadMeetings(page + 1, selectedBoard, true);
  }

  function handleBoardChange(e: React.ChangeEvent<HTMLSelectElement>) {
    setSelectedBoard(e.target.value);
  }

  return (
    <div>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-2xl font-bold text-slate-900">Meetings</h2>

        {/* Board Filter */}
        <div className="flex items-center gap-2">
          <label
            htmlFor="board-filter"
            className="text-sm font-medium text-slate-700"
          >
            Board:
          </label>
          <select
            id="board-filter"
            value={selectedBoard}
            onChange={handleBoardChange}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All Boards</option>
            {boards.map((board) => (
              <option key={board.id} value={board.id}>
                {board.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-center">
          <p className="text-sm text-red-800">{error}</p>
        </div>
      )}

      {loading ? (
        <Spinner />
      ) : meetings.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white p-8 text-center shadow-sm">
          <p className="text-slate-500">No meetings found.</p>
        </div>
      ) : (
        <div className="space-y-8">
          {/* Upcoming Meetings */}
          {upcomingMeetings.length > 0 && (
            <section aria-labelledby="upcoming-heading">
              <h3
                id="upcoming-heading"
                className="mb-4 flex items-center gap-2 text-lg font-semibold text-slate-900"
              >
                <Calendar className="h-5 w-5 text-slate-500" aria-hidden="true" />
                Upcoming Meetings
              </h3>
              <ul className="space-y-3">
                {upcomingMeetings.map((meeting) => (
                  <MeetingRow
                    key={meeting.id}
                    meeting={meeting}
                    boards={boards}
                  />
                ))}
              </ul>
            </section>
          )}

          {/* Past Meetings */}
          {pastMeetings.length > 0 && (
            <section aria-labelledby="past-heading">
              <h3
                id="past-heading"
                className="mb-4 flex items-center gap-2 text-lg font-semibold text-slate-900"
              >
                <FileText className="h-5 w-5 text-slate-500" aria-hidden="true" />
                Past Meetings
              </h3>
              <ul className="space-y-3">
                {pastMeetings.map((meeting) => (
                  <MeetingRow
                    key={meeting.id}
                    meeting={meeting}
                    boards={boards}
                  />
                ))}
              </ul>
            </section>
          )}
        </div>
      )}

      {/* Load More */}
      {hasMore && !loading && (
        <div className="mt-8 text-center">
          <button
            type="button"
            onClick={handleLoadMore}
            disabled={loadingMore}
            className="inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-5 py-2.5 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50"
          >
            {loadingMore ? (
              <>
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600" />
                Loading...
              </>
            ) : (
              <>
                Load More
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
