/**
 * Integration tests for useQuorumCheck hook and quorum utilities.
 *
 * Tests the reactive quorum checking that queries board config and
 * attendance, then calculates whether quorum is met. Also tests
 * the pure quorum calculation functions from the shared package.
 */

import { vi, describe, it, expect, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { mockQueryResult } from "@/test/mocks/powersync-mock";
import {
  calculateQuorum,
  hasQuorum,
  quorumAfterRecusal,
} from "@town-meeting/shared";

// ─── Mock PowerSync ────────────────────────────────────────────────

const { mockDb, mockUseQuery } = vi.hoisted(() => {
  return {
    mockDb: {
      execute: vi.fn().mockResolvedValue({ rows: { _array: [] }, insertId: undefined, rowsAffected: 0 }),
      getAll: vi.fn().mockResolvedValue([]),
      getOptional: vi.fn().mockResolvedValue(null),
      get: vi.fn().mockResolvedValue(undefined),
      watch: vi.fn(),
      writeTransaction: vi.fn().mockImplementation(async (callback: any) => {
        const mockTx = {
          execute: vi.fn().mockResolvedValue({ rows: { _array: [] }, insertId: undefined, rowsAffected: 0 }),
          getAll: vi.fn().mockResolvedValue([]),
          getOptional: vi.fn().mockResolvedValue(null),
          get: vi.fn().mockResolvedValue(undefined),
        };
        await callback(mockTx);
      }),
      connected: true,
      currentStatus: { connected: true, hasSynced: true, dataFlowStatus: { uploading: false, downloading: false } },
    },
    mockUseQuery: vi.fn(),
  };
});

vi.mock("@powersync/react", () => ({
  useQuery: (...args: unknown[]) => mockUseQuery(...args),
  usePowerSync: vi.fn().mockReturnValue(mockDb),
  PowerSyncContext: { Provider: ({ children }: any) => children },
}));

import { useQuorumCheck } from "./useQuorumCheck";

// ─── Test Helpers ──────────────────────────────────────────────────

function setupQuorumQuery(opts: {
  quorumType?: string;
  quorumValue?: number | null;
  memberCount?: number;
  totalActiveMembers?: number;
  attendanceStatuses?: string[];
}) {
  const {
    quorumType = "simple_majority",
    quorumValue = null,
    memberCount = 5,
    totalActiveMembers = 5,
    attendanceStatuses = [],
  } = opts;

  mockUseQuery.mockImplementation((sql: string) => {
    if (sql.includes("FROM boards")) {
      return mockQueryResult([
        { quorum_type: quorumType, quorum_value: quorumValue, member_count: memberCount },
      ]);
    }
    if (sql.includes("FROM board_members")) {
      return mockQueryResult(
        Array.from({ length: totalActiveMembers }, (_, i) => ({ id: `bm-${i + 1}` })),
      );
    }
    if (sql.includes("FROM meeting_attendance")) {
      return mockQueryResult(
        attendanceStatuses.map((status, i) => ({
          id: `att-${i + 1}`,
          board_member_id: `bm-${i + 1}`,
          status,
        })),
      );
    }
    return mockQueryResult([]);
  });
}

// ─── Tests ─────────────────────────────────────────────────────────

describe("useQuorumCheck", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when board data is not loaded", () => {
    mockUseQuery.mockReturnValue(mockQueryResult([]));

    const { result } = renderHook(() => useQuorumCheck("meeting-1", "board-1"));

    expect(result.current.quorum).toBeNull();
    expect(result.current.isLoading).toBe(true);
  });

  it("calculates quorum for simple majority with all present", () => {
    setupQuorumQuery({
      quorumType: "simple_majority",
      totalActiveMembers: 5,
      attendanceStatuses: ["present", "present", "present", "present", "present"],
    });

    const { result } = renderHook(() => useQuorumCheck("meeting-1", "board-1"));

    expect(result.current.quorum).not.toBeNull();
    expect(result.current.quorum!.required).toBe(3); // floor(5/2)+1
    expect(result.current.quorum!.present).toBe(5);
    expect(result.current.quorum!.total).toBe(5);
    expect(result.current.quorum!.hasQuorum).toBe(true);
  });

  it("detects loss of quorum when too few present", () => {
    setupQuorumQuery({
      quorumType: "simple_majority",
      totalActiveMembers: 5,
      attendanceStatuses: ["present", "present", "absent", "absent", "absent"],
    });

    const { result } = renderHook(() => useQuorumCheck("meeting-1", "board-1"));

    expect(result.current.quorum!.required).toBe(3);
    expect(result.current.quorum!.present).toBe(2);
    expect(result.current.quorum!.hasQuorum).toBe(false);
  });

  it("counts remote and late_arrival as present for quorum", () => {
    setupQuorumQuery({
      quorumType: "simple_majority",
      totalActiveMembers: 5,
      attendanceStatuses: ["present", "remote", "late_arrival", "absent", "absent"],
    });

    const { result } = renderHook(() => useQuorumCheck("meeting-1", "board-1"));

    expect(result.current.quorum!.present).toBe(3);
    expect(result.current.quorum!.hasQuorum).toBe(true);
  });

  it("handles fixed_number quorum type", () => {
    setupQuorumQuery({
      quorumType: "fixed_number",
      quorumValue: 4,
      totalActiveMembers: 7,
      attendanceStatuses: ["present", "present", "present", "present", "absent", "absent", "absent"],
    });

    const { result } = renderHook(() => useQuorumCheck("meeting-1", "board-1"));

    expect(result.current.quorum!.required).toBe(4);
    expect(result.current.quorum!.present).toBe(4);
    expect(result.current.quorum!.hasQuorum).toBe(true);
  });
});

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
