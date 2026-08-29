/**
 * Notification trigger helpers.
 *
 * Called from API routes on key lifecycle events to queue notification events
 * for the pipeline in `notification-service.ts`.
 *
 * ─── Task D1f: the split D1c drew has been closed ─────────────────────────
 *
 * D1c left this file as the ONE place still on the service-role client, and
 * said exactly why: `NotificationService` had become tenant-bound (it is
 * constructed from a `TenantJob`, which cannot exist without a town), and this
 * module could not supply one, because its only caller — `routes/minutes.ts` —
 * held a Supabase client and belonged to another task. So D1c split the
 * pipeline in half:
 *
 *   ENQUEUE (here)  — one INSERT of a `pending` notification_event row,
 *                     through the service-role client, with `town_id` supplied
 *                     by this file rather than by the database.
 *   PROCESS (there) — picked up by the next 60-second sweep in `server.ts`.
 *
 * `routes/minutes.ts` is now on `withTenant`, so it can hand over a
 * `tenantJob(fastify.tenantDb, request.tenant.townId)` and the split is no
 * longer needed. Both halves are `NotificationService` again:
 * `createNotificationEvent` inserts the row inside the job's tenant
 * transaction AND schedules processing immediately, so the up-to-60-second
 * delivery latency the split introduced is gone.
 *
 * What that changes about tenancy, precisely: `town_id` on the queued row is
 * now `job.townId` — established from the caller's session — instead of
 * `meeting.town_id` read back out of an unfiltered service-role query. The
 * two can no longer disagree, because the meeting read itself happens inside
 * the same tenant transaction: a meeting id belonging to another town returns
 * no row and the trigger does nothing.
 *
 * ─── Why a failure here is swallowed ──────────────────────────────────────
 *
 * Unchanged from before, and deliberate: these are called from `setImmediate`
 * after the route has already answered. A meeting whose board or town row has
 * gone returns early; anything else is logged. Queuing a notification must
 * never be what fails a minutes submission that has already been recorded.
 */

import { sql } from "drizzle-orm";
import type { TenantJob } from "../jobs/tenant-job.js";
import { toRows } from "../db/rows.js";
import { NotificationService } from "./notification-service.js";
import type { NotificationEventType } from "@town-meeting/shared";

const APP_URL = process.env.APP_URL ?? "https://app.townmeetingmanager.com";

function rows<T>(result: unknown, what: string): T[] {
  return toRows<T>(result, (message) => new Error(`${what}: ${message}`));
}

/**
 * Queue an event for this job's town, and start processing it.
 *
 * The tenant is the job's, so there is no `townId` argument to get wrong —
 * see `NotificationService.createNotificationEvent`.
 */
async function enqueueEvent(
  job: TenantJob,
  eventType: NotificationEventType,
  payload: Record<string, unknown>,
): Promise<void> {
  await new NotificationService(job).createNotificationEvent(eventType, payload);
}

interface MeetingContextRow {
  id: string;
  board_id: string;
  town_id: string;
  scheduled_date: string;
  scheduled_time: string | null;
  location: string | null;
  meeting_type: string;
  board_name: string;
  town_name: string;
  town_subdomain: string | null;
}

/**
 * The meeting, its board and its town in one read.
 *
 * Three sequential `.single()` queries before; one join now. Not a
 * micro-optimisation — every one of the five triggers needs the same three
 * rows, and a join through `meeting.board_id` (NOT NULL) and `meeting.town_id`
 * makes "the board and town this meeting actually belongs to" a property of
 * the query rather than of three ids passed between statements.
 *
 * Returns `null` when the meeting is not visible in this job's town, which
 * under RLS is the same answer as "no such meeting" — and must be, or the
 * distinction becomes a membership oracle over other towns' meetings.
 */
async function loadMeetingContext(
  job: TenantJob,
  meetingId: string,
): Promise<MeetingContextRow | null> {
  const found = await job.run(async (tx) =>
    rows<MeetingContextRow>(
      await tx.execute(sql`
        SELECT m.id,
               m.board_id,
               m.town_id,
               m.scheduled_date::text AS scheduled_date,
               m.scheduled_time::text AS scheduled_time,
               m.location,
               m.meeting_type::text AS meeting_type,
               b.name AS board_name,
               t.name AS town_name,
               t.subdomain AS town_subdomain
        FROM meeting m
        JOIN board b ON b.id = m.board_id
        JOIN town t ON t.id = m.town_id
        WHERE m.id = ${meetingId}
      `),
      "notification-trigger.meetingContext",
    ),
  );
  return found[0] ?? null;
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

/** A town's portal origin, or the app's when the town has no subdomain yet. */
function portalBaseFor(subdomain: string | null): string {
  return subdomain ? `https://${subdomain}.townmeetingmanager.com` : APP_URL;
}

// ─── Meeting triggers ─────────────────────────────────────────────────

export async function triggerMeetingScheduled(job: TenantJob, meetingId: string): Promise<void> {
  try {
    const meeting = await loadMeetingContext(job, meetingId);
    if (!meeting) return;

    await enqueueEvent(job, "meeting_scheduled", {
      meeting_id: meetingId,
      board_id: meeting.board_id,
      townName: meeting.town_name,
      boardName: meeting.board_name,
      meetingDate: formatDate(meeting.scheduled_date),
      meetingTime: meeting.scheduled_time ?? "",
      location: meeting.location ?? "Town Hall",
      meetingType: meeting.meeting_type,
      meetingUrl: `${APP_URL}/meetings/${meetingId}`,
      action: "scheduled",
    });
  } catch (err) {
    console.error("[notification-trigger] triggerMeetingScheduled failed:", err);
  }
}

export async function triggerMeetingCancelled(job: TenantJob, meetingId: string): Promise<void> {
  try {
    const meeting = await loadMeetingContext(job, meetingId);
    if (!meeting) return;

    await enqueueEvent(job, "meeting_cancelled", {
      meeting_id: meetingId,
      board_id: meeting.board_id,
      townName: meeting.town_name,
      boardName: meeting.board_name,
      meetingDate: formatDate(meeting.scheduled_date),
      meetingTime: meeting.scheduled_time ?? "",
      location: meeting.location ?? "Town Hall",
      meetingType: meeting.meeting_type,
      meetingUrl: `${APP_URL}/meetings/${meetingId}`,
      action: "cancelled",
    });
  } catch (err) {
    console.error("[notification-trigger] triggerMeetingCancelled failed:", err);
  }
}

// ─── Agenda trigger ───────────────────────────────────────────────────

export async function triggerAgendaPublished(
  job: TenantJob,
  meetingId: string,
  itemCount: number,
): Promise<void> {
  try {
    const meeting = await loadMeetingContext(job, meetingId);
    if (!meeting) return;

    await enqueueEvent(job, "agenda_published", {
      meeting_id: meetingId,
      board_id: meeting.board_id,
      townName: meeting.town_name,
      boardName: meeting.board_name,
      meetingDate: formatDate(meeting.scheduled_date),
      itemCount,
      agendaUrl: `${APP_URL}/meetings/${meetingId}/agenda`,
      portalUrl: `${portalBaseFor(meeting.town_subdomain)}/meetings/${meetingId}`,
    });
  } catch (err) {
    console.error("[notification-trigger] triggerAgendaPublished failed:", err);
  }
}

// ─── Minutes triggers ─────────────────────────────────────────────────

export async function triggerMinutesReview(
  job: TenantJob,
  meetingId: string,
  minutesDocId: string,
): Promise<void> {
  try {
    const meeting = await loadMeetingContext(job, meetingId);
    if (!meeting) return;

    await enqueueEvent(job, "minutes_review", {
      meeting_id: meetingId,
      board_id: meeting.board_id,
      minutes_document_id: minutesDocId,
      townName: meeting.town_name,
      boardName: meeting.board_name,
      meetingDate: formatDate(meeting.scheduled_date),
      reviewUrl: `${APP_URL}/meetings/${meetingId}/minutes`,
    });
  } catch (err) {
    console.error("[notification-trigger] triggerMinutesReview failed:", err);
  }
}

export async function triggerMinutesApproved(
  job: TenantJob,
  meetingId: string,
  minutesDocId: string,
): Promise<void> {
  try {
    const meeting = await loadMeetingContext(job, meetingId);
    if (!meeting) return;

    await enqueueEvent(job, "minutes_approved", {
      meeting_id: meetingId,
      board_id: meeting.board_id,
      minutes_document_id: minutesDocId,
      townName: meeting.town_name,
      boardName: meeting.board_name,
      meetingDate: formatDate(meeting.scheduled_date),
      minutesUrl: `${APP_URL}/meetings/${meetingId}/minutes`,
      portalUrl: `${portalBaseFor(meeting.town_subdomain)}/meetings/${meetingId}`,
    });
  } catch (err) {
    console.error("[notification-trigger] triggerMinutesApproved failed:", err);
  }
}
