/**
 * The topic → query-key mapping, checked against the SERVER'S list.
 *
 * Phase E, wave 5, Task 4. `LIVE_MEETING_TOPICS` lives in
 * `packages/api/src/realtime/events.ts` and the mapping that gives a topic
 * meaning lives in `hooks/useLiveMeetingEvents.ts`. The two have to be
 * extended in lockstep, and the failure when they are not is silent: the
 * client receives a topic, matches nothing, and drops the invalidation, so a
 * panel stops updating on other devices with no error anywhere.
 *
 * `useLiveMeetingEvents.ts`'s own `Record<LiveMeetingTopic, …>` already makes
 * a missing entry a TYPE error. This file is the second half, and it is not
 * redundant with the first:
 *
 *   - The type is derived from the PROCEDURE'S OUTPUT. This reads the ARRAY.
 *     If someone widened `LiveMeetingTopic` without adding to
 *     `LIVE_MEETING_TOPICS` (or the reverse), the type check would be happy
 *     with whichever half it can see and this one would not.
 *   - A type error is not a failing test, and the brief for this task asks for
 *     a failing test by name.
 *
 * Reading the API source as TEXT rather than importing it is deliberate.
 * `@town-meeting/api`'s `exports` map publishes TYPES only, and `events.ts`
 * imports `drizzle-orm` — importing it for real would pull server code into
 * the web package's module graph for the sake of one array. The same
 * read-the-source technique is what `packages/api/src/trpc/__tests__/
 * router-wiring.test.ts` uses for its publish inventory.
 */

import path from "node:path";
import fs from "node:fs";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createElement } from "react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import { TRPCClientError } from "@trpc/client";
import { trpc } from "@/lib/trpc";
import {
  LIVE_MEETING_TOPIC_ROUTERS,
  LIVE_STREAM_ERROR_TOAST_ID,
  liveMeetingPathFilter,
  useLiveMeetingEvents,
} from "@/hooks/useLiveMeetingEvents";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

/**
 * The options object `useSubscription` was handed — the same seam
 * `routes/meetings.$meetingId.live.test.tsx` uses, for the same reason: jsdom
 * has no live stream, and the thing under test is what the hook DOES with the
 * subscription's callbacks, not the transport. (Which link a subscription
 * takes is pinned separately, in `lib/__tests__/trpc.test.ts`.)
 */
const subscription: {
  options: { onData?: (e: unknown) => void; onError?: (e: unknown) => void } | null;
} = { options: null };

vi.mock("@trpc/tanstack-react-query", async () => {
  const actual = await vi.importActual<typeof import("@trpc/tanstack-react-query")>(
    "@trpc/tanstack-react-query",
  );
  return {
    ...actual,
    useSubscription: vi.fn((opts: { onData?: (e: unknown) => void }) => {
      subscription.options = opts;
      return { status: "pending", data: undefined, error: null, reset: () => {} };
    }),
  };
});

import { toast } from "sonner";

const PROJECT_ROOT = path.resolve(__dirname, "../../../../..");
const EVENTS_TS = path.join(PROJECT_ROOT, "packages/api/src/realtime/events.ts");

/**
 * The topics the SERVER can publish, parsed out of its own declaration.
 *
 * Anchored on `export const LIVE_MEETING_TOPICS = [` so a mention of the name
 * in a doc comment cannot be mistaken for the declaration — the
 * markers-versus-mentions hazard `phase-e-conventions.md` item 11 records, and
 * `events.ts` does mention the name in prose more than once.
 */
function serverTopics(): string[] {
  const source = fs.readFileSync(EVENTS_TS, "utf8");
  const start = source.indexOf("export const LIVE_MEETING_TOPICS = [");
  expect(
    start,
    "LIVE_MEETING_TOPICS is no longer declared as `export const LIVE_MEETING_TOPICS = [` in packages/api/src/realtime/events.ts — this parser needs updating before it can check anything",
  ).toBeGreaterThanOrEqual(0);
  const end = source.indexOf("]", start);
  expect(end).toBeGreaterThan(start);
  const body = source.slice(source.indexOf("[", start) + 1, end);
  return [...body.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]!);
}

describe("live meeting topic mapping", () => {
  it("parses a non-empty topic list off the server's own declaration", () => {
    // The control for every assertion below: a parser that silently matched
    // nothing would make the comparison vacuously true in one direction.
    expect(serverTopics().length).toBeGreaterThan(0);
  });

  it("maps every topic the server can publish — a new topic with no client mapping fails here", () => {
    expect([...serverTopics()].sort()).toEqual(Object.keys(LIVE_MEETING_TOPIC_ROUTERS).sort());
  });

  it("names a real router for every topic, and that router's own path filter", () => {
    for (const [topic, routers] of Object.entries(LIVE_MEETING_TOPIC_ROUTERS)) {
      expect(routers.length, `${topic} invalidates nothing`).toBeGreaterThan(0);
      for (const name of routers) {
        // `pathFilter()`'s key is the router prefix the real proxy produces,
        // so this fails if a name is ever mapped to a router that does not
        // exist or is renamed.
        expect(liveMeetingPathFilter(name).queryKey, `${topic} → ${name}`).toEqual([[name]]);
      }
    }
  });

  it("invalidates exactly the routers a topic names, and nothing else", () => {
    // `motion` is the useful probe: it is one-to-one with its table, so a
    // mapping that quietly reached further would show up as `voteRecord`
    // going stale too.
    const queryClient = new QueryClient();
    const motionKey = trpc.motion.byMeeting.queryOptions({ meetingId: "m1" }).queryKey;
    const voteKey = trpc.voteRecord.byMeeting.queryOptions({ meetingId: "m1" }).queryKey;
    queryClient.setQueryData(motionKey, []);
    queryClient.setQueryData(voteKey, []);

    for (const name of LIVE_MEETING_TOPIC_ROUTERS.motion) {
      void queryClient.invalidateQueries(liveMeetingPathFilter(name));
    }

    expect(queryClient.getQueryState(motionKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(voteKey)?.isInvalidated).toBeFalsy();
  });

  it("invalidates BOTH the agenda and the exhibit reads for one agenda_item event", () => {
    // The one topic that is not one-to-one. The Supabase channel it replaces
    // invalidated a single `select("*, exhibit(*)")` key, so an agenda_item
    // change refetched exhibits as a side effect; two procedures back that
    // one read now, and dropping the second would be a silent behaviour
    // change rather than a tidy-up.
    const queryClient = new QueryClient();
    const agendaKey = trpc.agendaItem.byMeeting.queryOptions({ meetingId: "m1" }).queryKey;
    const exhibitKey = trpc.exhibit.byMeeting.queryOptions({ meetingId: "m1" }).queryKey;
    queryClient.setQueryData(agendaKey, []);
    queryClient.setQueryData(exhibitKey, []);

    for (const name of LIVE_MEETING_TOPIC_ROUTERS.agenda_item) {
      void queryClient.invalidateQueries(liveMeetingPathFilter(name));
    }

    expect(queryClient.getQueryState(agendaKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(exhibitKey)?.isInvalidated).toBe(true);
  });
});

/**
 * The stream's own failure, which this hook used to drop on the floor.
 *
 * Added in Task 4's fix round. `realtime.onMeetingChange` refuses with a
 * `TRPCError` (NOT_FOUND for a meeting outside the caller's tenant, or
 * whatever the auth chain throws at subscribe), and the transport ADR's
 * addendum measured that a `TRPCError` makes this client STOP rather than
 * silently resume. The hook discarded `useSubscription`'s whole result, so
 * that ended a live meeting's updates permanently with nothing on screen —
 * and `ConnectionStatusBar`, still on a Supabase heartbeat until Task 6
 * replaces it, would have gone on reporting healthy.
 */
describe("a refusal on the stream", () => {
  beforeEach(() => {
    subscription.options = null;
    vi.mocked(toast.error).mockClear();
  });

  function renderTheHook() {
    const queryClient = new QueryClient();
    function wrapper({ children }: { children: ReactNode }) {
      return createElement(QueryClientProvider, { client: queryClient }, children);
    }
    return renderHook(() => useLiveMeetingEvents("meeting-1"), { wrapper });
  }

  it("raises a persistent toast — a dead stream is never silent", () => {
    renderTheHook();
    expect(subscription.options, "the hook no longer opens a subscription").not.toBeNull();
    expect(
      subscription.options!.onError,
      "the hook passes no onError — a refusal on the stream is silent again",
    ).toBeTypeOf("function");

    subscription.options!.onError!(
      new TRPCClientError("That meeting does not exist.", {
        result: { error: { code: -32004, message: "That meeting does not exist.", data: null } },
      } as never),
    );

    expect(toast.error).toHaveBeenCalledTimes(1);
    const [message, options] = vi.mocked(toast.error).mock.calls[0]!;
    expect(message).toContain("Live updates have stopped");
    // Infinity, not a timeout: the stream does not come back on its own, so a
    // message that disappears after four seconds is one an operator who was
    // looking at the agenda cannot go back and read.
    expect((options as { duration?: number }).duration).toBe(Infinity);
    // A stable id, so a refusing reconnect loop replaces one toast rather
    // than stacking a column of them over the operator's controls.
    expect((options as { id?: string }).id).toBe(LIVE_STREAM_ERROR_TOAST_ID);
    // The server's own sentence is carried through — "That meeting does not
    // exist." tells a clerk something "something went wrong" does not.
    expect((options as { description?: string }).description).toContain(
      "That meeting does not exist.",
    );
  });

  it("still says what is broken when the error is not a tRPC one", () => {
    renderTheHook();
    subscription.options!.onError!(new Error("boom"));

    const [, options] = vi.mocked(toast.error).mock.calls[0]!;
    expect((options as { description?: string }).description).toContain(
      "will not appear here until you reload",
    );
  });
});
