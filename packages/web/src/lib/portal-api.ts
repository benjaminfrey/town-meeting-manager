import type {
  PortalTownInfo,
  PortalMeetingSummary,
  PortalMeetingDetail,
  PortalAgenda,
  PortalMinutes,
  PortalBoardSummary,
  PortalBoardDetail,
  PortalCalendarEvent,
  PortalSearchResponse,
} from "@town-meeting/shared";
import { detectPortalSubdomain } from "./portal";

const BASE = "/api/portal";

/**
 * Stage 1, Task D1b — why every request from here carries the subdomain.
 *
 * The API no longer takes the portal's town from the `:townId` in the URL. It
 * resolves `X-Town-Subdomain` into a tenant context, runs every query inside
 * it under row level security, and refuses a request whose `:townId` names a
 * different town (see `packages/api/src/auth/portal-tenant.ts`).
 *
 * In production nginx sets that header itself, from the hostname the request
 * arrived on, and `proxy_set_header` REPLACES whatever a client sent — so on a
 * real portal host this value is nginx's, not ours, and a page served from one
 * town's portal cannot ask for another's. Sending it here is what makes the
 * same code work in development, where the portal is reached as
 * `localhost:5173/?portal=<subdomain>` and there is no proxy to set it.
 */
function portalHeaders(): HeadersInit {
  const subdomain = detectPortalSubdomain(window.location.hostname);
  return subdomain ? { "X-Town-Subdomain": subdomain } : {};
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: portalHeaders() });
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

/**
 * Which town is this portal?
 *
 * The `subdomain` argument is no longer sent as a query parameter — the API
 * reads it from `X-Town-Subdomain`, which `portalHeaders()` sets from the same
 * hostname and which nginx overwrites in production. It is kept in the
 * signature because `PortalProvider` has it and passing it makes the call
 * site's intent legible; a caller that could pass a DIFFERENT subdomain here
 * and get that town back is precisely what this change removed.
 */
export async function resolveSubdomain(_subdomain: string): Promise<PortalTownInfo> {
  return fetchJson(`${BASE}/resolve`);
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

export async function fetchAgenda(townId: string, meetingId: string): Promise<PortalAgenda> {
  return fetchJson(`${BASE}/${townId}/meetings/${meetingId}/agenda`);
}

export async function fetchMinutes(townId: string, meetingId: string): Promise<PortalMinutes> {
  return fetchJson(`${BASE}/${townId}/meetings/${meetingId}/minutes`);
}

export async function fetchBoards(townId: string): Promise<PortalBoardSummary[]> {
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

export function getMinutesPdfUrl(townId: string, meetingId: string): string {
  return `${BASE}/${townId}/meetings/${meetingId}/minutes/pdf`;
}

export function getAgendaPdfUrl(townId: string, meetingId: string): string {
  return `${BASE}/${townId}/meetings/${meetingId}/agenda/pdf`;
}

export async function searchPortal(
  townId: string,
  params: { q: string; type?: string; board?: string; from?: string; to?: string; page?: number },
): Promise<PortalSearchResponse> {
  const qs = new URLSearchParams();
  qs.set("q", params.q);
  if (params.type && params.type !== "all") qs.set("type", params.type);
  if (params.board) qs.set("board", params.board);
  if (params.from) qs.set("from", params.from);
  if (params.to) qs.set("to", params.to);
  if (params.page && params.page > 1) qs.set("page", String(params.page));
  return fetchJson(`${BASE}/${townId}/search?${qs.toString()}`);
}
