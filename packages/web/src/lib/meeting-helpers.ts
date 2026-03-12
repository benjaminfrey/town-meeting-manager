/**
 * Meeting helper utilities.
 *
 * - instantiateAgendaFromTemplate: populates agenda_items from a template
 * - autoPopulateMinutesApproval: finds meetings needing minutes approval
 *
 * Uses the Supabase singleton directly (not a hook) so it can be called
 * from outside React component lifecycle (e.g. during route loaders or
 * one-shot async handlers).
 */

import { supabase } from "@/lib/supabase";
import type { AgendaTemplateSection } from "@town-meeting/shared/types";

/**
 * Create agenda_items from a template's sections for a new meeting.
 *
 * For each template section, inserts a parent agenda_item.
 * For each default_items[] entry, inserts a child agenda_item.
 * For minutes_approval sections, auto-populates with previous meetings.
 */
export async function instantiateAgendaFromTemplate(
  meetingId: string,
  boardId: string,
  townId: string,
  sections: AgendaTemplateSection[],
): Promise<void> {
  const now = new Date().toISOString();

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i]!;
    const sectionId = crypto.randomUUID();

    // Insert the section-level agenda item (parent)
    const { error: sectionError } = await supabase.from("agenda_item").insert({
      id: sectionId,
      meeting_id: meetingId,
      town_id: townId,
      section_type: section.section_type,
      sort_order: i,
      title: section.title,
      description: section.description ?? null,
      presenter: null,
      estimated_duration: null,
      parent_item_id: null,
      status: "pending",
      created_at: now,
      updated_at: now,
    });
    if (sectionError) throw sectionError;

    // For minutes_approval sections, auto-populate with previous meetings
    if (section.section_type === "minutes_approval") {
      await autoPopulateMinutesApproval(
        meetingId,
        boardId,
        townId,
        sectionId,
        now,
      );
      continue;
    }

    // Insert default items as children
    if (section.default_items && section.default_items.length > 0) {
      const childItems = section.default_items.map((title, j) => ({
        id: crypto.randomUUID(),
        meeting_id: meetingId,
        town_id: townId,
        section_type: section.section_type,
        sort_order: j,
        title,
        description: null,
        presenter: null,
        estimated_duration: null,
        parent_item_id: sectionId,
        status: "pending",
        created_at: now,
        updated_at: now,
      }));
      const { error: childError } = await supabase
        .from("agenda_item")
        .insert(childItems);
      if (childError) throw childError;
    }
  }
}

/**
 * Find meetings needing minutes approval and insert them as child items
 * under the minutes_approval section.
 */
async function autoPopulateMinutesApproval(
  meetingId: string,
  boardId: string,
  townId: string,
  sectionId: string,
  now: string,
): Promise<void> {
  // Query minutes documents in review status for this board
  const { data: minutesDocsData } = await supabase
    .from("minutes_document")
    .select("id, meeting_id, approved_as_amended, amendments_history")
    .eq("board_id", boardId)
    .eq("status", "review");
  const minutesDocs = minutesDocsData ?? [];

  // Find meetings with adjourned/minutes_draft status needing minutes approval
  const { data: meetingRowsData } = await supabase
    .from("meeting")
    .select("id, title, scheduled_date")
    .eq("board_id", boardId)
    .in("status", ["adjourned", "minutes_draft"])
    .neq("id", meetingId)
    .order("scheduled_date");
  const meetingRowsRaw = meetingRowsData ?? [];

  // Get the board name for the suggested motion
  const { data: boardData } = await supabase
    .from("board")
    .select("name")
    .eq("id", boardId)
    .single();
  const boardName = boardData?.name ?? "";

  // Build a lookup: meeting_id → minutes_document for reviewed minutes
  const minutesByMeeting = new Map<string, (typeof minutesDocs)[0]>();
  for (const doc of minutesDocs) {
    minutesByMeeting.set(String(doc.meeting_id), doc);
  }

  // Merge in any reviewed meetings not already in meetingRows
  const meetingRows = [...meetingRowsRaw] as Array<{
    id: string;
    title: string | null;
    scheduled_date: string | null;
  }>;
  const existingMeetingIds = new Set(meetingRows.map((r) => String(r.id)));
  const reviewedMeetingIds = minutesDocs
    .map((d) => String(d.meeting_id))
    .filter((mid) => mid !== meetingId && !existingMeetingIds.has(mid));

  if (reviewedMeetingIds.length > 0) {
    const { data: extraMeetings = [] } = await supabase
      .from("meeting")
      .select("id, title, scheduled_date")
      .in("id", reviewedMeetingIds);
    meetingRows.push(...(extraMeetings as typeof meetingRows));
  }

  // Sort by date
  meetingRows.sort((a, b) => {
    const da = String(a.scheduled_date ?? "");
    const db = String(b.scheduled_date ?? "");
    return da.localeCompare(db);
  });

  const childItems: Array<Record<string, unknown>> = [];
  let sortOrder = 0;
  for (const row of meetingRows) {
    const mid = String(row.id);
    if (mid === meetingId) continue;

    const date = String(row.scheduled_date ?? "");
    const formattedDate = date
      ? new Date(date + "T00:00:00").toLocaleDateString("en-US", {
          month: "long",
          day: "numeric",
          year: "numeric",
        })
      : "Unknown Date";

    const minutesDoc = minutesByMeeting.get(mid);
    const docId = minutesDoc ? String(minutesDoc.id) : null;

    // Determine if amendments were applied (amendments_history is JSONB — native array)
    const historyRaw = minutesDoc?.amendments_history;
    const hasAmendments =
      Array.isArray(historyRaw) && historyRaw.length > 0;

    const suffix = hasAmendments ? "as amended" : "as presented";
    const suggestedMotion = boardName
      ? `to approve the minutes of the ${boardName} meeting of ${formattedDate} ${suffix}`
      : `to approve the minutes of the meeting of ${formattedDate} ${suffix}`;

    childItems.push({
      id: crypto.randomUUID(),
      meeting_id: meetingId,
      town_id: townId,
      section_type: "minutes_approval",
      sort_order: sortOrder,
      title: `Approval of Minutes — ${formattedDate}`,
      description: null,
      presenter: null,
      estimated_duration: null,
      parent_item_id: sectionId,
      status: "pending",
      suggested_motion: suggestedMotion,
      source_minutes_document_id: docId,
      created_at: now,
      updated_at: now,
    });
    sortOrder++;
  }

  if (childItems.length > 0) {
    const { error } = await supabase.from("agenda_item").insert(childItems);
    if (error) throw error;
  }
}
