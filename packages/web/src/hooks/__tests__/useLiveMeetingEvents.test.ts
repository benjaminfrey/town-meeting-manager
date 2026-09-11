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
import { describe, it, expect } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { trpc } from "@/lib/trpc";
import { LIVE_MEETING_TOPIC_ROUTERS, liveMeetingPathFilter } from "@/hooks/useLiveMeetingEvents";

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
