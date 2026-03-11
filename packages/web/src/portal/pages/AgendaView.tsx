import { useEffect, useState } from "react";
import { useParams, Link } from "react-router";
import {
  FileText,
  Download,
  Printer,
  ChevronRight,
  AlertCircle,
} from "lucide-react";
import type { PortalAgenda, PortalAgendaItem } from "@town-meeting/shared";
import { usePortal } from "../PortalProvider";
import { fetchAgenda, getAgendaPdfUrl, PortalApiError } from "@/lib/portal-api";

function toRoman(num: number): string {
  const numerals = [
    [1000, "M"],
    [900, "CM"],
    [500, "D"],
    [400, "CD"],
    [100, "C"],
    [90, "XC"],
    [50, "L"],
    [40, "XL"],
    [10, "X"],
    [9, "IX"],
    [5, "V"],
    [4, "IV"],
    [1, "I"],
  ] as const;
  let result = "";
  let n = num;
  for (const [value, symbol] of numerals) {
    while (n >= value) {
      result += symbol;
      n -= value;
    }
  }
  return result;
}

function toLetter(num: number): string {
  return String.fromCharCode(64 + num); // 1=A, 2=B, etc.
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(date: string): string {
  return new Date(date + "T00:00:00").toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function formatTime(time: string): string {
  const [h, m] = time.split(":");
  const hour = parseInt(h, 10);
  const ampm = hour >= 12 ? "PM" : "AM";
  const hour12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return `${hour12}:${m} ${ampm}`;
}

function AgendaItemDetails({
  item,
  label,
}: {
  item: PortalAgendaItem;
  label: string;
}) {
  return (
    <div className="mb-4">
      <p className="font-semibold text-gray-900">
        {label}. {item.title}
      </p>

      {item.description && (
        <p className="mt-1 text-gray-700">{item.description}</p>
      )}

      {item.background && (
        <div className="mt-2 rounded-md bg-gray-50 px-4 py-3 text-sm text-gray-700">
          <span className="font-medium text-gray-600">Background:</span>{" "}
          {item.background}
        </div>
      )}

      {item.presenter && (
        <p className="mt-1 text-sm text-gray-600">
          <span className="font-medium">Presenter:</span> {item.presenter}
        </p>
      )}

      {item.staff_resource && (
        <p className="mt-1 text-sm text-gray-600">
          <span className="font-medium">Staff Resource:</span>{" "}
          {item.staff_resource}
        </p>
      )}

      {item.recommendation && (
        <p className="mt-1 text-sm text-gray-600">
          <span className="font-medium">Recommendation:</span>{" "}
          {item.recommendation}
        </p>
      )}

      {item.suggested_motion && (
        <p className="mt-2 text-sm italic text-gray-700">
          Suggested Motion: &ldquo;{item.suggested_motion}&rdquo;
        </p>
      )}

      {item.exhibits.length > 0 && (
        <div className="mt-3">
          <p className="text-sm font-medium text-gray-600">Exhibits:</p>
          <ul className="mt-1 space-y-1">
            {item.exhibits.map((exhibit) => (
              <li key={exhibit.id}>
                <a
                  href={exhibit.download_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 text-sm text-blue-700 hover:text-blue-900 hover:underline"
                >
                  <FileText className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>
                    {exhibit.title} ({exhibit.file_type.toUpperCase()},{" "}
                    {formatFileSize(exhibit.file_size)})
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Render children (nested items) */}
      {item.children.length > 0 && (
        <div className="ml-6 mt-3 space-y-3 border-l-2 border-gray-100 pl-4">
          {item.children.map((child, childIdx) => (
            <AgendaItemDetails
              key={child.id}
              item={child}
              label={toLetter(childIdx + 1)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function AgendaView() {
  const { meetingId } = useParams<{ meetingId: string }>();
  const { townId } = usePortal();
  const [agenda, setAgenda] = useState<PortalAgenda | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<"not_found" | "error" | null>(null);

  useEffect(() => {
    if (!meetingId) return;
    let cancelled = false;

    async function load() {
      try {
        setIsLoading(true);
        setError(null);
        const data = await fetchAgenda(townId, meetingId!);
        if (!cancelled) setAgenda(data);
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
            Agenda Not Available
          </h1>
          <p className="mt-2 text-gray-600">
            The agenda for this meeting has not been published yet.
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

  if (error === "error" || !agenda) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-12">
        <div className="rounded-lg border border-gray-200 bg-white p-8 text-center shadow-sm">
          <AlertCircle
            className="mx-auto h-12 w-12 text-red-400"
            aria-hidden="true"
          />
          <h1 className="mt-4 text-xl font-bold text-gray-900">
            Error Loading Agenda
          </h1>
          <p className="mt-2 text-gray-600">
            An unexpected error occurred while loading the agenda. Please try
            again later.
          </p>
        </div>
      </div>
    );
  }

  const { meeting, sections } = agenda;

  return (
    <>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          .agenda-card {
            box-shadow: none !important;
            border: none !important;
            border-radius: 0 !important;
          }
          body { background: white !important; }
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
              <span>{meeting.board_name}</span>
            </li>
            <li>
              <ChevronRight className="h-3 w-3" aria-hidden="true" />
            </li>
            <li>
              <Link
                to={`/meetings/${meeting.id}`}
                className="hover:text-gray-700"
              >
                {formatDate(meeting.scheduled_date)}
              </Link>
            </li>
            <li>
              <ChevronRight className="h-3 w-3" aria-hidden="true" />
            </li>
            <li className="text-gray-900">Agenda</li>
          </ol>
        </nav>

        {/* Main card */}
        <div className="agenda-card rounded-lg border border-gray-200 bg-white shadow-sm">
          {/* Header */}
          <div className="border-b border-gray-200 px-6 py-6 sm:px-8">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-gray-900">
                  Meeting Agenda
                </h1>
                <p className="mt-1 text-lg text-gray-700">
                  {meeting.board_name}
                </p>
                <p className="mt-1 text-gray-600">
                  {meeting.meeting_type} Meeting
                </p>
                <p className="mt-1 text-gray-600">
                  {formatDate(meeting.scheduled_date)} at{" "}
                  {formatTime(meeting.scheduled_time)}
                </p>
                <p className="text-gray-600">{meeting.location}</p>
              </div>
              <div className="no-print flex shrink-0 gap-2">
                <a
                  href={getAgendaPdfUrl(townId, meeting.id)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-md bg-slate-700 px-4 py-2 text-sm text-white hover:bg-slate-800"
                >
                  <Download className="h-4 w-4" aria-hidden="true" />
                  Download PDF
                </a>
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

          {/* Agenda body */}
          <div className="px-6 py-6 sm:px-8">
            {sections.length === 0 && (
              <p className="text-gray-500">No agenda sections available.</p>
            )}

            {sections.map((section, sectionIdx) => (
              <div key={section.id} className="mb-6">
                {/* Section heading */}
                <h2 className="mb-3 text-lg font-bold text-gray-900">
                  {toRoman(sectionIdx + 1)}. {section.title}
                </h2>

                {section.description && (
                  <p className="mb-3 text-gray-700">{section.description}</p>
                )}

                {section.suggested_motion && (
                  <p className="mb-3 text-sm italic text-gray-700">
                    Suggested Motion: &ldquo;{section.suggested_motion}&rdquo;
                  </p>
                )}

                {section.exhibits.length > 0 && (
                  <div className="mb-3">
                    <p className="text-sm font-medium text-gray-600">
                      Exhibits:
                    </p>
                    <ul className="mt-1 space-y-1">
                      {section.exhibits.map((exhibit) => (
                        <li key={exhibit.id}>
                          <a
                            href={exhibit.download_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-2 text-sm text-blue-700 hover:text-blue-900 hover:underline"
                          >
                            <FileText
                              className="h-4 w-4 shrink-0"
                              aria-hidden="true"
                            />
                            <span>
                              {exhibit.title} (
                              {exhibit.file_type.toUpperCase()},{" "}
                              {formatFileSize(exhibit.file_size)})
                            </span>
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Child items */}
                {section.children.length > 0 && (
                  <div className="ml-6 space-y-3">
                    {section.children.map((item, itemIdx) => (
                      <AgendaItemDetails
                        key={item.id}
                        item={item}
                        label={toLetter(itemIdx + 1)}
                      />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
