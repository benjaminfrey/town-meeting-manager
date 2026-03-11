/**
 * Meeting helper utilities.
 *
 * - instantiateAgendaFromTemplate: populates agenda_items from a template
 * - autoPopulateMinutesApproval: finds meetings needing minutes approval
 */

import type { AgendaTemplateSection } from "@town-meeting/shared/types";

interface PowerSyncLike {
  execute: (sql: string, params: unknown[]) => Promise<unknown>;
  getAll: (sql: string, params: unknown[]) => Promise<Record<string, unknown>[]>;
}

/**
 * Create agenda_items from a template's sections for a new meeting.
 *
 * For each template section, inserts a parent agenda_item.
 * For each default_items[] entry, inserts a child agenda_item.
 * For minutes_approval sections, auto-populates with previous meetings.
 */
export async function instantiateAgendaFromTemplate(
  powerSync: PowerSyncLike,
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
    await powerSync.execute(
      `INSERT INTO agenda_items (id, meeting_id, town_id, section_type, sort_order, title, description, presenter, estimated_duration, parent_item_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        sectionId,
        meetingId,
        townId,
        section.section_type,
        i,
        section.title,
        section.description ?? null,
        null,
        null,
        null,
        "pending",
        now,
        now,
      ],
    );

    // For minutes_approval sections, auto-populate with previous meetings
    if (section.section_type === "minutes_approval") {
      await autoPopulateMinutesApproval(
        powerSync,
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
      for (let j = 0; j < section.default_items.length; j++) {
        const childId = crypto.randomUUID();
        await powerSync.execute(
          `INSERT INTO agenda_items (id, meeting_id, town_id, section_type, sort_order, title, description, presenter, estimated_duration, parent_item_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            childId,
            meetingId,
            townId,
            section.section_type,
            j,
            section.default_items[j],
            null,
            null,
            null,
            sectionId,
            "pending",
            now,
            now,
          ],
        );
      }
    }
  }
}

/**
 * Find meetings needing minutes approval and insert them as child items
 * under the minutes_approval section.
 */
async function autoPopulateMinutesApproval(
  powerSync: PowerSyncLike,
  meetingId: string,
  boardId: string,
  townId: string,
  sectionId: string,
  now: string,
): Promise<void> {
  const rows = await powerSync.getAll(
    `SELECT id, title, scheduled_date FROM meetings WHERE board_id = ? AND status IN ('adjourned', 'minutes_draft') AND id != ? ORDER BY scheduled_date ASC`,
    [boardId, meetingId],
  );

  for (let j = 0; j < rows.length; j++) {
    const row = rows[j]!;
    const date = String(row.scheduled_date ?? "");
    const formattedDate = date
      ? new Date(date + "T00:00:00").toLocaleDateString("en-US", {
          month: "long",
          day: "numeric",
          year: "numeric",
        })
      : "Unknown Date";

    const childId = crypto.randomUUID();
    await powerSync.execute(
      `INSERT INTO agenda_items (id, meeting_id, town_id, section_type, sort_order, title, description, presenter, estimated_duration, parent_item_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        childId,
        meetingId,
        townId,
        "minutes_approval",
        j,
        `Approval of Minutes — ${formattedDate}`,
        null,
        null,
        null,
        sectionId,
        "pending",
        now,
        now,
      ],
    );
  }
}
