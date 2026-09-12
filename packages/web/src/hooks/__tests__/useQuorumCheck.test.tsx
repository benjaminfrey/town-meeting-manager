/**
 * `useQuorumCheck` — its three tRPC reads and the arithmetic over them, plus
 * the pure quorum functions from `@town-meeting/shared`.
 *
 * Phase E wave 5, Task 4. Replaces `src/hooks/useQuorumCheck.test.ts`, deleted
 * in the same commit: that file mocked `@tanstack/react-query`'s `useQuery`
 * wholesale and routed on `queryKey[0]` ("boards", "members", "attendance"),
 * which is conventions item 8's central anti-pattern — the keys it exercised
 * were invented by the test, so it could not have noticed the hook reading a
 * different procedure, a different column, or no procedure at all. It also
 * mocked `@/lib/supabase`, which this hook no longer imports.
 *
 * Rewritten, not adapted (item 13). `@/lib/trpc` is left alone and
 * `globalThis.fetch` is stubbed, so the payloads are checked against the real
 * procedures and the query keys are the app's own.
 *
 * The pure-function suites at the bottom are carried over verbatim from the
 * deleted file — they never depended on the transport and nothing about this
 * migration touches them.
 */

import { describe, it, expect } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { calculateQuorum, hasQuorum, quorumAfterRecusal } from "@town-meeting/shared";
import { setupAppQueryClient } from "@/test/render";
import { installTRPCFetchStub } from "@/test/trpc";
import type { RouterOutputs } from "@/lib/trpc";
import { useQuorumCheck } from "@/hooks/useQuorumCheck";

const queryClient = setupAppQueryClient();

const baseBoard = {
  id: "b1",
  name: "Planning Board",
  board_type: "appointed",
  elected_or_appointed: "appointed",
  member_count: 5,
  election_method: null,
  officer_election_method: null,
  is_governing_board: false,
  meeting_formality_override: null,
  minutes_style_override: null,
  quorum_type: "simple_majority" as string | null,
  quorum_value: null as number | null,
  motion_display_format: "inline_narrative",
  archived_at: null,
  created_at: "2026-01-01T00:00:00Z",
  notice_template_blocks: null,
  minutes_consent_agenda: false,
  minutes_requires_second: true,
  r4_board_member_default: false,
  audio_retention_policy_override: null,
  auto_publish_on_approval_override: null,
};

function attendance(statuses: string[]): RouterOutputs["meetingAttendance"]["byMeeting"] {
  return statuses.map((status, i) => ({
    id: `att-${i + 1}`,
    board_member_id: `bm-${i + 1}`,
    person_id: `p-${i + 1}`,
    status,
    is_recording_secretary: false,
    arrived_at: null,
    departed_at: null,
  }));
}

const server = {
  board: baseBoard,
  activeSeats: 5,
  attendance: [] as RouterOutputs["meetingAttendance"]["byMeeting"],
};

installTRPCFetchStub({
  "board.detail": () => server.board,
  "boardMember.activeCountForBoard": () => server.activeSeats,
  "meetingAttendance.byMeeting": () => server.attendance,
});

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe("useQuorumCheck", () => {
  it("returns null while the board read is still in flight", () => {
    server.board = baseBoard;
    server.activeSeats = 5;
    server.attendance = [];

    const { result } = renderHook(() => useQuorumCheck("m1", "b1"), { wrapper });

    // Synchronously, before any fetch has resolved.
    expect(result.current.quorum).toBeNull();
    expect(result.current.isLoading).toBe(true);
  });

  it("calculates quorum for simple majority with all present", async () => {
    server.board = baseBoard;
    server.activeSeats = 5;
    server.attendance = attendance(["present", "present", "present", "present", "present"]);

    const { result } = renderHook(() => useQuorumCheck("m1", "b1"), { wrapper });

    await waitFor(() => expect(result.current.quorum).not.toBeNull());
    expect(result.current.quorum).toEqual({
      required: 3, // floor(5/2)+1
      present: 5,
      total: 5,
      hasQuorum: true,
    });
  });

  it("detects loss of quorum when too few present", async () => {
    server.board = baseBoard;
    server.activeSeats = 5;
    server.attendance = attendance(["present", "present", "absent", "absent", "absent"]);

    const { result } = renderHook(() => useQuorumCheck("m1", "b1"), { wrapper });

    await waitFor(() => expect(result.current.quorum).not.toBeNull());
    expect(result.current.quorum?.required).toBe(3);
    expect(result.current.quorum?.present).toBe(2);
    expect(result.current.quorum?.hasQuorum).toBe(false);
  });

  it("counts present, remote and late_arrival as present, and nothing else", async () => {
    server.board = baseBoard;
    server.activeSeats = 5;
    server.attendance = attendance(["present", "remote", "late_arrival", "absent", "excused"]);

    const { result } = renderHook(() => useQuorumCheck("m1", "b1"), { wrapper });

    await waitFor(() => expect(result.current.quorum).not.toBeNull());
    expect(result.current.quorum?.present).toBe(3);
    expect(result.current.quorum?.hasQuorum).toBe(true);
  });

  it("handles the fixed_number quorum type", async () => {
    server.board = { ...baseBoard, quorum_type: "fixed_number", quorum_value: 4 };
    server.activeSeats = 7;
    server.attendance = attendance([
      "present",
      "present",
      "present",
      "present",
      "absent",
      "absent",
      "absent",
    ]);

    const { result } = renderHook(() => useQuorumCheck("m1", "b1"), { wrapper });

    await waitFor(() => expect(result.current.quorum).not.toBeNull());
    expect(result.current.quorum?.required).toBe(4);
    expect(result.current.quorum?.present).toBe(4);
    expect(result.current.quorum?.hasQuorum).toBe(true);
  });

  it("takes `total` from the seat COUNT, not from the attendance rows", async () => {
    // The read this replaces selected active `board_member` rows and used
    // `.length`; `boardMember.activeCountForBoard` counts the same two filters
    // server-side. A migration that wired `total` to the attendance list
    // instead would answer 2 here — and no test in the deleted file could have
    // told the difference, because its mock returned both off the same
    // hand-built key.
    server.board = baseBoard;
    server.activeSeats = 7;
    server.attendance = attendance(["present", "present"]);

    const { result } = renderHook(() => useQuorumCheck("m1", "b1"), { wrapper });

    await waitFor(() => expect(result.current.quorum).not.toBeNull());
    expect(result.current.quorum?.total).toBe(7);
    expect(result.current.quorum?.present).toBe(2);
    expect(result.current.quorum?.hasQuorum).toBe(false);
  });
});

// ─── Carried over from the deleted file, unchanged ───────────────────

describe("calculateQuorum", () => {
  it("returns simple majority for standard boards", () => {
    expect(calculateQuorum(5)).toBe(3); // floor(5/2)+1
    expect(calculateQuorum(7)).toBe(4); // floor(7/2)+1
    expect(calculateQuorum(3)).toBe(2); // floor(3/2)+1
    expect(calculateQuorum(1)).toBe(1); // floor(1/2)+1
  });

  it("returns two-thirds majority correctly", () => {
    expect(calculateQuorum(5, "two_thirds")).toBe(4); // ceil(10/3)
    expect(calculateQuorum(6, "two_thirds")).toBe(4); // ceil(12/3)
    expect(calculateQuorum(9, "two_thirds")).toBe(6); // ceil(18/3)
  });

  it("returns three-quarters majority correctly", () => {
    expect(calculateQuorum(4, "three_quarters")).toBe(3); // ceil(12/4)
    expect(calculateQuorum(8, "three_quarters")).toBe(6); // ceil(24/4)
  });

  it("returns fixed number capped at member count", () => {
    expect(calculateQuorum(5, "fixed_number", 3)).toBe(3);
    expect(calculateQuorum(5, "fixed_number", 10)).toBe(5); // capped
  });

  it("returns 0 for zero or negative member count", () => {
    expect(calculateQuorum(0)).toBe(0);
    expect(calculateQuorum(-1)).toBe(0);
  });
});

describe("hasQuorum", () => {
  it("returns true when present meets requirement", () => {
    expect(hasQuorum(3, 5)).toBe(true); // 3 >= 3
    expect(hasQuorum(5, 5)).toBe(true); // 5 >= 3
  });

  it("returns false when present below requirement", () => {
    expect(hasQuorum(2, 5)).toBe(false); // 2 < 3
    expect(hasQuorum(0, 5)).toBe(false);
  });
});

describe("quorumAfterRecusal", () => {
  it("adjusts quorum when members recuse", () => {
    // 5 members, 4 present, 1 recused
    const result = quorumAfterRecusal(4, 1, 5);

    expect(result.adjustedMemberCount).toBe(4); // 5 - 1
    expect(result.adjustedQuorum).toBe(3); // floor(4/2)+1
    expect(result.eligibleVoters).toBe(3); // 4 present - 1 recused
    expect(result.hasQuorum).toBe(true); // 3 >= 3
  });

  it("detects quorum loss after multiple recusals", () => {
    // 5 members, 3 present, 2 recused → only 1 eligible voter
    const result = quorumAfterRecusal(3, 2, 5);

    expect(result.adjustedMemberCount).toBe(3); // 5 - 2
    expect(result.adjustedQuorum).toBe(2); // floor(3/2)+1
    expect(result.eligibleVoters).toBe(1); // 3 - 2
    expect(result.hasQuorum).toBe(false); // 1 < 2
  });
});
