import { useEffect, useState } from "react";
import { useParams, Link } from "react-router";
import {
  Download,
  Printer,
  ChevronRight,
  AlertCircle,
} from "lucide-react";
import type { PortalMinutes } from "@town-meeting/shared";
import { usePortal } from "../PortalProvider";
import {
  fetchMinutes,
  getMinutesPdfUrl,
  PortalApiError,
} from "@/lib/portal-api";

function formatDate(date: string): string {
  return new Date(date + "T00:00:00").toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export default function MinutesView() {
  const { meetingId } = useParams<{ meetingId: string }>();
  const { townId } = usePortal();
  const [minutes, setMinutes] = useState<PortalMinutes | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<"not_found" | "error" | null>(null);

  useEffect(() => {
    if (!meetingId) return;
    let cancelled = false;

    async function load() {
      try {
        setIsLoading(true);
        setError(null);
        const data = await fetchMinutes(townId, meetingId!);
        if (!cancelled) setMinutes(data);
      } catch (err) {
        if (!cancelled) {
          if (err instanceof PortalApiError && err.status === 404) {
            setError("not_found");
          } else {
            setError("error");
          }
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [townId, meetingId]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-300 border-t-slate-700" />
      </div>
    );
  }

  if (error === "not_found") {
    return (
      <div className="mx-auto max-w-2xl px-4 py-12">
        <div className="rounded-lg border border-gray-200 bg-white p-8 text-center shadow-sm">
          <AlertCircle
            className="mx-auto h-12 w-12 text-gray-400"
            aria-hidden="true"
          />
          <h1 className="mt-4 text-xl font-bold text-gray-900">
            Minutes Not Available
          </h1>
          <p className="mt-2 text-gray-600">
            The minutes for this meeting have not been published yet.
          </p>
          <Link
            to={`/meetings/${meetingId}`}
            className="mt-6 inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            Back to meeting details
          </Link>
        </div>
      </div>
    );
  }

  if (error === "error" || !minutes) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-12">
        <div className="rounded-lg border border-gray-200 bg-white p-8 text-center shadow-sm">
          <AlertCircle
            className="mx-auto h-12 w-12 text-red-400"
            aria-hidden="true"
          />
          <h1 className="mt-4 text-xl font-bold text-gray-900">
            Error Loading Minutes
          </h1>
          <p className="mt-2 text-gray-600">
            An unexpected error occurred while loading the minutes. Please try
            again later.
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      <style>{`
        .minutes-content h1 {
          font-size: 1.5rem;
          font-weight: 700;
          margin-bottom: 0.5rem;
          color: #111827;
        }
        .minutes-content h2 {
          font-size: 1.25rem;
          font-weight: 600;
          margin-top: 1.5rem;
          margin-bottom: 0.5rem;
          color: #111827;
        }
        .minutes-content h3 {
          font-size: 1.125rem;
          font-weight: 600;
          margin-top: 1.25rem;
          margin-bottom: 0.375rem;
          color: #1f2937;
        }
        .minutes-content p {
          margin-bottom: 0.75rem;
          line-height: 1.625;
          color: #374151;
        }
        .minutes-content table {
          width: 100%;
          border-collapse: collapse;
          margin: 1rem 0;
        }
        .minutes-content th,
        .minutes-content td {
          border: 1px solid #e2e8f0;
          padding: 0.5rem 0.75rem;
          text-align: left;
          font-size: 0.875rem;
        }
        .minutes-content th {
          background: #f1f5f9;
          font-weight: 600;
          color: #1e293b;
        }
        .minutes-content ul,
        .minutes-content ol {
          margin: 0.5rem 0;
          padding-left: 1.5rem;
        }
        .minutes-content li {
          margin-bottom: 0.25rem;
          line-height: 1.625;
          color: #374151;
        }
        .minutes-content strong {
          font-weight: 600;
          color: #111827;
        }
        .minutes-content em {
          font-style: italic;
        }
        .minutes-content blockquote {
          border-left: 3px solid #cbd5e1;
          padding-left: 1rem;
          margin: 0.75rem 0;
          color: #4b5563;
          font-style: italic;
        }

        @media print {
          .no-print { display: none !important; }
          .minutes-card {
            box-shadow: none !important;
            border: none !important;
            border-radius: 0 !important;
          }
          body { background: white !important; }
          .minutes-content h1,
          .minutes-content h2,
          .minutes-content h3 {
            page-break-after: avoid;
          }
          .minutes-content table {
            page-break-inside: avoid;
          }
        }
      `}</style>

      <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 lg:px-8">
        {/* Breadcrumb */}
        <nav
          className="no-print mb-6 text-sm text-gray-500"
          aria-label="Breadcrumb"
        >
          <ol className="flex items-center gap-1">
            <li>
              <Link to="/meetings" className="hover:text-gray-700">
                Meetings
              </Link>
            </li>
            <li>
              <ChevronRight className="h-3 w-3" aria-hidden="true" />
            </li>
            <li>
              <span>{minutes.board_name}</span>
            </li>
            <li>
              <ChevronRight className="h-3 w-3" aria-hidden="true" />
            </li>
            <li>
              <Link
                to={`/meetings/${meetingId}`}
                className="hover:text-gray-700"
              >
                {formatDate(minutes.meeting_date)}
              </Link>
            </li>
            <li>
              <ChevronRight className="h-3 w-3" aria-hidden="true" />
            </li>
            <li className="text-gray-900">Minutes</li>
          </ol>
        </nav>

        {/* Main card */}
        <div className="minutes-card rounded-lg border border-gray-200 bg-white shadow-sm">
          {/* Header */}
          <div className="border-b border-gray-200 px-6 py-6 sm:px-8">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-gray-900">
                  Minutes of the {minutes.board_name}
                </h1>
                <p className="mt-1 text-gray-600">
                  {formatDate(minutes.meeting_date)}
                </p>
                {minutes.approved_at && (
                  <p className="mt-1 text-sm text-gray-500">
                    Approved on {formatDate(minutes.approved_at)}
                  </p>
                )}
              </div>
              <div className="no-print flex shrink-0 gap-2">
                {minutes.has_pdf && (
                  <a
                    href={getMinutesPdfUrl(townId, meetingId!)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 rounded-md bg-slate-700 px-4 py-2 text-sm text-white hover:bg-slate-800"
                  >
                    <Download className="h-4 w-4" aria-hidden="true" />
                    Download PDF
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                >
                  <Printer className="h-4 w-4" aria-hidden="true" />
                  Print
                </button>
              </div>
            </div>
          </div>

          {/* Minutes body */}
          <div className="px-6 py-6 sm:px-8">
            <article
              className="minutes-content"
              dangerouslySetInnerHTML={{ __html: minutes.html_rendered }}
            />
          </div>
        </div>
      </div>
    </>
  );
}
