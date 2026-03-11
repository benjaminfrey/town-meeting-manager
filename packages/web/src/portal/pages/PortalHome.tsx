import { useEffect, useState } from "react";
import {
  Calendar,
  Clock,
  MapPin,
  FileText,
  ChevronRight,
  Building2,
} from "lucide-react";
import { usePortal } from "../PortalProvider";
import { usePortalMeta } from "@/lib/portal/seo";
import {
  fetchMeetings,
  fetchBoards,
} from "@/lib/portal-api";
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

export default function PortalHome() {
  const { townId, townName, sealUrl } = usePortal();

  usePortalMeta({
    title: `${townName} - Meeting Records`,
    description: `Official meeting agendas, minutes, and board information for ${townName}.`,
    siteName: townName ?? undefined,
    ogImage: sealUrl,
  });

  const [upcomingMeetings, setUpcomingMeetings] = useState<PortalMeetingSummary[]>([]);
  const [recentMinutes, setRecentMinutes] = useState<PortalMeetingSummary[]>([]);
  const [boards, setBoards] = useState<PortalBoardSummary[]>([]);
  const [loadingMeetings, setLoadingMeetings] = useState(true);
  const [loadingBoards, setLoadingBoards] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      try {
        const [meetingsRes, boardsRes] = await Promise.all([
          fetchMeetings(townId, { page: 1 }),
          fetchBoards(townId),
        ]);

        if (cancelled) return;

        const today = new Date().toISOString().split("T")[0];

        const upcoming = meetingsRes.meetings
          .filter((m) => m.scheduled_date >= today)
          .sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date))
          .slice(0, 5);

        const minutes = meetingsRes.meetings
          .filter((m) => m.scheduled_date < today && m.has_published_minutes)
          .sort((a, b) => b.scheduled_date.localeCompare(a.scheduled_date))
          .slice(0, 5);

        setUpcomingMeetings(upcoming);
        setRecentMinutes(minutes);
        setLoadingMeetings(false);
        setBoards(boardsRes);
        setLoadingBoards(false);
      } catch {
        if (!cancelled) {
          setError("Unable to load portal data. Please try again later.");
          setLoadingMeetings(false);
          setLoadingBoards(false);
        }
      }
    }

    loadData();
    return () => {
      cancelled = true;
    };
  }, [townId]);

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-center">
        <p className="text-red-800">{error}</p>
      </div>
    );
  }

  return (
    <div>
      {/* Welcome Section */}
      <section className="mb-8">
        <h2 className="text-2xl font-bold text-slate-900 sm:text-3xl">
          Welcome to the {townName} Municipal Portal
        </h2>
        <p className="mt-2 text-slate-600">
          Access meeting agendas, minutes, and board information for your
          community.
        </p>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Upcoming Meetings */}
        <section
          className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm"
          aria-labelledby="upcoming-meetings-heading"
        >
          <h3
            id="upcoming-meetings-heading"
            className="flex items-center gap-2 text-lg font-semibold text-slate-900"
          >
            <Calendar className="h-5 w-5 text-slate-500" aria-hidden="true" />
            Upcoming Meetings
          </h3>

          {loadingMeetings ? (
            <Spinner />
          ) : upcomingMeetings.length === 0 ? (
            <p className="mt-4 text-sm text-slate-500">
              No upcoming meetings scheduled.
            </p>
          ) : (
            <ul className="mt-4 divide-y divide-gray-100">
              {upcomingMeetings.map((meeting) => (
                <li key={meeting.id} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-slate-900">
                        {meeting.board_name}
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-500">
                        <span className="flex items-center gap-1">
                          <Calendar
                            className="h-3.5 w-3.5"
                            aria-hidden="true"
                          />
                          {formatDate(meeting.scheduled_date)}
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock
                            className="h-3.5 w-3.5"
                            aria-hidden="true"
                          />
                          {meeting.scheduled_time}
                        </span>
                        <span className="flex items-center gap-1">
                          <MapPin
                            className="h-3.5 w-3.5"
                            aria-hidden="true"
                          />
                          {meeting.location}
                        </span>
                      </div>
                    </div>
                    {meeting.has_published_agenda && (
                      <a
                        href={`/meetings/${meeting.id}/agenda`}
                        className="shrink-0 text-sm font-medium text-blue-700 underline hover:text-blue-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                      >
                        View Agenda
                      </a>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-4 border-t border-gray-100 pt-4">
            <a
              href="/meetings"
              className="inline-flex items-center gap-1 text-sm font-medium text-blue-700 underline hover:text-blue-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
            >
              View all meetings
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </a>
          </div>
        </section>

        {/* Recent Minutes */}
        <section
          className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm"
          aria-labelledby="recent-minutes-heading"
        >
          <h3
            id="recent-minutes-heading"
            className="flex items-center gap-2 text-lg font-semibold text-slate-900"
          >
            <FileText className="h-5 w-5 text-slate-500" aria-hidden="true" />
            Recent Minutes
          </h3>

          {loadingMeetings ? (
            <Spinner />
          ) : recentMinutes.length === 0 ? (
            <p className="mt-4 text-sm text-slate-500">
              No published minutes available.
            </p>
          ) : (
            <ul className="mt-4 divide-y divide-gray-100">
              {recentMinutes.map((meeting) => (
                <li
                  key={meeting.id}
                  className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-slate-900">
                      {meeting.board_name}
                    </p>
                    <p className="mt-0.5 text-sm text-slate-500">
                      {formatDate(meeting.scheduled_date)}
                    </p>
                  </div>
                  <a
                    href={`/meetings/${meeting.id}/minutes`}
                    className="shrink-0 text-sm font-medium text-blue-700 underline hover:text-blue-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                  >
                    View Minutes
                  </a>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-4 border-t border-gray-100 pt-4">
            <a
              href="/meetings"
              className="inline-flex items-center gap-1 text-sm font-medium text-blue-700 underline hover:text-blue-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
            >
              View all meetings
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </a>
          </div>
        </section>
      </div>

      {/* Boards */}
      <section
        className="mt-6 rounded-lg border border-gray-200 bg-white p-6 shadow-sm"
        aria-labelledby="boards-heading"
      >
        <h3
          id="boards-heading"
          className="flex items-center gap-2 text-lg font-semibold text-slate-900"
        >
          <Building2 className="h-5 w-5 text-slate-500" aria-hidden="true" />
          Boards &amp; Committees
        </h3>

        {loadingBoards ? (
          <Spinner />
        ) : boards.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500">
            No boards are currently listed.
          </p>
        ) : (
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {boards.map((board) => (
              <a
                key={board.id}
                href={`/boards/${board.id}`}
                className="group rounded-lg border border-gray-200 p-4 transition-colors hover:border-blue-300 hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
              >
                <p className="font-medium text-slate-900 group-hover:text-blue-900">
                  {board.name}
                </p>
                <p className="mt-1 text-sm text-slate-500">
                  {board.member_count}{" "}
                  {board.member_count === 1 ? "member" : "members"}
                </p>
              </a>
            ))}
          </div>
        )}

        <div className="mt-4 border-t border-gray-100 pt-4">
          <a
            href="/boards"
            className="inline-flex items-center gap-1 text-sm font-medium text-blue-700 underline hover:text-blue-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          >
            View all boards
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </a>
        </div>
      </section>
    </div>
  );
}
