import type {
  PortalTownInfo,
  PortalMeetingSummary,
  PortalMeetingDetail,
  PortalAgenda,
  PortalMinutes,
  PortalBoardSummary,
  PortalBoardDetail,
  PortalCalendarEvent,
} from "@town-meeting/shared";

const BASE = "/api/portal";

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new PortalApiError(res.status, res.statusText);
  }
  return res.json();
}

export class PortalApiError extends Error {
  constructor(
    public status: number,
    public statusText: string,
  ) {
    super(`Portal API error: ${status} ${statusText}`);
    this.name = "PortalApiError";
  }
}

export async function resolveSubdomain(
  subdomain: string,
): Promise<PortalTownInfo> {
  return fetchJson(`${BASE}/resolve?subdomain=${encodeURIComponent(subdomain)}`);
}

export async function fetchMeetings(
  townId: string,
  params?: { board?: string; page?: number },
): Promise<{ meetings: PortalMeetingSummary[]; total: number; page: number }> {
  const qs = new URLSearchParams();
  if (params?.board) qs.set("board", params.board);
  if (params?.page) qs.set("page", String(params.page));
  const query = qs.toString() ? `?${qs.toString()}` : "";
  return fetchJson(`${BASE}/${townId}/meetings${query}`);
}

export async function fetchMeetingDetail(
  townId: string,
  meetingId: string,
): Promise<PortalMeetingDetail> {
  return fetchJson(`${BASE}/${townId}/meetings/${meetingId}`);
}

export async function fetchAgenda(
  townId: string,
  meetingId: string,
): Promise<PortalAgenda> {
  return fetchJson(`${BASE}/${townId}/meetings/${meetingId}/agenda`);
}

export async function fetchMinutes(
  townId: string,
  meetingId: string,
): Promise<PortalMinutes> {
  return fetchJson(`${BASE}/${townId}/meetings/${meetingId}/minutes`);
}

export async function fetchBoards(
  townId: string,
): Promise<PortalBoardSummary[]> {
  return fetchJson(`${BASE}/${townId}/boards`);
}

export async function fetchBoardDetail(
  townId: string,
  boardId: string,
): Promise<PortalBoardDetail> {
  return fetchJson(`${BASE}/${townId}/boards/${boardId}`);
}

export async function fetchCalendarEvents(
  townId: string,
  start: string,
  end: string,
): Promise<PortalCalendarEvent[]> {
  return fetchJson(`${BASE}/${townId}/calendar?start=${start}&end=${end}`);
}

export function getMinutesPdfUrl(
  townId: string,
  meetingId: string,
): string {
  return `${BASE}/${townId}/meetings/${meetingId}/minutes/pdf`;
}

export function getAgendaPdfUrl(
  townId: string,
  meetingId: string,
): string {
  return `${BASE}/${townId}/meetings/${meetingId}/agenda/pdf`;
}
