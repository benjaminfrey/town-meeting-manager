/**
 * `PublishAgendaDialog` — the A5 hole, closed.
 *
 * Phase E wave 3 Task 2's fix round created this file to pin one
 * `trpc.meeting.pathFilter()` line beside a write that was still raw
 * Supabase. Wave 4, Task 3 replaced that write with `meeting.publishAgenda`
 * (A5, board-scoped), so the file is rewritten: the Supabase chainable mock
 * is gone, the real proxy runs against a stubbed transport, and the tests now
 * assert what the dialog SENDS — including the `boardId` the guard authorizes
 * on, which is a new prop and the whole reason this component needed one.
 *
 * The refusal test is the load-bearing one. Before this task any signed-in
 * member of the town could publish any board's agenda (`meeting` RLS is
 * tenancy-only and nothing else checked), so FORBIDDEN is newly reachable on
 * this exact button — the shape wave 3 shipped twice as a silent no-op.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders, setupAppQueryClient } from "@/test/render";
import { installTRPCFetchStub, trpcTestError } from "@/test/trpc";
import { trpc } from "@/lib/trpc";

import { PublishAgendaDialog } from "../PublishAgendaDialog";
import type { AgendaItem, SectionWithChildren } from "../agenda-types";

const queryClient = setupAppQueryClient();

const server = { refuses: false };

const stub = installTRPCFetchStub({
  "meeting.publishAgenda": ({ meetingId }) => {
    if (server.refuses) trpcTestError("FORBIDDEN");
    return { id: meetingId, agenda_status: "published" as const };
  },
});

function item(overrides: Partial<AgendaItem> & { id: string }): AgendaItem {
  return {
    section_type: "new_business",
    sort_order: 0,
    title: "Item one",
    description: null,
    presenter: null,
    estimated_duration: null,
    parent_item_id: "s1",
    staff_resource: null,
    background: null,
    recommendation: null,
    suggested_motion: "to approve",
    ...overrides,
  };
}

const sections: SectionWithChildren[] = [
  {
    ...item({ id: "s1", title: "New Business", parent_item_id: null }),
    children: [item({ id: "i1" })],
  },
];

function renderDialog() {
  return renderWithProviders(
    <PublishAgendaDialog
      meetingId="m1"
      boardId="b1"
      sections={sections}
      open
      onOpenChange={() => {}}
    />,
    { queryClient },
  );
}

describe("PublishAgendaDialog", () => {
  beforeEach(() => {
    server.refuses = false;
  });

  it("publishes through meeting.publishAgenda, authorizing on the meeting's board", async () => {
    const { user } = renderDialog();

    await user.click(screen.getByRole("button", { name: "Publish" }));

    await waitFor(() => expect(stub.countFor("meeting.publishAgenda")).toBe(1));
    // No `agendaStatus` input: `'published'` is the only transition the
    // procedure performs, deliberately, so a caller cannot move a published
    // agenda back to draft through a guard named "publish".
    expect(stub.calls.at(-1)?.inputs).toEqual({ 0: { meetingId: "m1", boardId: "b1" } });
  });

  it("invalidates trpc.meeting.pathFilter() — the key boards.$boardId.meetings.tsx reads under", async () => {
    const byBoardKey = trpc.meeting.byBoard.queryOptions({ boardId: "b1" }).queryKey;
    queryClient.setQueryData(byBoardKey, []);
    expect(queryClient.getQueryState(byBoardKey)?.isInvalidated).toBeFalsy();

    const { user } = renderDialog();

    await user.click(screen.getByRole("button", { name: "Publish" }));

    await waitFor(() => expect(queryClient.getQueryState(byBoardKey)?.isInvalidated).toBe(true));
  });

  it("shows the refusal when A5 is missing, rather than closing as if it worked", async () => {
    server.refuses = true;
    const { user } = renderDialog();

    await user.click(screen.getByRole("button", { name: "Publish" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "You don't have permission to publish this agenda.",
    );
  });
});
