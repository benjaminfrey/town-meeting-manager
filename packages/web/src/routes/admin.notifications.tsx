/**
 * Admin Notifications Dashboard — /admin/notifications
 *
 * Shows notification health, recent events, delivery detail, and bounce list.
 * Requires admin or sys_admin role.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Mail, CheckCircle, AlertTriangle, XCircle, ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RouteErrorBoundary } from "@/components/RouteErrorBoundary";
import { useCurrentUser } from "@/hooks/useCurrentUser";

// ─── API base URL ──────────────────────────────────────────────────────────

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

// ─── Types ─────────────────────────────────────────────────────────────────

interface NotificationSummary {
  total: number;
  sent: number;
  delivered: number;
  bounced: number;
  complained: number;
  deliveryRate: number;
  bounceRate: number;
  complaintRate: number;
}

interface NotificationEvent {
  id: string;
  event_type: string;
  payload: Record<string, unknown>;
  status: string;
  created_at: string;
  processed_at: string | null;
  delivery: {
    total: number;
    sent: number;
    delivered: number;
    bounced: number;
    failed: number;
    pending: number;
  };
}

interface DeliveryDetail {
  id: string;
  status: string;
  postmark_message_id: string | null;
  sent_at: string | null;
  delivered_at: string | null;
  opened_at: string | null;
  error_message: string | null;
  retry_count: number;
  created_at: string;
  user_account: {
    id: string;
    email: string;
    display_name: string | null;
  } | null;
}

interface BounceEntry {
  id: string;
  email: string;
  display_name: string | null;
  email_bounced: boolean;
  email_bounced_at: string | null;
  email_complained: boolean;
  email_complained_at: string | null;
}

// ─── Fetch helpers ─────────────────────────────────────────────────────────

async function fetchSummary(): Promise<NotificationSummary> {
  const res = await fetch(`${API_URL}/api/admin/notifications/summary`);
  if (!res.ok) throw new Error("Failed to fetch summary");
  return res.json() as Promise<NotificationSummary>;
}

async function fetchEvents(): Promise<NotificationEvent[]> {
  const res = await fetch(`${API_URL}/api/admin/notifications/events`);
  if (!res.ok) throw new Error("Failed to fetch events");
  return res.json() as Promise<NotificationEvent[]>;
}

async function fetchDeliveries(eventId: string): Promise<DeliveryDetail[]> {
  const res = await fetch(`${API_URL}/api/admin/notifications/events/${eventId}/deliveries`);
  if (!res.ok) throw new Error("Failed to fetch deliveries");
  return res.json() as Promise<DeliveryDetail[]>;
}

async function fetchBounces(): Promise<BounceEntry[]> {
  const res = await fetch(`${API_URL}/api/admin/notifications/bounces`);
  if (!res.ok) throw new Error("Failed to fetch bounces");
  return res.json() as Promise<BounceEntry[]>;
}

async function clearBounce(userId: string): Promise<void> {
  const res = await fetch(`${API_URL}/api/admin/notifications/bounces/${userId}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Failed to clear bounce");
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function formatEventType(type: string): string {
  return type
    .split("_")
    .map((w) => (w[0] ?? "").toUpperCase() + w.slice(1))
    .join(" ");
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    delivered: "bg-green-100 text-green-800",
    sent: "bg-blue-100 text-blue-800",
    pending: "bg-gray-100 text-gray-700",
    bounced: "bg-red-100 text-red-800",
    failed: "bg-red-100 text-red-800",
    complained: "bg-orange-100 text-orange-800",
    completed: "bg-green-100 text-green-800",
    processing: "bg-blue-100 text-blue-800",
  };
  const cls = map[status] ?? "bg-gray-100 text-gray-700";
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${cls}`}>
      {status}
    </span>
  );
}

// ─── Sub-views ─────────────────────────────────────────────────────────────

function DeliveryDetailView({
  event,
  onBack,
}: {
  event: NotificationEvent;
  onBack: () => void;
}) {
  const { data: deliveries, isLoading } = useQuery({
    queryKey: ["notification-deliveries", event.id],
    queryFn: () => fetchDeliveries(event.id),
  });

  return (
    <div>
      <button
        onClick={onBack}
        className="mb-4 flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        Back to events
      </button>

      <div className="mb-4">
        <h2 className="text-lg font-semibold">{formatEventType(event.event_type)}</h2>
        <p className="text-sm text-muted-foreground">{formatDate(event.created_at)}</p>
      </div>

      <div className="mb-4 flex gap-4 text-sm">
        <span className="text-green-700">✓ {event.delivery.delivered} delivered</span>
        <span className="text-blue-700">↑ {event.delivery.sent} sent</span>
        <span className="text-red-700">✗ {event.delivery.bounced} bounced</span>
        <span className="text-red-700">! {event.delivery.failed} failed</span>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="overflow-x-auto rounded border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                <th className="px-3 py-2 font-medium">Recipient</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Sent</th>
                <th className="px-3 py-2 font-medium">Delivered</th>
                <th className="px-3 py-2 font-medium">Opened</th>
                <th className="px-3 py-2 font-medium">Error</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {(deliveries ?? []).map((d) => (
                <tr key={d.id} className="hover:bg-muted/20">
                  <td className="px-3 py-2">
                    <div className="font-medium">{d.user_account?.display_name ?? "—"}</div>
                    <div className="text-xs text-muted-foreground">{d.user_account?.email}</div>
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge status={d.status} />
                    {d.retry_count > 0 && (
                      <span className="ml-1 text-xs text-muted-foreground">
                        ({d.retry_count} retr{d.retry_count === 1 ? "y" : "ies"})
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{formatDate(d.sent_at)}</td>
                  <td className="px-3 py-2 text-muted-foreground">{formatDate(d.delivered_at)}</td>
                  <td className="px-3 py-2 text-muted-foreground">{formatDate(d.opened_at)}</td>
                  <td className="px-3 py-2 max-w-[200px]">
                    {d.error_message ? (
                      <span className="text-xs text-red-700 truncate block" title={d.error_message}>
                        {d.error_message}
                      </span>
                    ) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Main Dashboard ────────────────────────────────────────────────────────

export async function clientLoader() {
  return {};
}

export default function AdminNotificationsPage() {
  const currentUser = useCurrentUser();
  const qc = useQueryClient();
  const [selectedEvent, setSelectedEvent] = useState<NotificationEvent | null>(null);
  const [activeTab, setActiveTab] = useState<"events" | "bounces">("events");

  const { data: summary } = useQuery({
    queryKey: ["notification-summary"],
    queryFn: fetchSummary,
    staleTime: 30_000,
  });

  const { data: events, isLoading: eventsLoading } = useQuery({
    queryKey: ["notification-events"],
    queryFn: fetchEvents,
    staleTime: 30_000,
  });

  const { data: bounces, isLoading: bouncesLoading } = useQuery({
    queryKey: ["notification-bounces"],
    queryFn: fetchBounces,
    enabled: activeTab === "bounces",
    staleTime: 30_000,
  });

  const clearBounceMutation = useMutation({
    mutationFn: clearBounce,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["notification-bounces"] });
    },
  });

  // Guard: admin only
  if (currentUser && !["admin", "sys_admin"].includes(currentUser.role ?? "")) {
    return (
      <div className="p-6">
        <p className="text-sm text-muted-foreground">
          You do not have permission to view this page.
        </p>
      </div>
    );
  }

  if (selectedEvent) {
    return (
      <div className="p-6">
        <DeliveryDetailView
          event={selectedEvent}
          onBack={() => setSelectedEvent(null)}
        />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Notifications</h1>
        <p className="mt-1 text-muted-foreground">
          Email delivery health for the last 30 days
        </p>
      </div>

      {/* Summary cards */}
      {summary && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <SummaryCard
            icon={<Mail className="h-5 w-5 text-blue-600" />}
            label="Emails sent"
            value={summary.sent.toLocaleString()}
            sub="last 30 days"
            color="blue"
          />
          <SummaryCard
            icon={<CheckCircle className="h-5 w-5 text-green-600" />}
            label="Delivery rate"
            value={`${summary.deliveryRate}%`}
            sub={`${summary.delivered.toLocaleString()} delivered`}
            color="green"
          />
          <SummaryCard
            icon={<AlertTriangle className="h-5 w-5 text-amber-600" />}
            label="Bounce rate"
            value={`${summary.bounceRate}%`}
            sub={`${summary.bounced.toLocaleString()} bounced`}
            color="amber"
          />
          <SummaryCard
            icon={<XCircle className="h-5 w-5 text-red-600" />}
            label="Complaint rate"
            value={`${summary.complaintRate}%`}
            sub={`${summary.complained.toLocaleString()} complained`}
            color="red"
          />
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b">
        {(["events", "bounces"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === tab
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab === "events" ? "Recent Events" : "Bounces & Complaints"}
          </button>
        ))}
      </div>

      {/* Events table */}
      {activeTab === "events" && (
        eventsLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <div className="overflow-x-auto rounded border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Date</th>
                  <th className="px-3 py-2 font-medium">Event</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium text-right">Recipients</th>
                  <th className="px-3 py-2 font-medium text-right">Delivered</th>
                  <th className="px-3 py-2 font-medium text-right">Bounced</th>
                  <th className="px-3 py-2 font-medium text-right">Failed</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {(events ?? []).map((evt) => (
                  <tr
                    key={evt.id}
                    className="cursor-pointer hover:bg-muted/30"
                    onClick={() => setSelectedEvent(evt)}
                  >
                    <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                      {formatDate(evt.created_at)}
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-medium">{formatEventType(evt.event_type)}</div>
                      {(evt.payload.board_name as string | undefined) && (
                        <div className="text-xs text-muted-foreground">
                          {evt.payload.board_name as string}
                          {(evt.payload.meeting_date as string | undefined) && (
                            <> &bull; {evt.payload.meeting_date as string}</>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge status={evt.status} />
                    </td>
                    <td className="px-3 py-2 text-right">{evt.delivery.total}</td>
                    <td className="px-3 py-2 text-right text-green-700">{evt.delivery.delivered}</td>
                    <td className="px-3 py-2 text-right text-amber-700">{evt.delivery.bounced}</td>
                    <td className="px-3 py-2 text-right text-red-700">{evt.delivery.failed}</td>
                  </tr>
                ))}
                {(events ?? []).length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-3 py-8 text-center text-sm text-muted-foreground">
                      No notification events yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )
      )}

      {/* Bounces & complaints */}
      {activeTab === "bounces" && (
        bouncesLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <div className="overflow-x-auto rounded border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Recipient</th>
                  <th className="px-3 py-2 font-medium">Issue</th>
                  <th className="px-3 py-2 font-medium">Date</th>
                  <th className="px-3 py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {(bounces ?? []).map((b) => (
                  <tr key={b.id}>
                    <td className="px-3 py-2">
                      <div className="font-medium">{b.display_name ?? "—"}</div>
                      <div className="text-xs text-muted-foreground">{b.email}</div>
                    </td>
                    <td className="px-3 py-2">
                      {b.email_bounced && (
                        <span className="mr-2 inline-block rounded bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">
                          Hard bounce
                        </span>
                      )}
                      {b.email_complained && (
                        <span className="inline-block rounded bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-800">
                          Spam complaint
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {formatDate(b.email_bounced_at ?? b.email_complained_at)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={clearBounceMutation.isPending}
                        onClick={() => clearBounceMutation.mutate(b.id)}
                      >
                        Clear flag
                      </Button>
                    </td>
                  </tr>
                ))}
                {(bounces ?? []).length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-3 py-8 text-center text-sm text-muted-foreground">
                      No bounces or complaints.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  );
}

function SummaryCard({
  icon,
  label,
  value,
  sub,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
  color: "blue" | "green" | "amber" | "red";
}) {
  const bg = {
    blue: "bg-blue-50",
    green: "bg-green-50",
    amber: "bg-amber-50",
    red: "bg-red-50",
  }[color];

  return (
    <div className={`rounded-lg border p-4 ${bg}`}>
      <div className="flex items-center gap-2 mb-1">
        {icon}
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          {label}
        </span>
      </div>
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>
    </div>
  );
}

export { RouteErrorBoundary as ErrorBoundary };
