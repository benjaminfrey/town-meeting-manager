/**
 * `GuestSpeakerEntry` — its two `trpc.guestSpeaker.pathFilter()` calls, and its
 * two refusals.
 *
 * Phase E wave 5, Task 5. Both writes are tRPC now (`guestSpeaker.insert`,
 * `guestSpeaker.delete`), and both were authorized by nothing before: M7
 * (`manage_speaker_queue`) had no rule anywhere in this codebase until this
 * wave's Task 2, and `guest_speaker_tenant_isolation` is tenancy-only.
 *
 * One test per call site, for the invalidation AND for the refusal: the
 * per-test-FILE credit `pathfilter-pin-coverage.test.ts` gives would let the
 * second ride in free on the first (item 8's demonstrated limit), and the two
 * refusals render at two different places with two different messages, because
 * a clerk refused on a delete should not read "couldn't add a speaker".
 */

import { describe, it, expect, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders, setupAppQueryClient } from "@/test/render";
import { installTRPCFetchStub, trpcTestError } from "@/test/trpc";
import { trpc } from "@/lib/trpc";
import { GuestSpeakerEntry } from "../GuestSpeakerEntry";

const queryClient = setupAppQueryClient();

const server = { insertRefuses: false, deleteRefuses: false };

installTRPCFetchStub({
  "guestSpeaker.insert": () => {
    if (server.insertRefuses) trpcTestError("FORBIDDEN");
    return { id: "gs-new" };
  },
  "guestSpeaker.delete": ({ speakerId }) => {
    if (server.deleteRefuses) trpcTestError("FORBIDDEN");
    return { id: speakerId };
  },
});

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
    <GuestSpeakerEntry
      meetingId="m1"
      agendaItemId="item-1"
      boardId="board-1"
      speakers={[speaker]}
    />,
    { queryClient },
  );
}

async function addSpeaker(user: ReturnType<typeof renderEntry>["user"]) {
  await user.click(screen.getByRole("button", { name: /add speaker/i }));
  await user.type(screen.getByPlaceholderText("Name (required)"), "Sam Public");
  await user.click(screen.getByRole("button", { name: /^add$/i }));
}

describe("GuestSpeakerEntry", () => {
  beforeEach(() => {
    server.insertRefuses = false;
    server.deleteRefuses = false;
  });

  it("invalidates trpc.guestSpeaker.pathFilter() when a speaker is added", async () => {
    const key = seedSpeakerRead();
    const { user } = renderEntry();

    await addSpeaker(user);

    await waitFor(() => expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true));
  });

  it("invalidates trpc.guestSpeaker.pathFilter() when a speaker is removed — the OTHER call site", async () => {
    const key = seedSpeakerRead();
    const { user } = renderEntry();

    await user.click(screen.getByTitle("Remove speaker"));

    await waitFor(() => expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true));
  });

  it("shows a refusal beside the form when adding a speaker is FORBIDDEN", async () => {
    server.insertRefuses = true;
    const { user } = renderEntry();

    await addSpeaker(user);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/permission to add a speaker to the queue/i);
  });

  it("shows a refusal when removing a speaker is FORBIDDEN — the OTHER write", async () => {
    server.deleteRefuses = true;
    const { user } = renderEntry();

    await user.click(screen.getByTitle("Remove speaker"));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/permission to remove a speaker from the queue/i);
  });
});
