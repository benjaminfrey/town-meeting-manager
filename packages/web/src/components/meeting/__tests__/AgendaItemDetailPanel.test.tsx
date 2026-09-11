/**
 * `AgendaItemDetailPanel` — its two `agenda_item` writes and the two
 * `trpc.agendaItem.pathFilter()` calls that follow them.
 *
 * Phase E wave 5, Task 4. Both writes moved from the dead Supabase client onto
 * `agendaItem.setOperatorNotes` / `agendaItem.markComplete`, so this file moved
 * with them: `@/lib/trpc` is left alone and `globalThis.fetch` is stubbed
 * instead (conventions item 8), which is what makes the refusal tests below
 * expressible at all — the Supabase mock this file used to carry could return
 * `{ error: null }` and nothing else.
 *
 * Four tests, two per write:
 *
 *   - the `pathFilter()` pin, one per call site, because each mutation carries
 *     its own line and deleting either must be caught rather than only
 *     whichever one a single test happens to reach (items 8 and 13);
 *   - the FORBIDDEN refusal, one per write. Both were completely unauthorized
 *     before this task (`agenda_item_tenant_isolation` is tenancy-only), so
 *     FORBIDDEN is a code path this UI never had to render, and item 13's rule
 *     is that every newly-guarded mutation surfaces its error. Asserted on
 *     `role="alert"`, not on the string.
 *
 * The child dialogs are mocked because they pull in `@dnd-kit`/Radix trees this
 * has nothing to do with; the component under test itself is real.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders, setupAppQueryClient } from "@/test/render";
import { installTRPCFetchStub, trpcTestError } from "@/test/trpc";
import { trpc } from "@/lib/trpc";

vi.mock("../MotionCaptureDialog", () => ({
  MotionCaptureDialog: () => null,
}));

vi.mock("../RecusalDialog", () => ({
  RecusalDialog: () => null,
}));

import { AgendaItemDetailPanel } from "../AgendaItemDetailPanel";

const queryClient = setupAppQueryClient();

/** Mutable so a test can make one write refuse without touching the other. */
const server = { notesRefuses: false, completeRefuses: false };

installTRPCFetchStub({
  "agendaItem.setOperatorNotes": ({ itemId }) => {
    if (server.notesRefuses) trpcTestError("FORBIDDEN");
    return { id: itemId };
  },
  "agendaItem.markComplete": ({ itemId }) => {
    if (server.completeRefuses) trpcTestError("FORBIDDEN");
    return { id: itemId };
  },
});

const item = {
  id: "item-1",
  title: "Site Plan Review",
  sectionTitle: "New Business",
  sectionType: "new_business",
  sectionRef: "3",
  description: null,
  presenter: null,
  staffResource: null,
  background: null,
  recommendation: null,
  suggestedMotion: null,
  operatorNotes: null,
  estimatedDuration: null,
  status: "in_progress",
  exhibits: [],
  subItems: [],
  speakers: [],
  motions: [],
};

function renderPanel() {
  return renderWithProviders(
    <AgendaItemDetailPanel
      item={item}
      meetingId="m1"
      boardId="b1"
      townId="town-1"
      allMembers={[]}
      presentMembers={[]}
      memberNameMap={new Map()}
      attendanceRecords={[]}
      votesByMotion={new Map()}
      motionDisplayFormat="inline_narrative"
      boardQuorumConfig={{ quorumType: "simple_majority", quorumValue: null, memberCount: 3 }}
      onNavigatePrev={() => {}}
      onNavigateNext={() => {}}
      hasPrev={false}
      hasNext={false}
    />,
    { queryClient },
  );
}

function seedShellCount() {
  const countKey = trpc.agendaItem.countByMeeting.queryOptions({ meetingId: "m1" }).queryKey;
  queryClient.setQueryData(countKey, 5);
  expect(queryClient.getQueryState(countKey)?.isInvalidated).toBeFalsy();
  return countKey;
}

describe("AgendaItemDetailPanel cache invalidation", () => {
  beforeEach(() => {
    server.notesRefuses = false;
    server.completeRefuses = false;
  });

  it("invalidates trpc.agendaItem.pathFilter() when operator notes are saved", async () => {
    const countKey = seedShellCount();
    const { user } = renderPanel();

    const notes = screen.getByPlaceholderText("Notes for this item...");
    await user.click(notes);
    await user.type(notes, "Applicant present");
    await user.tab(); // blur → saveNotes()

    await waitFor(() => expect(queryClient.getQueryState(countKey)?.isInvalidated).toBe(true));
  });

  it("invalidates trpc.agendaItem.pathFilter() when the item is marked complete — the OTHER call site", async () => {
    const countKey = seedShellCount();
    const { user } = renderPanel();

    await user.click(screen.getByRole("button", { name: /complete/i }));

    await waitFor(() => expect(queryClient.getQueryState(countKey)?.isInvalidated).toBe(true));
  });
});

describe("AgendaItemDetailPanel refusals", () => {
  beforeEach(() => {
    server.notesRefuses = false;
    server.completeRefuses = false;
  });

  it("shows a refusal when saving operator notes is FORBIDDEN", async () => {
    server.notesRefuses = true;
    const { user } = renderPanel();

    const notes = screen.getByPlaceholderText("Notes for this item...");
    await user.click(notes);
    await user.type(notes, "Applicant present");
    await user.tab();

    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("shows a refusal when marking the item complete is FORBIDDEN", async () => {
    server.completeRefuses = true;
    const { user } = renderPanel();

    await user.click(screen.getByRole("button", { name: /complete/i }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});
