/**
 * `ProgressChecklist`'s `memberCount` read — wave 2, Task 2.
 *
 * Closes the `TODO(phase-e-wave-2)` marker naming `boardMember.countByTown`:
 * Task 1 of this wave shipped `board.memberCount` to answer it (it lives on
 * `board.ts`, not a new `boardMember` router — see that procedure's own doc
 * comment). This is the first test this component has had; its other two
 * reads (`board.list`, for `totalSeats`/notice-template counts) already moved
 * onto tRPC in wave 1 with no test of their own, so this file covers all of
 * this component's data now rather than just the one read this task touched.
 *
 * Real options proxy, real `QueryClient`; only `globalThis.fetch` replaced —
 * see `boards.$boardId.test.tsx` for why that distinction matters.
 */

import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders, setupAppQueryClient } from "@/test/render";
import { installTRPCFetchStub } from "@/test/trpc";
import { ProgressChecklist } from "../ProgressChecklist";

const queryClient = setupAppQueryClient();

/** Mutable so a test can change what the server returns between renders. */
const server = { memberCount: 0 };

installTRPCFetchStub({
  "board.list": () => [
    {
      id: "b1",
      name: "Select Board",
      notice_template_blocks: null,
      member_count: 5,
      elected_or_appointed: "elected",
      archived_at: null,
      is_governing_board: true,
      active_member_count: 3,
    },
  ],
  "board.memberCount": () => server.memberCount,
});

function renderChecklist() {
  return renderWithProviders(
    <ProgressChecklist
      sealUrl={null}
      subdomain={null}
      retentionAcknowledgedAt={null}
      minutesWorkflowConfiguredAt={null}
      onRetentionPolicyClick={() => {}}
      onSetPortalAddressClick={() => {}}
    />,
    { queryClient },
  );
}

describe("ProgressChecklist", () => {
  it("shows the unfilled-seats state before board.memberCount settles above zero", async () => {
    server.memberCount = 0;
    renderChecklist();
    expect(await screen.findByText("Add board members (0 of 5 seats)")).toBeInTheDocument();
  });

  it("shows board.memberCount's value once seats are filled", async () => {
    server.memberCount = 3;
    renderChecklist();
    expect(await screen.findByText("Board members added (3 of 5)")).toBeInTheDocument();
  });
});
