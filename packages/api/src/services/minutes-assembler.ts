/**
 * Minutes JSON assembler.
 *
 * Queries Supabase for all meeting-related data and constructs the
 * canonical MinutesContentJson structure used by renderers and PDF
 * generators downstream.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  MinutesContentJson,
  MinutesMeetingHeader,
  MinutesAttendance,
  MinutesAttendanceMember,
  MinutesContentSection,
  MinutesContentItem,
  MinutesMotion,
  MinutesVote,
  MinutesAmendment,
  MinutesRecusal,
  MinutesSpeaker,
  MinutesAdjournment,
  MinutesCertification,
  MinutesExecutiveSession,
  AgendaTemplateSection,
} from "@town-meeting/shared";
import { calculateQuorum } from "@town-meeting/shared";

// ─── Internal Row Types ─────────────────────────────────────────────
// Lightweight row shapes for PostgREST results — not exhaustive,
// only the columns we actually read.

interface MeetingRow {
  id: string;
  board_id: string;
  town_id: string;
  title: string;
  meeting_type: string;
  scheduled_date: string;
  location: string | null;
  started_at: string | null;
  ended_at: string | null;
  presiding_officer_id: string | null;
  recording_secretary_id: string | null;
  adjournment: Record<string, unknown> | null;
}

interface BoardRow {
  id: string;
  name: string;
  board_type: string | null;
  member_count: number;
  quorum_type: string | null;
  quorum_value: number | null;
  motion_display_format: string | null;
  certification_format: string | null;
  member_reference_style: string | null;
  minutes_style_override: string | null;
  meeting_formality_override: string | null;
}

interface TownRow {
  id: string;
  name: string;
  minutes_style: string;
  meeting_formality: string;
}

interface AgendaItemRow {
  id: string;
  meeting_id: string;
  section_type: string;
  sort_order: number;
  title: string;
  description: string | null;
  presenter: string | null;
  parent_item_id: string | null;
  status: string;
  staff_resource: string | null;
  background: string | null;
  recommendation: string | null;
  operator_notes: string | null;
}

interface BoardMemberRow {
  id: string;
  person_id: string;
  seat_title: string | null;
  status: string;
  is_default_rec_sec: boolean;
}

interface PersonRow {
  id: string;
  name: string;
}

interface AttendanceRow {
  id: string;
  board_member_id: string;
  person_id: string | null;
  status: string;
  is_recording_secretary: boolean;
  arrived_at: string | null;
  departed_at: string | null;
}

interface MotionRow {
  id: string;
  agenda_item_id: string;
  meeting_id: string;
  motion_text: string;
  motion_type: string;
  moved_by: string | null;
  seconded_by: string | null;
  status: string;
  parent_motion_id: string | null;
  created_at: string;
}

interface VoteRecordRow {
  id: string;
  motion_id: string;
  board_member_id: string;
  vote: string;
  recusal_reason: string | null;
}

interface ExecSessionRow {
  id: string;
  agenda_item_id: string;
  statutory_basis: string;
  entered_at: string | null;
  exited_at: string | null;
  post_session_action_motion_ids: string | null;
}

interface TransitionRow {
  id: string;
  agenda_item_id: string;
  started_at: string | null;
  ended_at: string | null;
}

interface GuestSpeakerRow {
  id: string;
  agenda_item_id: string;
  name: string;
  address: string | null;
  topic: string | null;
}

interface ExhibitRow {
  id: string;
  agenda_item_id: string;
  title: string;
}

// ─── Helper: throw on Supabase error ───────────────────────────────

function unwrap<T>(result: { data: T | null; error: unknown }, label: string): T {
  if (result.error) {
    throw new Error(`Failed to fetch ${label}: ${JSON.stringify(result.error)}`);
  }
  return result.data as T;
}

// ─── Main Assembler ─────────────────────────────────────────────────

export async function assembleMinutesJson(
  supabase: SupabaseClient,
  meetingId: string,
): Promise<MinutesContentJson> {
  // ── 1. Fetch the meeting record ───────────────────────────────────
  const meeting = unwrap<MeetingRow>(
    await supabase
      .from("meeting")
      .select("*")
      .eq("id", meetingId)
      .single(),
    "meeting",
  );

  // ── 2. Parallel fetches for board, town, and meeting-scoped data ──
  const [
    boardResult,
    townResult,
    agendaItemsResult,
    attendanceResult,
    motionsResult,
    voteRecordsResult,
    execSessionsResult,
    transitionsResult,
    guestSpeakersResult,
  ] = await Promise.all([
    supabase.from("board").select("*").eq("id", meeting.board_id).single(),
    supabase.from("town").select("*").eq("id", meeting.town_id).single(),
    supabase
      .from("agenda_item")
      .select("*")
      .eq("meeting_id", meetingId)
      .order("sort_order"),
    supabase.from("meeting_attendance").select("*").eq("meeting_id", meetingId),
    supabase.from("motion").select("*").eq("meeting_id", meetingId),
    supabase.from("vote_record").select("*").eq("meeting_id", meetingId),
    supabase.from("executive_session").select("*").eq("meeting_id", meetingId),
    supabase
      .from("agenda_item_transition")
      .select("*")
      .eq("meeting_id", meetingId),
    supabase.from("guest_speaker").select("*").eq("meeting_id", meetingId),
  ]);

  const board = unwrap<BoardRow>(boardResult, "board");
  const town = unwrap<TownRow>(townResult, "town");
  const agendaItems = unwrap<AgendaItemRow[]>(agendaItemsResult, "agenda_items") ?? [];
  const attendance = unwrap<AttendanceRow[]>(attendanceResult, "attendance") ?? [];
  const motions = unwrap<MotionRow[]>(motionsResult, "motions") ?? [];
  const voteRecords = unwrap<VoteRecordRow[]>(voteRecordsResult, "vote_records") ?? [];
  const execSessions = unwrap<ExecSessionRow[]>(execSessionsResult, "executive_sessions") ?? [];
  const transitions = unwrap<TransitionRow[]>(transitionsResult, "transitions") ?? [];
  const guestSpeakers = unwrap<GuestSpeakerRow[]>(guestSpeakersResult, "guest_speakers") ?? [];

  // ── 3. Fetch board members + persons for name lookups ─────────────
  const [boardMembersResult, personsResult] = await Promise.all([
    supabase
      .from("board_member")
      .select("*")
      .eq("board_id", meeting.board_id)
      .eq("status", "active"),
    supabase.from("person").select("id, name").eq("town_id", meeting.town_id),
  ]);

  const boardMembers = unwrap<BoardMemberRow[]>(boardMembersResult, "board_members") ?? [];
  const persons = unwrap<PersonRow[]>(personsResult, "persons") ?? [];

  // ── 4. Fetch default agenda template for section config ───────────
  const templateResult = await supabase
    .from("agenda_template")
    .select("*")
    .eq("board_id", meeting.board_id)
    .eq("is_default", true)
    .maybeSingle();

  const templateRow = templateResult.data as {
    sections: AgendaTemplateSection[] | string | null;
  } | null;

  let templateSections: AgendaTemplateSection[] = [];
  if (templateRow?.sections) {
    templateSections =
      typeof templateRow.sections === "string"
        ? (JSON.parse(templateRow.sections) as AgendaTemplateSection[])
        : templateRow.sections;
  }

  // ── 5. Fetch exhibits for all agenda items ────────────────────────
  const allItemIds = agendaItems.map((ai) => ai.id);
  let exhibits: ExhibitRow[] = [];
  if (allItemIds.length > 0) {
    const exhibitsResult = await supabase
      .from("exhibit")
      .select("id, agenda_item_id, title")
      .in("agenda_item_id", allItemIds);
    exhibits = unwrap<ExhibitRow[]>(exhibitsResult, "exhibits") ?? [];
  }

  // ── 6. Build lookup maps ──────────────────────────────────────────
  const personById = new Map<string, PersonRow>();
  for (const p of persons) personById.set(p.id, p);

  const boardMemberById = new Map<string, BoardMemberRow>();
  for (const bm of boardMembers) boardMemberById.set(bm.id, bm);

  /** Resolve a board_member_id to a display name. */
  function memberName(boardMemberId: string | null): string | null {
    if (!boardMemberId) return null;
    const bm = boardMemberById.get(boardMemberId);
    if (!bm) return null;
    const person = personById.get(bm.person_id);
    return person?.name ?? null;
  }

  /** Resolve a person_id to a display name. */
  function personName(personId: string | null): string | null {
    if (!personId) return null;
    return personById.get(personId)?.name ?? null;
  }

  // Index maps for related data
  const motionsByItem = new Map<string, MotionRow[]>();
  for (const m of motions) {
    const list = motionsByItem.get(m.agenda_item_id) ?? [];
    list.push(m);
    motionsByItem.set(m.agenda_item_id, list);
  }

  const motionById = new Map<string, MotionRow>();
  for (const m of motions) motionById.set(m.id, m);

  const votesByMotion = new Map<string, VoteRecordRow[]>();
  for (const vr of voteRecords) {
    const list = votesByMotion.get(vr.motion_id) ?? [];
    list.push(vr);
    votesByMotion.set(vr.motion_id, list);
  }

  const execSessionByItem = new Map<string, ExecSessionRow>();
  for (const es of execSessions) {
    execSessionByItem.set(es.agenda_item_id, es);
  }

  const transitionByItem = new Map<string, TransitionRow>();
  for (const t of transitions) {
    transitionByItem.set(t.agenda_item_id, t);
  }

  const speakersByItem = new Map<string, GuestSpeakerRow[]>();
  for (const gs of guestSpeakers) {
    const list = speakersByItem.get(gs.agenda_item_id) ?? [];
    list.push(gs);
    speakersByItem.set(gs.agenda_item_id, list);
  }

  const exhibitsByItem = new Map<string, ExhibitRow[]>();
  for (const ex of exhibits) {
    const list = exhibitsByItem.get(ex.agenda_item_id) ?? [];
    list.push(ex);
    exhibitsByItem.set(ex.agenda_item_id, list);
  }

  // Template section lookup by section_type
  const templateByType = new Map<string, AgendaTemplateSection>();
  for (const ts of templateSections) {
    templateByType.set(ts.section_type, ts);
  }

  // ── 7. Build meeting header ───────────────────────────────────────
  const meetingHeader: MinutesMeetingHeader = {
    town_name: town.name,
    board_name: board.name,
    board_type: board.board_type,
    meeting_date: meeting.scheduled_date,
    meeting_type: meeting.meeting_type,
    location: meeting.location,
    called_to_order_at: meeting.started_at,
    adjourned_at: meeting.ended_at,
  };

  // ── 8. Build attendance ───────────────────────────────────────────
  const attendanceByMember = new Map<string, AttendanceRow>();
  for (const a of attendance) {
    attendanceByMember.set(a.board_member_id, a);
  }

  const PRESENT_STATUSES = new Set(["present", "remote", "late_arrival"]);

  const membersPresent: MinutesAttendanceMember[] = [];
  const membersAbsent: MinutesAttendanceMember[] = [];
  let presidingOfficerName: string | null = null;
  let recordingSecretaryName: string | null = null;

  for (const bm of boardMembers) {
    const att = attendanceByMember.get(bm.id);
    const name = personName(bm.person_id) ?? "Unknown Member";
    const isPresidingOfficer = meeting.presiding_officer_id === bm.id;
    const isRecSec =
      att?.is_recording_secretary === true ||
      (meeting.recording_secretary_id === bm.id);

    const member: MinutesAttendanceMember = {
      name,
      seat_title: bm.seat_title,
      status: att?.status ?? "absent",
      arrived_at: att?.arrived_at ?? null,
      is_presiding_officer: isPresidingOfficer,
      is_recording_secretary: isRecSec,
    };

    if (isPresidingOfficer) presidingOfficerName = name;
    if (isRecSec) recordingSecretaryName = name;

    if (att && PRESENT_STATUSES.has(att.status)) {
      membersPresent.push(member);
    } else {
      // absent, excused, or not in attendance table at all
      membersAbsent.push(member);
    }
  }

  const memberCount = board.member_count ?? boardMembers.length;
  const requiredQuorum = calculateQuorum(
    memberCount,
    board.quorum_type as Parameters<typeof calculateQuorum>[1],
    board.quorum_value,
  );
  const quorumMet = membersPresent.length >= requiredQuorum;

  const minutesAttendance: MinutesAttendance = {
    members_present: membersPresent,
    members_absent: membersAbsent,
    staff_present: [], // Staff attendance not tracked in board meeting attendance
    presiding_officer: presidingOfficerName,
    presiding_officer_succession: null,
    recording_secretary: recordingSecretaryName,
    quorum: {
      met: quorumMet,
      present_count: membersPresent.length,
      required_count: requiredQuorum,
      total_members: memberCount,
    },
  };

  // ── 9. Build content sections ─────────────────────────────────────
  // Separate parent (section) items from child items
  const sectionItems = agendaItems.filter((ai) => ai.parent_item_id === null);
  const childItems = agendaItems.filter((ai) => ai.parent_item_id !== null);

  const childrenByParent = new Map<string, AgendaItemRow[]>();
  for (const child of childItems) {
    const list = childrenByParent.get(child.parent_item_id!) ?? [];
    list.push(child);
    childrenByParent.set(child.parent_item_id!, list);
  }

  const contentSections: MinutesContentSection[] = sectionItems.map(
    (section) => {
      const tmpl = templateByType.get(section.section_type);
      const isFixed = tmpl?.is_fixed ?? false;
      const minutesBehavior = tmpl?.minutes_behavior ?? "summarize";
      const children = childrenByParent.get(section.id) ?? [];

      // Build content items from child agenda items
      const items: MinutesContentItem[] = children.map((child) =>
        buildContentItem(child, tmpl, isFixed, minutesBehavior),
      );

      // Executive session data for this section
      const execSession = execSessionByItem.get(section.id);
      let executiveSession: MinutesExecutiveSession | null = null;
      if (execSession) {
        executiveSession = buildExecutiveSession(execSession);
      }

      // Check if section is marked as "none" — no children and section itself
      // has status "completed" with no motions or speakers
      const sectionMotions = motionsByItem.get(section.id) ?? [];
      const sectionSpeakers = speakersByItem.get(section.id) ?? [];
      const markedNone =
        items.length === 0 &&
        sectionMotions.length === 0 &&
        sectionSpeakers.length === 0 &&
        section.status === "completed";

      return {
        title: section.title,
        sort_order: section.sort_order,
        section_type: section.section_type,
        minutes_behavior: minutesBehavior,
        is_fixed: isFixed,
        items,
        executive_session: executiveSession,
        marked_none: markedNone,
      };
    },
  );

  // ── 10. Build adjournment ─────────────────────────────────────────
  const adjournment = buildAdjournment(meeting.adjournment);

  // ── 11. Build certification ───────────────────────────────────────
  const certFormat =
    (board.certification_format as MinutesCertification["format"]) ??
    "prepared_by";

  let recSecCert: MinutesCertification["recording_secretary"] = null;
  if (recordingSecretaryName) {
    // Find the board member record for seat title
    const recSecBm = boardMembers.find(
      (bm) =>
        meeting.recording_secretary_id === bm.id ||
        attendance.some(
          (a) => a.board_member_id === bm.id && a.is_recording_secretary,
        ),
    );
    recSecCert = {
      name: recordingSecretaryName,
      title: recSecBm?.seat_title ?? null,
    };
  }

  const certBoardMembers =
    certFormat === "prepared_by"
      ? []
      : boardMembers.map((bm) => ({
          name: personName(bm.person_id) ?? "Unknown",
          seat_title: bm.seat_title,
        }));

  const certification: MinutesCertification = {
    format: certFormat,
    recording_secretary: recSecCert,
    board_members: certBoardMembers,
  };

  // ── 12. Assemble final structure ──────────────────────────────────
  return {
    meeting_header: meetingHeader,
    attendance: minutesAttendance,
    sections: contentSections,
    adjournment,
    certification,
  };

  // ─── Nested builder functions ─────────────────────────────────────
  // Defined inside assembleMinutesJson so they capture the lookup maps
  // and related data via closure.

  function buildContentItem(
    item: AgendaItemRow,
    _tmpl: AgendaTemplateSection | undefined,
    parentIsFixed: boolean,
    parentMinutesBehavior: string,
  ): MinutesContentItem {
    const itemMotions = motionsByItem.get(item.id) ?? [];
    const itemSpeakers = speakersByItem.get(item.id) ?? [];
    const itemTransition = transitionByItem.get(item.id);

    // Build motions (exclude amendments — they attach to parent motions)
    const mainMotions = itemMotions.filter((m) => !m.parent_motion_id);
    const amendmentMotions = itemMotions.filter((m) => m.parent_motion_id);

    const minutesMotions: MinutesMotion[] = mainMotions.map((m) =>
      buildMotion(m, amendmentMotions),
    );

    // Build recusals from vote records
    const allItemVotes = itemMotions.flatMap(
      (m) => votesByMotion.get(m.id) ?? [],
    );
    const recusals: MinutesRecusal[] = allItemVotes
      .filter((v) => v.vote === "recusal")
      .map((v) => ({
        member: memberName(v.board_member_id) ?? "Unknown",
        reason: v.recusal_reason ?? "",
      }));

    // Build speakers
    const speakers: MinutesSpeaker[] = itemSpeakers.map((gs) => ({
      name: gs.name,
      address: gs.address ?? undefined,
      topic: gs.topic,
    }));

    return {
      title: item.title,
      section_ref: item.id,
      section_type: item.section_type,
      minutes_behavior: parentMinutesBehavior,
      is_fixed: parentIsFixed,
      discussion_summary: item.description,
      motions: minutesMotions,
      recusals,
      speakers,
      operator_notes: item.operator_notes,
      staff_resource: item.staff_resource,
      background: item.background,
      recommendation: item.recommendation,
      timestamp_start: itemTransition?.started_at ?? null,
      timestamp_end: itemTransition?.ended_at ?? null,
      status: item.status,
    };
  }

  function buildMotion(
    m: MotionRow,
    allAmendments: MotionRow[],
  ): MinutesMotion {
    const vote = buildVote(m.id);
    const amendments: MinutesAmendment[] = allAmendments
      .filter((a) => a.parent_motion_id === m.id)
      .map((a) => ({
        text: a.motion_text,
        moved_by: memberName(a.moved_by),
        seconded_by: memberName(a.seconded_by),
        status: a.status,
        vote: buildVote(a.id),
      }));

    return {
      text: m.motion_text,
      motion_type: m.motion_type,
      moved_by: memberName(m.moved_by),
      seconded_by: memberName(m.seconded_by),
      status: m.status,
      vote,
      amendments,
    };
  }

  function buildVote(motionId: string): MinutesVote | null {
    const votes = votesByMotion.get(motionId);
    if (!votes || votes.length === 0) return null;

    const yeas = votes.filter(
      (v) => v.vote === "yea" || v.vote === "yes",
    ).length;
    const nays = votes.filter(
      (v) => v.vote === "nay" || v.vote === "no",
    ).length;
    const abstentions = votes.filter((v) => v.vote === "abstain").length;
    const absentCount = votes.filter((v) => v.vote === "absent").length;

    // Determine result from the motion status
    const motion = motionById.get(motionId);
    const result = motion?.status ?? "unknown";

    const individualVotes = votes
      .filter((v) => v.vote !== "recusal")
      .map((v) => ({
        member: memberName(v.board_member_id) ?? "Unknown",
        vote: v.vote,
        reason: v.recusal_reason ?? undefined,
      }));

    return {
      type: yeas + nays + abstentions > 0 ? "roll_call" : "voice",
      result,
      yeas,
      nays,
      abstentions,
      absent: absentCount,
      individual_votes: individualVotes,
    };
  }

  function buildExecutiveSession(
    es: ExecSessionRow,
  ): MinutesExecutiveSession {
    // Parse post-session action motion IDs
    let postMotionIds: string[] = [];
    if (es.post_session_action_motion_ids) {
      try {
        const parsed =
          typeof es.post_session_action_motion_ids === "string"
            ? JSON.parse(es.post_session_action_motion_ids)
            : es.post_session_action_motion_ids;
        if (Array.isArray(parsed)) postMotionIds = parsed;
      } catch {
        // Malformed JSON — ignore gracefully
      }
    }

    const postSessionActions: MinutesMotion[] = postMotionIds
      .map((mid) => {
        const m = motionById.get(mid);
        if (!m) return null;
        return buildMotion(
          m,
          motions.filter((am) => am.parent_motion_id === mid),
        );
      })
      .filter((m): m is MinutesMotion => m !== null);

    return {
      statutory_basis: es.statutory_basis,
      entered_at: es.entered_at,
      exited_at: es.exited_at,
      post_session_actions: postSessionActions,
    };
  }

  function buildAdjournment(
    adjData: Record<string, unknown> | null,
  ): MinutesAdjournment | null {
    if (!adjData) return null;

    const method =
      (adjData.method as MinutesAdjournment["method"]) ?? "without_objection";
    const adjournedBy = adjData.adjourned_by
      ? memberName(adjData.adjourned_by as string)
      : null;
    const timestamp = (adjData.timestamp as string) ?? null;

    let adjMotion: MinutesMotion | null = null;
    if (adjData.motion_id) {
      const m = motionById.get(adjData.motion_id as string);
      if (m) {
        adjMotion = buildMotion(
          m,
          motions.filter((am) => am.parent_motion_id === m.id),
        );
      }
    }

    return {
      method,
      adjourned_by: adjournedBy,
      timestamp,
      motion: adjMotion,
    };
  }
}
