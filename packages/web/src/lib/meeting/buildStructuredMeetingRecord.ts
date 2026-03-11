/**
 * Builds the structured meeting record JSON for the AI minutes pipeline.
 *
 * This pure function takes all meeting data and assembles the JSON
 * format defined in advisory 2.2 Section 2. The output is:
 * - Downloaded as a .json file from PostMeetingReview
 * - Stored in Supabase Storage for the API to access during minutes generation
 */

// ─── Input Types ─────────────────────────────────────────────────────

interface MeetingRecord {
  id: string;
  title: string;
  scheduled_date: string;
  scheduled_time: string | null;
  location: string | null;
  meeting_type: string;
  started_at: string | null;
  ended_at: string | null;
  adjournment: string | null; // JSONB as TEXT
}

interface BoardRecord {
  id: string;
  name: string;
  board_type: string;
  motion_display_format: string | null;
}

interface TownRecord {
  name: string;
  meeting_formality: string | null;
  minutes_style: string | null;
}

interface MemberRecord {
  boardMemberId: string;
  personId: string;
  name: string;
  seatTitle: string | null;
}

interface AttendanceInput {
  board_member_id: string | null;
  person_id: string;
  status: string;
  arrived_at: string | null;
  departed_at: string | null;
  is_recording_secretary: number;
}

interface AgendaItemInput {
  id: string;
  meeting_id: string;
  section_type: string | null;
  sort_order: number;
  title: string;
  description: string | null;
  presenter: string | null;
  estimated_duration: number | null;
  parent_item_id: string | null;
  status: string;
  staff_resource: string | null;
  background: string | null;
  recommendation: string | null;
  suggested_motion: string | null;
  operator_notes: string | null;
}

interface MotionInput {
  id: string;
  agenda_item_id: string;
  motion_text: string;
  motion_type: string;
  moved_by: string | null;
  seconded_by: string | null;
  status: string;
  parent_motion_id: string | null;
  vote_summary: string | null; // JSONB as TEXT
}

interface VoteRecordInput {
  id: string;
  motion_id: string;
  board_member_id: string;
  vote: string;
  recusal_reason: string | null;
}

interface ExecSessionInput {
  id: string;
  agenda_item_id: string | null;
  statutory_basis: string;
  entered_at: string | null;
  exited_at: string | null;
  entry_motion_id: string | null;
  post_session_action_motion_ids: string | null; // JSONB as TEXT
}

interface TransitionInput {
  agenda_item_id: string;
  started_at: string;
  ended_at: string | null;
}

interface ExhibitInput {
  id: string;
  agenda_item_id: string;
  title: string;
  file_name: string;
}

interface SpeakerInput {
  id: string;
  agenda_item_id: string;
  name: string;
  topic: string | null;
}

export interface StructuredMeetingRecordInput {
  meeting: MeetingRecord;
  board: BoardRecord;
  town: TownRecord;
  presidingOfficerName: string | null;
  recordingSecretaryName: string | null;
  members: MemberRecord[];
  attendance: AttendanceInput[];
  agendaItems: AgendaItemInput[];
  motions: MotionInput[];
  voteRecords: VoteRecordInput[];
  executiveSessions: ExecSessionInput[];
  transitions: TransitionInput[];
  exhibits: ExhibitInput[];
  speakers: SpeakerInput[];
}

// ─── Builder ─────────────────────────────────────────────────────────

export function buildStructuredMeetingRecord(
  input: StructuredMeetingRecordInput,
): Record<string, unknown> {
  const {
    meeting,
    board,
    town,
    presidingOfficerName,
    recordingSecretaryName,
    members,
    attendance,
    agendaItems,
    motions,
    voteRecords,
    executiveSessions,
    transitions,
    exhibits,
    speakers,
  } = input;

  // Build member lookup
  const memberNameMap = new Map<string, string>();
  members.forEach((m) => memberNameMap.set(m.boardMemberId, m.name));

  // Build vote records by motion
  const votesByMotion = new Map<string, VoteRecordInput[]>();
  voteRecords.forEach((v) => {
    if (!votesByMotion.has(v.motion_id)) votesByMotion.set(v.motion_id, []);
    votesByMotion.get(v.motion_id)!.push(v);
  });

  // Build motions by item
  const motionsByItem = new Map<string, MotionInput[]>();
  motions.forEach((m) => {
    if (!motionsByItem.has(m.agenda_item_id)) motionsByItem.set(m.agenda_item_id, []);
    motionsByItem.get(m.agenda_item_id)!.push(m);
  });

  // Build transitions by item
  const transitionsByItem = new Map<string, TransitionInput[]>();
  transitions.forEach((t) => {
    if (!transitionsByItem.has(t.agenda_item_id)) transitionsByItem.set(t.agenda_item_id, []);
    transitionsByItem.get(t.agenda_item_id)!.push(t);
  });

  // Build exhibits by item
  const exhibitsByItem = new Map<string, ExhibitInput[]>();
  exhibits.forEach((e) => {
    if (!exhibitsByItem.has(e.agenda_item_id)) exhibitsByItem.set(e.agenda_item_id, []);
    exhibitsByItem.get(e.agenda_item_id)!.push(e);
  });

  // Build speakers by item
  const speakersByItem = new Map<string, SpeakerInput[]>();
  speakers.forEach((s) => {
    if (!speakersByItem.has(s.agenda_item_id)) speakersByItem.set(s.agenda_item_id, []);
    speakersByItem.get(s.agenda_item_id)!.push(s);
  });

  // Build exec sessions by item
  const execByItem = new Map<string, ExecSessionInput>();
  executiveSessions.forEach((es) => {
    if (es.agenda_item_id) execByItem.set(es.agenda_item_id, es);
  });

  // ─── Attendance section ──────────────────────────────────────────

  const attendanceSection = {
    members: members.map((m) => {
      const att = attendance.find((a) => a.board_member_id === m.boardMemberId);
      return {
        name: m.name,
        seat_title: m.seatTitle,
        status: att?.status ?? "absent",
        arrived_at: att?.arrived_at ?? null,
        departed_at: att?.departed_at ?? null,
        is_recording_secretary: att?.is_recording_secretary === 1,
      };
    }),
    quorum_status: {
      present: attendance.filter(
        (a) => a.status === "present" || a.status === "remote" || a.status === "late_arrival",
      ).length,
      total: members.length,
    },
  };

  // ─── Build sections from parent items ──────────────────────────

  const parentItems = agendaItems
    .filter((i) => !i.parent_item_id)
    .sort((a, b) => a.sort_order - b.sort_order);

  const sections = parentItems.map((section) => {
    const children = agendaItems
      .filter((i) => i.parent_item_id === section.id)
      .sort((a, b) => a.sort_order - b.sort_order);

    // Get section timestamps from transitions
    const sectionTransitions = transitionsByItem.get(section.id) ?? [];
    const firstChildTransitions = children.length > 0
      ? (transitionsByItem.get(children[0]!.id) ?? [])
      : [];
    const allTransitions = [...sectionTransitions, ...firstChildTransitions];
    const timestampStart = allTransitions.length > 0
      ? allTransitions.sort((a, b) => a.started_at.localeCompare(b.started_at))[0]!.started_at
      : null;

    // Build items
    const items = children.map((item) => {
      const itemMotions = (motionsByItem.get(item.id) ?? [])
        .filter((m) => !m.parent_motion_id); // Only parent motions
      const itemExhibits = exhibitsByItem.get(item.id) ?? [];
      const itemSpeakers = speakersByItem.get(item.id) ?? [];
      const itemTransitions = transitionsByItem.get(item.id) ?? [];

      // Build motion data
      const motionData = itemMotions.map((m) => {
        const votes = votesByMotion.get(m.id) ?? [];
        const voteSummary = m.vote_summary ? safeJsonParse(m.vote_summary) : null;

        // Amendments
        const amendments = (motionsByItem.get(item.id) ?? [])
          .filter((am) => am.parent_motion_id === m.id);

        return {
          text: m.motion_text,
          motion_type: m.motion_type,
          moved_by: m.moved_by ? memberNameMap.get(m.moved_by) ?? m.moved_by : null,
          seconded_by: m.seconded_by ? memberNameMap.get(m.seconded_by) ?? m.seconded_by : null,
          status: m.status,
          vote: votes.length > 0
            ? {
                type: "roll_call",
                result: voteSummary?.result ?? m.status,
                yeas: voteSummary?.yeas ?? 0,
                nays: voteSummary?.nays ?? 0,
                abstentions: voteSummary?.abstentions ?? 0,
                individual_votes: votes.map((v) => ({
                  member: memberNameMap.get(v.board_member_id) ?? v.board_member_id,
                  vote: v.vote,
                  reason: v.recusal_reason ?? undefined,
                })),
              }
            : null,
          amendments: amendments.map((am) => ({
            text: am.motion_text,
            moved_by: am.moved_by ? memberNameMap.get(am.moved_by) ?? am.moved_by : null,
            seconded_by: am.seconded_by ? memberNameMap.get(am.seconded_by) ?? am.seconded_by : null,
            status: am.status,
          })),
        };
      });

      // Recusals (from vote records with vote='recusal')
      const allItemVotes = itemMotions.flatMap((m) => votesByMotion.get(m.id) ?? []);
      const recusals = allItemVotes
        .filter((v) => v.vote === "recusal")
        .map((v) => ({
          member: memberNameMap.get(v.board_member_id) ?? v.board_member_id,
          reason: v.recusal_reason ?? "Not specified",
          recused_from: "discussion_and_vote",
        }));

      // Timestamps
      const startedAt = itemTransitions.length > 0
        ? itemTransitions.sort((a, b) => a.started_at.localeCompare(b.started_at))[0]!.started_at
        : null;
      const endedAt = itemTransitions.length > 0
        ? itemTransitions
            .filter((t) => t.ended_at)
            .sort((a, b) => (b.ended_at ?? "").localeCompare(a.ended_at ?? ""))
            [0]?.ended_at ?? null
        : null;

      return {
        title: item.title,
        section_ref: null as string | null, // Could compute from indices
        staff_resource: item.staff_resource,
        background: item.background,
        recommendation: item.recommendation,
        suggested_motion: item.suggested_motion,
        operator_notes: item.operator_notes,
        exhibits: itemExhibits.map((e) => ({ title: e.title, file_name: e.file_name })),
        speakers: itemSpeakers.map((s) => ({ name: s.name, topic: s.topic })),
        motion: motionData.length === 1 ? motionData[0] : motionData.length > 0 ? motionData : null,
        recusals: recusals.length > 0 ? recusals : undefined,
        status: item.status,
        timestamp_start: startedAt,
        timestamp_end: endedAt,
      };
    });

    // Executive session data for this section
    const execSession = execByItem.get(section.id);
    const execSessionData = execSession
      ? {
          entered_at: execSession.entered_at,
          returned_at: execSession.exited_at,
          statutory_basis: execSession.statutory_basis,
          post_session_actions: buildPostSessionActions(execSession, motions, votesByMotion, memberNameMap),
        }
      : undefined;

    // Adjournment data (from meeting.adjournment for procedural sections)
    const adjournmentData =
      section.section_type === "procedural" &&
      section.title.toLowerCase().includes("adjourn") &&
      meeting.adjournment
        ? safeJsonParse(meeting.adjournment)
        : undefined;

    // Future items queue
    const futureItemsQueue =
      section.section_type === "discussion" &&
      section.title.toLowerCase().includes("future")
        ? items
            .filter((i) => i.operator_notes)
            .map((i) => i.title)
        : undefined;

    return {
      title: section.title,
      section_type: section.section_type,
      timestamp_start: timestampStart,
      items,
      ...(execSessionData && { executive_session: execSessionData }),
      ...(adjournmentData && { adjournment: adjournmentData }),
      ...(futureItemsQueue && futureItemsQueue.length > 0 && { future_items_queue: futureItemsQueue }),
    };
  });

  // ─── Assemble final record ────────────────────────────────────

  return {
    meeting: {
      id: meeting.id,
      title: meeting.title,
      board: board.name,
      board_type: board.board_type,
      date: meeting.scheduled_date,
      time: meeting.scheduled_time,
      location: meeting.location,
      type: meeting.meeting_type,
      started_at: meeting.started_at,
      ended_at: meeting.ended_at,
      presiding_officer: presidingOfficerName,
      minutes_preparer: recordingSecretaryName,
    },
    attendance: attendanceSection,
    sections,
    town_profile: {
      town_name: town.name,
      minutes_style: town.minutes_style,
      formality: town.meeting_formality,
      motion_display_format: board.motion_display_format,
    },
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────

function safeJsonParse(text: string): Record<string, unknown> | null {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function buildPostSessionActions(
  execSession: ExecSessionInput,
  allMotions: MotionInput[],
  votesByMotion: Map<string, VoteRecordInput[]>,
  memberNameMap: Map<string, string>,
): Array<Record<string, unknown>> {
  const motionIds: string[] = execSession.post_session_action_motion_ids
    ? (safeJsonParse(execSession.post_session_action_motion_ids) as unknown as string[]) ?? []
    : [];

  return motionIds
    .map((id) => {
      const motion = allMotions.find((m) => m.id === id);
      if (!motion) return null;
      const votes = votesByMotion.get(id) ?? [];
      const summary = motion.vote_summary ? safeJsonParse(motion.vote_summary) : null;

      return {
        text: motion.motion_text,
        moved_by: motion.moved_by ? memberNameMap.get(motion.moved_by) ?? motion.moved_by : null,
        seconded_by: motion.seconded_by ? memberNameMap.get(motion.seconded_by) ?? motion.seconded_by : null,
        vote: votes.length > 0
          ? {
              type: "roll_call",
              result: summary?.result ?? motion.status,
              yeas: summary?.yeas ?? 0,
              nays: summary?.nays ?? 0,
              individual_votes: votes.map((v) => ({
                member: memberNameMap.get(v.board_member_id) ?? v.board_member_id,
                vote: v.vote,
              })),
            }
          : null,
      };
    })
    .filter(Boolean) as Array<Record<string, unknown>>;
}

// ─── Download helper ────────────────────────────────────────────────

export function downloadMeetingRecord(
  record: Record<string, unknown>,
  boardName: string,
  meetingDate: string,
): void {
  const json = JSON.stringify(record, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const slug = boardName.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
  const filename = `${slug}-${meetingDate}-meeting-data.json`;

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
