/**
 * `AgendaItemDetailPanel` — its two `trpc.agendaItem.pathFilter()` calls.
 *
 * Phase E wave 3, Tasks 3+4 fix round. `routes/meetings.$meetingId.tsx`'s
 * shell reads `trpc.agendaItem.countByMeeting`; this component writes
 * `agenda_item` rows (operator notes, and the item's `status`) raw via
 * Supabase and, before this round, invalidated only the abandoned
 * `queryKeys.agendaItems.*` keys.
 *
 * `saveNotesMutation` and `markCompleteMutation` each carry their own
 * `pathFilter()` line, so each gets its own test — deleting either is caught,
 * not just whichever one a single test happens to reach (conventions items 8
 * and 13).
 *
 * The child dialogs are mocked because they pull in `@dnd-kit`/Radix trees
 * this pin has nothing to do with; the component under test itself is real.
 */

import { describe, it, expect, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders, setupAppQueryClient } from "@/test/render";
import { trpc } from "@/lib/trpc";

vi.mock("@/hooks/useSupabase", () => ({
  useSupabase: () => ({
    from: () => {
      const chain = {
        update: () => chain,
        eq: () => Promise.resolve({ error: null }),
      };
      return chain;
    },
  }),
}));

vi.mock("../MotionCaptureDialog", () => ({
  MotionCaptureDialog: () => null,
}));

vi.mock("../RecusalDialog", () => ({
  RecusalDialog: () => null,
}));

import { AgendaItemDetailPanel } from "../AgendaItemDetailPanel";

const queryClient = setupAppQueryClient();

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
