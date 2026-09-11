/**
 * `GuestSpeakerEntry` — its two `trpc.guestSpeaker.pathFilter()` calls.
 *
 * Phase E wave 5, Task 4. This component's writes are still raw Supabase
 * (Task 5 owns them), but the READ they feed moved: the live meeting now takes
 * its speaker list from `trpc.guestSpeaker.byMeeting`, so the two legacy
 * `queryKeys.guestSpeakers.*` invalidations this file already carried stopped
 * reaching anything. Conventions item 7's completion gate — "the commit that
 * moves a read to tRPC also updates every writer that was invalidating the key
 * it abandoned, in that same commit" — plus item 8's "write the pin the same
 * commit a writer's `pathFilter()` call lands."
 *
 * One test per call site: the insert and the delete each carry their own line,
 * and the per-test-FILE credit `pathfilter-pin-coverage.test.ts` gives would
 * let the second ride in free on the first (item 8's demonstrated limit).
 */

import { describe, it, expect, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders, setupAppQueryClient } from "@/test/render";
import { trpc } from "@/lib/trpc";

vi.mock("@/hooks/useSupabase", () => ({
  useSupabase: () => ({
    from: () => {
      const chain = {
        insert: () => Promise.resolve({ error: null }),
        delete: () => chain,
        eq: () => Promise.resolve({ error: null }),
      };
      return chain;
    },
  }),
}));

import { GuestSpeakerEntry } from "../GuestSpeakerEntry";

const queryClient = setupAppQueryClient();

const speaker = {
  id: "gs-1",
  agenda_item_id: "item-1",
  name: "Jane Resident",
  address: "12 Elm St",
  topic: "Zoning",
  created_at: "2026-03-10T18:10:00Z",
};

function seedSpeakerRead() {
  const key = trpc.guestSpeaker.byMeeting.queryOptions({ meetingId: "m1" }).queryKey;
  queryClient.setQueryData(key, [speaker]);
  expect(queryClient.getQueryState(key)?.isInvalidated).toBeFalsy();
  return key;
}

function renderEntry() {
  return renderWithProviders(
    <GuestSpeakerEntry meetingId="m1" agendaItemId="item-1" townId="town-1" speakers={[speaker]} />,
    { queryClient },
  );
}

describe("GuestSpeakerEntry cache invalidation", () => {
  it("invalidates trpc.guestSpeaker.pathFilter() when a speaker is added", async () => {
    const key = seedSpeakerRead();
    const { user } = renderEntry();

    await user.click(screen.getByRole("button", { name: /add speaker/i }));
    await user.type(screen.getByPlaceholderText("Name (required)"), "Sam Public");
    await user.click(screen.getByRole("button", { name: /^add$/i }));

    await waitFor(() => expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true));
  });

  it("invalidates trpc.guestSpeaker.pathFilter() when a speaker is removed — the OTHER call site", async () => {
    const key = seedSpeakerRead();
    const { user } = renderEntry();

    await user.click(screen.getByTitle("Remove speaker"));

    await waitFor(() => expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true));
  });
});
