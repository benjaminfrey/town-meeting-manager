/**
 * Notification trigger helpers.
 *
 * Called from API routes on key lifecycle events to queue notification events
 * for the pipeline in `notification-service.ts`.
 *
 * ─── Task D1c: this file is the ONE place still on the service-role client ─
 *
 * `NotificationService` is now tenant-bound — it is constructed from a
 * `TenantJob`, which cannot exist without a town (see `jobs/tenant-job.ts`).
 * This module cannot supply one: its only caller is `routes/minutes.ts`, which
 * hands it `fastify.supabase`, and `routes/minutes.ts` belongs to a concurrent
 * task and is not this one's to edit. Changing the signature here would break
 * it; deriving a tenant database from a Supabase client is not possible; and
 * reaching for a module-level singleton would make the tenant ambient, which
 * is the exact property this task exists to remove.
 *
 * So the split is drawn where it can be drawn honestly:
 *
 *   ENQUEUE (here)  — one INSERT of a `pending` notification_event row. Still
 *                     through the service-role client, still with `town_id`
 *                     supplied by this file rather than by the database.
 *   PROCESS (there) — subscriber resolution, sending, delivery tracking, all
 *                     of it tenant-bound. `NotificationService.processPendingEvents()`
 *                     picks the row up on the next sweep (`server.ts`).
 *
 * Nothing is lost: the event is durable the moment it is inserted, and it used
 * to be processed by a `setImmediate` in the same process, so it was never
 * synchronous with the caller anyway. What is deferred is at most one sweep
 * interval.
 *
 * TO FINISH THIS: change the two calls in `routes/minutes.ts` (currently
 * `triggerMinutesReview(fastify.supabase, …)` and
 * `triggerMinutesApproved(fastify.supabase, …)`) to pass
 * `tenantJob(fastify.tenantDb, request.tenant.townId)`, then replace
 * `enqueueEvent` below with `new NotificationService(job).createNotificationEvent(...)`
 * and delete the `SupabaseClient` parameter from all five triggers. The reads
 * of `meeting`, `board` and `town` in this file become `job.run` queries at the
 * same time. That is a mechanical change once minutes.ts is free.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { NotificationEventType } from "@town-meeting/shared";

const APP_URL = process.env.APP_URL ?? "https://app.townmeetingmanager.com";

/**
 * Insert a `pending` notification_event row.
 *
 * The transitional half of `NotificationService.createNotificationEvent` — see
 * this file's header. It deliberately does NOT kick processing: whatever
 * processes this row has to have a tenant, and this function does not.
 */
async function enqueueEvent(
  supabase: SupabaseClient,
  eventType: NotificationEventType,
  townId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabase
    .from("notification_event")
    .insert({ town_id: townId, event_type: eventType, payload, status: "pending" });

  if (error) {
    throw new Error(`Failed to queue ${eventType} notification event: ${error.message}`);
  }
}

// ─── Helper: format date ──────────────────────────────────────────────

function formatDate(dateStr: string): string {
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

// ─── Meeting triggers ─────────────────────────────────────────────────

export async function triggerMeetingScheduled(
  supabase: SupabaseClient,
  meetingId: string,
): Promise<void> {
  try {
    const { data: meeting } = await supabase
      .from("meeting")
      .select(
        "id, board_id, town_id, title, scheduled_date, scheduled_time, location, meeting_type",
      )
      .eq("id", meetingId)
      .single();

    if (!meeting) return;

    const { data: board } = await supabase
      .from("board")
      .select("name")
      .eq("id", meeting.board_id as string)
      .single();

    const { data: town } = await supabase
      .from("town")
      .select("name")
      .eq("id", meeting.town_id as string)
      .single();

    if (!board || !town) return;

    await enqueueEvent(supabase, "meeting_scheduled", meeting.town_id as string, {
      meeting_id: meetingId,
      board_id: meeting.board_id as string,
      townName: town.name as string,
      boardName: board.name as string,
      meetingDate: formatDate(meeting.scheduled_date as string),
      meetingTime: (meeting.scheduled_time as string) ?? "",
      location: (meeting.location as string) ?? "Town Hall",
      meetingType: meeting.meeting_type as string,
      meetingUrl: `${APP_URL}/meetings/${meetingId}`,
      action: "scheduled",
    });
  } catch (err) {
    console.error("[notification-trigger] triggerMeetingScheduled failed:", err);
  }
}

export async function triggerMeetingCancelled(
  supabase: SupabaseClient,
  meetingId: string,
): Promise<void> {
  try {
    const { data: meeting } = await supabase
      .from("meeting")
      .select(
        "id, board_id, town_id, title, scheduled_date, scheduled_time, location, meeting_type",
      )
      .eq("id", meetingId)
      .single();

    if (!meeting) return;

    const { data: board } = await supabase
      .from("board")
      .select("name")
      .eq("id", meeting.board_id as string)
      .single();

    const { data: town } = await supabase
      .from("town")
      .select("name")
      .eq("id", meeting.town_id as string)
      .single();

    if (!board || !town) return;

    await enqueueEvent(supabase, "meeting_cancelled", meeting.town_id as string, {
      meeting_id: meetingId,
      board_id: meeting.board_id as string,
      townName: town.name as string,
      boardName: board.name as string,
      meetingDate: formatDate(meeting.scheduled_date as string),
      meetingTime: (meeting.scheduled_time as string) ?? "",
      location: (meeting.location as string) ?? "Town Hall",
      meetingType: meeting.meeting_type as string,
      meetingUrl: `${APP_URL}/meetings/${meetingId}`,
      action: "cancelled",
    });
  } catch (err) {
    console.error("[notification-trigger] triggerMeetingCancelled failed:", err);
  }
}

// ─── Agenda trigger ───────────────────────────────────────────────────

export async function triggerAgendaPublished(
  supabase: SupabaseClient,
  meetingId: string,
  itemCount: number,
): Promise<void> {
  try {
    const { data: meeting } = await supabase
      .from("meeting")
      .select("id, board_id, town_id, scheduled_date")
      .eq("id", meetingId)
      .single();

    if (!meeting) return;

    const { data: board } = await supabase
      .from("board")
      .select("name")
      .eq("id", meeting.board_id as string)
      .single();

    const { data: town } = await supabase
      .from("town")
      .select("name, subdomain")
      .eq("id", meeting.town_id as string)
      .single();

    if (!board || !town) return;

    const subdomain = (town.subdomain as string | null) ?? "";
    const portalBase = subdomain ? `https://${subdomain}.townmeetingmanager.com` : APP_URL;

    await enqueueEvent(supabase, "agenda_published", meeting.town_id as string, {
      meeting_id: meetingId,
      board_id: meeting.board_id as string,
      townName: town.name as string,
      boardName: board.name as string,
      meetingDate: formatDate(meeting.scheduled_date as string),
      itemCount,
      agendaUrl: `${APP_URL}/meetings/${meetingId}/agenda`,
      portalUrl: `${portalBase}/meetings/${meetingId}`,
    });
  } catch (err) {
    console.error("[notification-trigger] triggerAgendaPublished failed:", err);
  }
}

// ─── Minutes triggers ─────────────────────────────────────────────────

export async function triggerMinutesReview(
  supabase: SupabaseClient,
  meetingId: string,
  minutesDocId: string,
): Promise<void> {
  try {
    const { data: meeting } = await supabase
      .from("meeting")
      .select("id, board_id, town_id, scheduled_date")
      .eq("id", meetingId)
      .single();

    if (!meeting) return;

    const { data: board } = await supabase
      .from("board")
      .select("name")
      .eq("id", meeting.board_id as string)
      .single();

    const { data: town } = await supabase
      .from("town")
      .select("name")
      .eq("id", meeting.town_id as string)
      .single();

    if (!board || !town) return;

    await enqueueEvent(supabase, "minutes_review", meeting.town_id as string, {
      meeting_id: meetingId,
      board_id: meeting.board_id as string,
      minutes_document_id: minutesDocId,
      townName: town.name as string,
      boardName: board.name as string,
      meetingDate: formatDate(meeting.scheduled_date as string),
      reviewUrl: `${APP_URL}/meetings/${meetingId}/minutes`,
    });
  } catch (err) {
    console.error("[notification-trigger] triggerMinutesReview failed:", err);
  }
}

export async function triggerMinutesApproved(
  supabase: SupabaseClient,
  meetingId: string,
  minutesDocId: string,
): Promise<void> {
  try {
    const { data: meeting } = await supabase
      .from("meeting")
      .select("id, board_id, town_id, scheduled_date")
      .eq("id", meetingId)
      .single();

    if (!meeting) return;

    const { data: board } = await supabase
      .from("board")
      .select("name")
      .eq("id", meeting.board_id as string)
      .single();

    const { data: town } = await supabase
      .from("town")
      .select("name, subdomain")
      .eq("id", meeting.town_id as string)
      .single();

    if (!board || !town) return;

    const subdomain = (town.subdomain as string | null) ?? "";
    const portalBase = subdomain ? `https://${subdomain}.townmeetingmanager.com` : APP_URL;

    await enqueueEvent(supabase, "minutes_approved", meeting.town_id as string, {
      meeting_id: meetingId,
      board_id: meeting.board_id as string,
      minutes_document_id: minutesDocId,
      townName: town.name as string,
      boardName: board.name as string,
      meetingDate: formatDate(meeting.scheduled_date as string),
      minutesUrl: `${APP_URL}/meetings/${meetingId}/minutes`,
      portalUrl: `${portalBase}/meetings/${meetingId}`,
    });
  } catch (err) {
    console.error("[notification-trigger] triggerMinutesApproved failed:", err);
  }
}
