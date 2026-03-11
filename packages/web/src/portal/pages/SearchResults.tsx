import { useEffect, useState, useCallback, useRef, FormEvent } from "react";
import { Search, FileText, ChevronLeft, ChevronRight } from "lucide-react";
import { usePortal } from "../PortalProvider";
import { searchPortal, fetchBoards } from "@/lib/portal-api";
import { usePortalMeta } from "@/lib/portal/seo";
import type {
  PortalSearchResponse,
  PortalSearchResult,
  PortalBoardSummary,
} from "@town-meeting/shared";

function getParams(): URLSearchParams {
  return new URLSearchParams(window.location.search);
}

function formatDate(date: string): string {
  return new Date(date + "T00:00:00").toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function SkeletonCard() {
  return (
    <div className="border-b border-gray-200 py-4 animate-pulse">
      <div className="flex items-center gap-2 mb-2">
        <div className="h-5 w-16 rounded-full bg-gray-200" />
        <div className="h-4 w-32 rounded bg-gray-200" />
        <div className="h-4 w-28 rounded bg-gray-200" />
      </div>
      <div className="h-5 w-3/4 rounded bg-gray-200 mb-2" />
      <div className="space-y-1.5">
        <div className="h-3.5 w-full rounded bg-gray-100" />
        <div className="h-3.5 w-5/6 rounded bg-gray-100" />
      </div>
      <div className="h-4 w-24 rounded bg-gray-200 mt-2" />
    </div>
  );
}

function ResultCard({ result }: { result: PortalSearchResult }) {
  const isMinutes = result.type === "minutes";
  const badgeClass = isMinutes
    ? "bg-blue-100 text-blue-800"
    : "bg-green-100 text-green-800";
  const label = isMinutes ? "Minutes" : "Agenda";
  const linkHref = isMinutes
    ? `/meetings/${result.meeting_id}/minutes`
    : `/meetings/${result.meeting_id}/agenda`;

  return (
    <article className="border-b border-gray-200 py-4">
      <div className="flex flex-wrap items-center gap-2 mb-1">
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${badgeClass}`}
        >
          <FileText className="h-3 w-3" aria-hidden="true" />
          {label}
        </span>
        <span className="text-sm text-gray-500">{result.board_name}</span>
        <span className="text-sm text-gray-400" aria-hidden="true">
          &middot;
        </span>
        <span className="text-sm text-gray-500">
          {formatDate(result.meeting_date)}
        </span>
      </div>

      <h3 className="text-base font-semibold text-slate-900 mb-1">
        {result.title}
      </h3>

      {result.snippet && (
        <p
          className="search-snippet text-sm text-gray-600 mb-1.5"
          dangerouslySetInnerHTML={{ __html: result.snippet }}
        />
      )}

      <a
        href={linkHref}
        className="inline-flex items-center gap-1 text-sm font-medium text-blue-700 hover:text-blue-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
      >
        View {label}
        <span aria-hidden="true">&rarr;</span>
      </a>
    </article>
  );
}

type ContentType = "all" | "agenda" | "minutes";

export default function SearchResults() {
  const { townId, townName } = usePortal();

  const [results, setResults] = useState<PortalSearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [boards, setBoards] = useState<PortalBoardSummary[]>([]);

  // Read URL params
  const [query, setQuery] = useState(() => getParams().get("q") || "");
  const [contentType, setContentType] = useState<ContentType>(
    () => (getParams().get("type") as ContentType) || "all",
  );
  const [boardFilter, setBoardFilter] = useState(
    () => getParams().get("board") || "",
  );
  const [fromDate, setFromDate] = useState(
    () => getParams().get("from") || "",
  );
  const [toDate, setToDate] = useState(() => getParams().get("to") || "");
  const [page, setPage] = useState(
    () => Number(getParams().get("page")) || 1,
  );

  // Track the search input separately so typing doesn't trigger searches
  const [inputValue, setInputValue] = useState(query);
  const isInitialMount = useRef(true);

  // SEO
  usePortalMeta(
    query
      ? {
          title: `Search: ${query} - ${townName}`,
          description: `Search results for "${query}" in ${townName} meeting records`,
          siteName: townName,
        }
      : null,
  );

  // Load boards for filter dropdown
  useEffect(() => {
    fetchBoards(townId)
      .then(setBoards)
      .catch(() => {
        /* boards filter is non-critical */
      });
  }, [townId]);

  // Sync URL params and perform search
  const performSearch = useCallback(
    async (
      q: string,
      type: ContentType,
      board: string,
      from: string,
      to: string,
      pg: number,
    ) => {
      if (!q.trim()) {
        setResults(null);
        return;
      }

      try {
        setLoading(true);
        setError(null);
        const res = await searchPortal(townId, {
          q: q.trim(),
          type: type !== "all" ? type : undefined,
          board: board || undefined,
          from: from || undefined,
          to: to || undefined,
          page: pg,
        });
        setResults(res);
      } catch {
        setError("Unable to load search results. Please try again later.");
      } finally {
        setLoading(false);
      }
    },
    [townId],
  );

  // Update URL without navigation
  function pushParams(params: {
    q: string;
    type: ContentType;
    board: string;
    from: string;
    to: string;
    page: number;
  }) {
    const qs = new URLSearchParams();
    if (params.q) qs.set("q", params.q);
    if (params.type !== "all") qs.set("type", params.type);
    if (params.board) qs.set("board", params.board);
    if (params.from) qs.set("from", params.from);
    if (params.to) qs.set("to", params.to);
    if (params.page > 1) qs.set("page", String(params.page));
    const queryString = qs.toString();
    window.history.pushState(
      {},
      "",
      `${window.location.pathname}${queryString ? `?${queryString}` : ""}`,
    );
  }

  // Trigger search on mount if q param exists
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      if (query) {
        performSearch(query, contentType, boardFilter, fromDate, toDate, page);
      }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Handle popstate (browser back/forward)
  useEffect(() => {
    function handlePopState() {
      const params = getParams();
      const q = params.get("q") || "";
      const type = (params.get("type") as ContentType) || "all";
      const board = params.get("board") || "";
      const from = params.get("from") || "";
      const to = params.get("to") || "";
      const pg = Number(params.get("page")) || 1;

      setQuery(q);
      setInputValue(q);
      setContentType(type);
      setBoardFilter(board);
      setFromDate(from);
      setToDate(to);
      setPage(pg);
      performSearch(q, type, board, from, to, pg);
    }

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [performSearch]);

  // Search form submit
  function handleSearchSubmit(e: FormEvent) {
    e.preventDefault();
    const newQuery = inputValue.trim();
    setQuery(newQuery);
    setPage(1);
    pushParams({
      q: newQuery,
      type: contentType,
      board: boardFilter,
      from: fromDate,
      to: toDate,
      page: 1,
    });
    performSearch(newQuery, contentType, boardFilter, fromDate, toDate, 1);
  }

  // Filter change helpers
  function handleFilterChange(updates: {
    type?: ContentType;
    board?: string;
    from?: string;
    to?: string;
  }) {
    const newType = updates.type ?? contentType;
    const newBoard = updates.board ?? boardFilter;
    const newFrom = updates.from ?? fromDate;
    const newTo = updates.to ?? toDate;

    if (updates.type !== undefined) setContentType(newType);
    if (updates.board !== undefined) setBoardFilter(newBoard);
    if (updates.from !== undefined) setFromDate(newFrom);
    if (updates.to !== undefined) setToDate(newTo);
    setPage(1);

    pushParams({
      q: query,
      type: newType,
      board: newBoard,
      from: newFrom,
      to: newTo,
      page: 1,
    });

    if (query.trim()) {
      performSearch(query, newType, newBoard, newFrom, newTo, 1);
    }
  }

  function handlePageChange(newPage: number) {
    setPage(newPage);
    pushParams({
      q: query,
      type: contentType,
      board: boardFilter,
      from: fromDate,
      to: toDate,
      page: newPage,
    });
    performSearch(query, contentType, boardFilter, fromDate, toDate, newPage);
    // Scroll to top of results
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const typeButtons: { value: ContentType; label: string }[] = [
    { value: "all", label: "All" },
    { value: "agenda", label: "Agendas" },
    { value: "minutes", label: "Minutes" },
  ];

  return (
    <div>
      <h2 className="sr-only">Search</h2>

      {/* Search input */}
      <form onSubmit={handleSearchSubmit} role="search" className="mb-6">
        <label htmlFor="search-input" className="sr-only">
          Search agendas and minutes
        </label>
        <div className="relative">
          <input
            id="search-input"
            type="search"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="Search agendas and minutes..."
            className="w-full rounded-lg border-2 border-slate-300 px-4 py-3 pl-11 text-lg text-slate-900 placeholder:text-slate-400 focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-500 focus:ring-offset-1"
          />
          <Search
            className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400"
            aria-hidden="true"
          />
          <button
            type="submit"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md bg-slate-700 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-500 focus:ring-offset-2"
          >
            Search
          </button>
        </div>
      </form>

      {/* Filter bar */}
      <div className="mb-6 flex flex-wrap items-center gap-4">
        {/* Content type pills */}
        <div className="flex items-center gap-1.5" role="group" aria-label="Content type filter">
          {typeButtons.map((btn) => (
            <button
              key={btn.value}
              type="button"
              onClick={() => handleFilterChange({ type: btn.value })}
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-slate-500 focus:ring-offset-2 ${
                contentType === btn.value
                  ? "bg-slate-700 text-white"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
              aria-pressed={contentType === btn.value}
            >
              {btn.label}
            </button>
          ))}
        </div>

        {/* Board filter */}
        <div className="flex items-center gap-2">
          <label htmlFor="board-filter" className="text-sm font-medium text-slate-700">
            Board:
          </label>
          <select
            id="board-filter"
            value={boardFilter}
            onChange={(e) => handleFilterChange({ board: e.target.value })}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-500"
          >
            <option value="">All Boards</option>
            {boards.map((board) => (
              <option key={board.id} value={board.id}>
                {board.name}
              </option>
            ))}
          </select>
        </div>

        {/* Date range */}
        <div className="flex items-center gap-2">
          <label htmlFor="date-from" className="text-sm font-medium text-slate-700">
            From:
          </label>
          <input
            id="date-from"
            type="date"
            value={fromDate}
            onChange={(e) => handleFilterChange({ from: e.target.value })}
            className="rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-500"
          />
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="date-to" className="text-sm font-medium text-slate-700">
            To:
          </label>
          <input
            id="date-to"
            type="date"
            value={toDate}
            onChange={(e) => handleFilterChange({ to: e.target.value })}
            className="rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-500"
          />
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-center">
          <p className="text-sm text-red-800">{error}</p>
        </div>
      )}

      {/* No query state */}
      {!query.trim() && !loading && (
        <div className="rounded-lg border border-gray-200 bg-white p-8 text-center shadow-sm">
          <Search className="mx-auto mb-3 h-10 w-10 text-slate-300" aria-hidden="true" />
          <p className="text-slate-500">
            Enter a search term to find agendas and minutes.
          </p>
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div>
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      )}

      {/* Results */}
      {!loading && results && query.trim() && (
        <>
          {results.results.length === 0 ? (
            <div className="rounded-lg border border-gray-200 bg-white p-8 text-center shadow-sm">
              <p className="text-slate-500">
                No results found for &ldquo;{query}&rdquo;. Try different search
                terms or adjust your filters.
              </p>
            </div>
          ) : (
            <>
              <p className="mb-4 text-sm text-slate-500">
                {results.total} result{results.total !== 1 ? "s" : ""} found
              </p>

              <div>
                {results.results.map((result, idx) => (
                  <ResultCard key={`${result.meeting_id}-${result.type}-${idx}`} result={result} />
                ))}
              </div>

              {/* Pagination */}
              {results.pages > 1 && (
                <nav
                  className="mt-6 flex items-center justify-center gap-4"
                  aria-label="Search results pagination"
                >
                  <button
                    type="button"
                    onClick={() => handlePageChange(page - 1)}
                    disabled={page <= 1}
                    className="inline-flex items-center gap-1 rounded border border-gray-300 px-3 py-1 text-sm font-medium text-slate-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-slate-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                    Previous
                  </button>

                  <span className="text-sm text-slate-600">
                    Page {results.page} of {results.pages}
                  </span>

                  <button
                    type="button"
                    onClick={() => handlePageChange(page + 1)}
                    disabled={page >= results.pages}
                    className="inline-flex items-center gap-1 rounded border border-gray-300 px-3 py-1 text-sm font-medium text-slate-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-slate-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Next
                    <ChevronRight className="h-4 w-4" aria-hidden="true" />
                  </button>
                </nav>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
