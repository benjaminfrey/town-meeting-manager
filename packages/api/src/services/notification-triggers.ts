/**
 * Notification trigger helpers.
 *
 * Called from API routes on key lifecycle events to fire notification
 * events through the full NotificationService pipeline.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { NotificationService } from "./notification-service.js";

const APP_URL = process.env.APP_URL ?? "https://app.townmeetingmanager.com";

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
      .select("id, board_id, town_id, title, scheduled_date, scheduled_time, location, meeting_type")
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

    const service = new NotificationService(supabase);
    await service.createNotificationEvent("meeting_scheduled", meeting.town_id as string, {
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
      .select("id, board_id, town_id, title, scheduled_date, scheduled_time, location, meeting_type")
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

    const service = new NotificationService(supabase);
    await service.createNotificationEvent("meeting_cancelled", meeting.town_id as string, {
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
    const portalBase = subdomain
      ? `https://${subdomain}.townmeetingmanager.com`
      : APP_URL;

    const service = new NotificationService(supabase);
    await service.createNotificationEvent("agenda_published", meeting.town_id as string, {
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

    const service = new NotificationService(supabase);
    await service.createNotificationEvent("minutes_review", meeting.town_id as string, {
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
    const portalBase = subdomain
      ? `https://${subdomain}.townmeetingmanager.com`
      : APP_URL;

    const service = new NotificationService(supabase);
    await service.createNotificationEvent("minutes_approved", meeting.town_id as string, {
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
