import { useEffect, useMemo, useState } from "react";
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  Clock,
  MapPin,
  X,
} from "lucide-react";
import { usePortal } from "../PortalProvider";
import { fetchBoards, fetchCalendarEvents } from "@/lib/portal-api";
import type {
  PortalBoardSummary,
  PortalCalendarEvent,
} from "@town-meeting/shared";

const BOARD_COLORS = [
  "bg-blue-500",
  "bg-green-500",
  "bg-purple-500",
  "bg-orange-500",
  "bg-red-500",
  "bg-teal-500",
  "bg-indigo-500",
  "bg-pink-500",
];

function getBoardColor(index: number): string {
  return BOARD_COLORS[index % BOARD_COLORS.length];
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function formatMonthYear(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function toDateString(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function formatTime(time: string): string {
  return time;
}

function formatDateLong(date: string): string {
  return new Date(date + "T00:00:00").toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function getBoardAbbreviation(name: string): string {
  const words = name.split(/\s+/);
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase();
  return words
    .map((w) => w.charAt(0))
    .join("")
    .toUpperCase()
    .slice(0, 4);
}

function Spinner() {
  return (
    <div className="flex justify-center py-12">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-slate-600" />
    </div>
  );
}

export default function MeetingCalendar() {
  const { townId } = usePortal();

  const [currentMonth, setCurrentMonth] = useState<Date>(
    new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  );
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [selectedBoard, setSelectedBoard] = useState<string>("");
  const [meetings, setMeetings] = useState<PortalCalendarEvent[]>([]);
  const [boards, setBoards] = useState<PortalBoardSummary[]>([]);
  const [loadingMeetings, setLoadingMeetings] = useState(true);
  const [loadingBoards, setLoadingBoards] = useState(true);

  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();

  const prevMonth = () => setCurrentMonth(new Date(year, month - 1, 1));
  const nextMonth = () => setCurrentMonth(new Date(year, month + 1, 1));
  const goToday = () => {
    const now = new Date();
    setCurrentMonth(new Date(now.getFullYear(), now.getMonth(), 1));
    setSelectedDay(null);
  };

  // Load boards once
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const data = await fetchBoards(townId);
        if (!cancelled) setBoards(data);
      } catch {
        // Boards are non-critical for calendar, silently fail
      } finally {
        if (!cancelled) setLoadingBoards(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [townId]);

  // Load meetings when month changes
  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoadingMeetings(true);
      try {
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const startDate = toDateString(year, month, 1);
        const endDate = toDateString(year, month, daysInMonth);
        const data = await fetchCalendarEvents(townId, startDate, endDate);
        if (!cancelled) {
          setMeetings(data);
          setSelectedDay(null);
        }
      } catch {
        if (!cancelled) setMeetings([]);
      } finally {
        if (!cancelled) setLoadingMeetings(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [townId, year, month]);

  // Board color map
  const boardColorMap = useMemo(() => {
    const map = new Map<string, string>();
    boards.forEach((b, i) => map.set(b.id, getBoardColor(i)));
    return map;
  }, [boards]);

  // Filtered meetings
  const filteredMeetings = useMemo(() => {
    if (!selectedBoard) return meetings;
    return meetings.filter((m) => m.board_id === selectedBoard);
  }, [meetings, selectedBoard]);

  // Group meetings by day
  const meetingsByDay = useMemo(() => {
    const map = new Map<number, PortalCalendarEvent[]>();
    for (const m of filteredMeetings) {
      const day = parseInt(m.scheduled_date.split("-")[2], 10);
      if (!map.has(day)) map.set(day, []);
      map.get(day)!.push(m);
    }
    return map;
  }, [filteredMeetings]);

  // Calendar grid data
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDayOfWeek = new Date(year, month, 1).getDay();
  const totalCells = firstDayOfWeek + daysInMonth;
  const rows = Math.ceil(totalCells / 7);

  const today = new Date();
  const isCurrentMonth =
    today.getFullYear() === year && today.getMonth() === month;
  const todayDate = today.getDate();

  // Meetings for selected day
  const selectedDayMeetings = selectedDay
    ? meetingsByDay.get(selectedDay) || []
    : [];

  return (
    <div>
      <section className="mb-6">
        <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900 sm:text-3xl">
          <Calendar className="h-7 w-7 text-slate-500" aria-hidden="true" />
          Meeting Calendar
        </h1>
      </section>

      {/* Controls */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        {/* Month navigation */}
        <div className="flex items-center gap-2">
          <button
            onClick={prevMonth}
            aria-label="Previous month"
            className="rounded-lg border border-gray-200 bg-white p-2 text-slate-600 shadow-sm transition-colors hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <h2 className="min-w-[180px] text-center text-lg font-semibold text-slate-900">
            {formatMonthYear(currentMonth)}
          </h2>
          <button
            onClick={nextMonth}
            aria-label="Next month"
            className="rounded-lg border border-gray-200 bg-white p-2 text-slate-600 shadow-sm transition-colors hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
          <button
            onClick={goToday}
            className="ml-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 shadow-sm transition-colors hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          >
            Today
          </button>
        </div>

        {/* Board filter */}
        {!loadingBoards && boards.length > 0 && (
          <div>
            <label htmlFor="board-filter" className="sr-only">
              Filter by board
            </label>
            <select
              id="board-filter"
              value={selectedBoard}
              onChange={(e) => setSelectedBoard(e.target.value)}
              className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
            >
              <option value="">All Boards</option>
              {boards.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {loadingMeetings ? (
        <Spinner />
      ) : (
        <>
          {/* Desktop Calendar Grid */}
          <div className="hidden md:block">
            <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
              {/* Day headers */}
              <div className="grid grid-cols-7 border-b bg-slate-100">
                {DAY_NAMES.map((day) => (
                  <div
                    key={day}
                    className="px-2 py-2 text-center text-sm font-semibold text-gray-700"
                  >
                    {day}
                  </div>
                ))}
              </div>

              {/* Calendar cells */}
              {Array.from({ length: rows }, (_, row) => (
                <div key={row} className="grid grid-cols-7">
                  {Array.from({ length: 7 }, (_, col) => {
                    const cellIndex = row * 7 + col;
                    const day = cellIndex - firstDayOfWeek + 1;
                    const isValidDay = day >= 1 && day <= daysInMonth;
                    const isToday = isCurrentMonth && day === todayDate;
                    const dayMeetings = isValidDay
                      ? meetingsByDay.get(day) || []
                      : [];
                    const isSelected = selectedDay === day;

                    return (
                      <div
                        key={col}
                        className={`min-h-[90px] border-t border-r last:border-r-0 p-1.5 ${
                          isValidDay ? "cursor-pointer" : ""
                        } ${!isValidDay ? "bg-gray-50" : ""} ${
                          isToday ? "bg-blue-50 ring-2 ring-inset ring-blue-500" : ""
                        } ${
                          isSelected && !isToday
                            ? "bg-slate-50 ring-2 ring-inset ring-slate-400"
                            : ""
                        }`}
                        onClick={() => {
                          if (isValidDay) {
                            setSelectedDay(
                              selectedDay === day ? null : day,
                            );
                          }
                        }}
                        role={isValidDay ? "button" : undefined}
                        tabIndex={isValidDay ? 0 : undefined}
                        aria-label={
                          isValidDay
                            ? `${formatDateLong(toDateString(year, month, day))}${dayMeetings.length > 0 ? `, ${dayMeetings.length} meeting${dayMeetings.length > 1 ? "s" : ""}` : ""}`
                            : undefined
                        }
                        onKeyDown={(e) => {
                          if (isValidDay && (e.key === "Enter" || e.key === " ")) {
                            e.preventDefault();
                            setSelectedDay(selectedDay === day ? null : day);
                          }
                        }}
                      >
                        {isValidDay && (
                          <>
                            <span
                              className={`inline-block text-sm ${
                                isToday
                                  ? "font-bold text-blue-700"
                                  : "text-slate-700"
                              }`}
                            >
                              {day}
                            </span>
                            <div className="mt-0.5 space-y-0.5">
                              {dayMeetings.slice(0, 3).map((m) => (
                                <div
                                  key={m.id}
                                  className="flex items-center gap-1"
                                >
                                  <span
                                    className={`inline-block h-2 w-2 shrink-0 rounded-full ${boardColorMap.get(m.board_id) || "bg-gray-400"}`}
                                    aria-hidden="true"
                                  />
                                  <span className="truncate text-xs text-slate-600">
                                    {getBoardAbbreviation(m.board_name)}
                                  </span>
                                </div>
                              ))}
                              {dayMeetings.length > 3 && (
                                <span className="text-xs text-slate-400">
                                  +{dayMeetings.length - 3} more
                                </span>
                              )}
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>

            {/* Day Detail Panel */}
            {selectedDay !== null && selectedDayMeetings.length > 0 && (
              <div className="mt-4 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-slate-900">
                    {formatDateLong(toDateString(year, month, selectedDay))}
                  </h3>
                  <button
                    onClick={() => setSelectedDay(null)}
                    aria-label="Close day detail"
                    className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>
                <ul className="mt-3 divide-y divide-gray-100">
                  {selectedDayMeetings.map((m) => (
                    <li key={m.id} className="py-3 first:pt-0 last:pb-0">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <span
                              className={`inline-block h-2.5 w-2.5 rounded-full ${boardColorMap.get(m.board_id) || "bg-gray-400"}`}
                              aria-hidden="true"
                            />
                            <span className="font-medium text-slate-900">
                              {m.board_name}
                            </span>
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-500">
                            <span className="flex items-center gap-1">
                              <Clock
                                className="h-3.5 w-3.5"
                                aria-hidden="true"
                              />
                              {formatTime(m.scheduled_time)}
                            </span>
                            <span className="flex items-center gap-1">
                              <MapPin
                                className="h-3.5 w-3.5"
                                aria-hidden="true"
                              />
                              {m.location}
                            </span>
                          </div>
                        </div>
                        <a
                          href={`/meetings/${m.id}`}
                          className="shrink-0 text-sm font-medium text-blue-700 underline hover:text-blue-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                        >
                          View Details
                          <ChevronRight
                            className="ml-0.5 inline h-3.5 w-3.5"
                            aria-hidden="true"
                          />
                        </a>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {selectedDay !== null && selectedDayMeetings.length === 0 && (
              <div className="mt-4 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-slate-900">
                    {formatDateLong(toDateString(year, month, selectedDay))}
                  </h3>
                  <button
                    onClick={() => setSelectedDay(null)}
                    aria-label="Close day detail"
                    className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>
                <p className="mt-2 text-sm text-slate-500">
                  No meetings scheduled for this day.
                </p>
              </div>
            )}
          </div>

          {/* Mobile List View */}
          <div className="md:hidden">
            {filteredMeetings.length === 0 ? (
              <p className="text-sm text-slate-500">
                No meetings scheduled for {formatMonthYear(currentMonth)}.
              </p>
            ) : (
              <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
                <ul className="divide-y divide-gray-100">
                  {filteredMeetings
                    .sort((a, b) =>
                      a.scheduled_date.localeCompare(b.scheduled_date) ||
                      a.scheduled_time.localeCompare(b.scheduled_time),
                    )
                    .map((m) => (
                      <li key={m.id}>
                        <a
                          href={`/meetings/${m.id}`}
                          className="block px-4 py-3 transition-colors hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span
                                  className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${boardColorMap.get(m.board_id) || "bg-gray-400"}`}
                                  aria-hidden="true"
                                />
                                <span className="font-medium text-slate-900">
                                  {m.board_name}
                                </span>
                              </div>
                              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-500">
                                <span className="flex items-center gap-1">
                                  <Calendar
                                    className="h-3.5 w-3.5"
                                    aria-hidden="true"
                                  />
                                  {new Date(
                                    m.scheduled_date + "T00:00:00",
                                  ).toLocaleDateString("en-US", {
                                    month: "short",
                                    day: "numeric",
                                  })}
                                </span>
                                <span className="flex items-center gap-1">
                                  <Clock
                                    className="h-3.5 w-3.5"
                                    aria-hidden="true"
                                  />
                                  {formatTime(m.scheduled_time)}
                                </span>
                                <span className="flex items-center gap-1">
                                  <MapPin
                                    className="h-3.5 w-3.5"
                                    aria-hidden="true"
                                  />
                                  {m.location}
                                </span>
                              </div>
                            </div>
                            <ChevronRight
                              className="mt-1 h-4 w-4 shrink-0 text-slate-400"
                              aria-hidden="true"
                            />
                          </div>
                        </a>
                      </li>
                    ))}
                </ul>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
