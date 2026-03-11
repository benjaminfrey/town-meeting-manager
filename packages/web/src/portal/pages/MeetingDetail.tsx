import { useEffect, useState } from "react";
import { useParams } from "react-router";
import {
  Calendar,
  Clock,
  MapPin,
  FileText,
  ExternalLink,
  ChevronRight,
} from "lucide-react";
import { usePortal } from "../PortalProvider";
import {
  fetchMeetingDetail,
  getAgendaPdfUrl,
  getMinutesPdfUrl,
} from "@/lib/portal-api";
import type { PortalMeetingDetail as PortalMeetingDetailType } from "@town-meeting/shared";

function formatDate(date: string): string {
  return new Date(date + "T00:00:00").toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

const MEETING_TYPE_LABELS: Record<string, string> = {
  regular: "Regular",
  special: "Special",
  public_hearing: "Public Hearing",
  emergency: "Emergency",
};

const MEETING_TYPE_COLORS: Record<string, string> = {
  regular: "bg-slate-100 text-slate-800",
  special: "bg-amber-100 text-amber-800",
  public_hearing: "bg-blue-100 text-blue-800",
  emergency: "bg-red-100 text-red-800",
};

const STATUS_LABELS: Record<string, string> = {
  scheduled: "Scheduled",
  in_progress: "In Progress",
  completed: "Completed",
  cancelled: "Cancelled",
};

const STATUS_COLORS: Record<string, string> = {
  scheduled: "bg-blue-100 text-blue-800",
  in_progress: "bg-green-100 text-green-800",
  completed: "bg-slate-100 text-slate-700",
  cancelled: "bg-red-100 text-red-800",
};

function Spinner() {
  return (
    <div className="flex justify-center py-16">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-slate-600" />
    </div>
  );
}

export default function MeetingDetail() {
  const { meetingId } = useParams<{ meetingId: string }>();
  const { townId } = usePortal();

  const [meeting, setMeeting] = useState<PortalMeetingDetailType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!meetingId) return;

    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        setError(null);
        const data = await fetchMeetingDetail(townId, meetingId!);
        if (!cancelled) {
          setMeeting(data);
        }
      } catch {
        if (!cancelled) {
          setError("Unable to load meeting details. Please try again later.");
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
  }, [townId, meetingId]);

  if (loading) return <Spinner />;

  if (error || !meeting) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-center">
        <p className="text-red-800">
          {error ?? "Meeting not found."}
        </p>
        <a
          href="/meetings"
          className="mt-4 inline-block text-sm font-medium text-blue-700 underline hover:text-blue-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        >
          Back to Meetings
        </a>
      </div>
    );
  }

  const typeLabel =
    MEETING_TYPE_LABELS[meeting.meeting_type] ?? meeting.meeting_type;
  const typeColor =
    MEETING_TYPE_COLORS[meeting.meeting_type] ?? "bg-slate-100 text-slate-800";
  const statusLabel = STATUS_LABELS[meeting.status] ?? meeting.status;
  const statusColor =
    STATUS_COLORS[meeting.status] ?? "bg-slate-100 text-slate-700";

  return (
    <div>
      {/* Breadcrumb */}
      <nav aria-label="Breadcrumb" className="mb-6">
        <ol className="flex flex-wrap items-center gap-1 text-sm text-slate-500">
          <li>
            <a
              href="/meetings"
              className="text-blue-700 underline hover:text-blue-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
            >
              Meetings
            </a>
          </li>
          <li aria-hidden="true">
            <ChevronRight className="h-3.5 w-3.5" />
          </li>
          <li>
            <a
              href={`/boards/${meeting.board_id}`}
              className="text-blue-700 underline hover:text-blue-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
            >
              {meeting.board_name}
            </a>
          </li>
          <li aria-hidden="true">
            <ChevronRight className="h-3.5 w-3.5" />
          </li>
          <li aria-current="page" className="text-slate-700">
            {formatDate(meeting.scheduled_date)}
          </li>
        </ol>
      </nav>

      {/* Header Card */}
      <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-3">
            <h2 className="text-xl font-bold text-slate-900 sm:text-2xl">
              {meeting.board_name}
            </h2>

            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${typeColor}`}
              >
                {typeLabel}
              </span>
              <span
                className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusColor}`}
              >
                {statusLabel}
              </span>
            </div>

            <dl className="space-y-2 text-sm text-slate-600">
              <div className="flex items-center gap-2">
                <dt className="sr-only">Date</dt>
                <Calendar className="h-4 w-4 text-slate-400" aria-hidden="true" />
                <dd>{formatDate(meeting.scheduled_date)}</dd>
              </div>
              <div className="flex items-center gap-2">
                <dt className="sr-only">Time</dt>
                <Clock className="h-4 w-4 text-slate-400" aria-hidden="true" />
                <dd>{meeting.scheduled_time}</dd>
              </div>
              <div className="flex items-center gap-2">
                <dt className="sr-only">Location</dt>
                <MapPin className="h-4 w-4 text-slate-400" aria-hidden="true" />
                <dd>{meeting.location}</dd>
              </div>
            </dl>
          </div>
        </div>
      </section>

      {/* Available Documents */}
      <section className="mt-6" aria-labelledby="documents-heading">
        <h3
          id="documents-heading"
          className="mb-4 text-lg font-semibold text-slate-900"
        >
          Available Documents
        </h3>

        <div className="grid gap-4 sm:grid-cols-2">
          {/* Agenda */}
          <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
            <div className="flex items-start gap-3">
              <div className="rounded-md bg-blue-50 p-2">
                <FileText
                  className="h-5 w-5 text-blue-600"
                  aria-hidden="true"
                />
              </div>
              <div className="min-w-0 flex-1">
                <h4 className="font-medium text-slate-900">
                  {meeting.has_published_agenda
                    ? "Published Agenda"
                    : "Meeting Agenda"}
                </h4>
                {meeting.has_published_agenda ? (
                  <div className="mt-2 flex flex-wrap gap-3">
                    <a
                      href={`/meetings/${meeting.id}/agenda`}
                      className="inline-flex items-center gap-1 text-sm font-medium text-blue-700 underline hover:text-blue-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                    >
                      View Agenda
                      <ChevronRight
                        className="h-3.5 w-3.5"
                        aria-hidden="true"
                      />
                    </a>
                    <a
                      href={getAgendaPdfUrl(townId, meeting.id)}
                      className="inline-flex items-center gap-1 text-sm font-medium text-blue-700 underline hover:text-blue-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Download PDF
                      <ExternalLink
                        className="h-3.5 w-3.5"
                        aria-hidden="true"
                      />
                    </a>
                  </div>
                ) : (
                  <p className="mt-1 text-sm text-slate-500">
                    Agenda not yet published.
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Minutes */}
          <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
            <div className="flex items-start gap-3">
              <div className="rounded-md bg-green-50 p-2">
                <FileText
                  className="h-5 w-5 text-green-600"
                  aria-hidden="true"
                />
              </div>
              <div className="min-w-0 flex-1">
                <h4 className="font-medium text-slate-900">
                  {meeting.has_published_minutes
                    ? "Approved Minutes"
                    : "Meeting Minutes"}
                </h4>
                {meeting.has_published_minutes ? (
                  <div className="mt-2 flex flex-wrap gap-3">
                    <a
                      href={`/meetings/${meeting.id}/minutes`}
                      className="inline-flex items-center gap-1 text-sm font-medium text-blue-700 underline hover:text-blue-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                    >
                      View Minutes
                      <ChevronRight
                        className="h-3.5 w-3.5"
                        aria-hidden="true"
                      />
                    </a>
                    <a
                      href={getMinutesPdfUrl(townId, meeting.id)}
                      className="inline-flex items-center gap-1 text-sm font-medium text-blue-700 underline hover:text-blue-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Download PDF
                      <ExternalLink
                        className="h-3.5 w-3.5"
                        aria-hidden="true"
                      />
                    </a>
                  </div>
                ) : (
                  <p className="mt-1 text-sm text-slate-500">
                    Minutes pending approval.
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
