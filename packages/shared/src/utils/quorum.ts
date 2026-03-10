/**
 * Quorum calculation utilities for board meetings.
 *
 * Supports multiple quorum types per board:
 * - simple_majority: >50% of seated members, rounded up
 * - two_thirds: ≥2/3 of seated members
 * - three_quarters: ≥3/4 of seated members
 * - fixed_number: an explicit number of members
 *
 * Default is simple majority, which follows standard parliamentary procedure.
 */

import type { QuorumType } from "../constants/enums.js";

/**
 * Calculate the quorum requirement for a board.
 *
 * @param memberCount - Number of board seats (member_count)
 * @param quorumType - Quorum calculation method (defaults to simple_majority)
 * @param quorumValue - Fixed number, only used when quorumType is 'fixed_number'
 * @returns Minimum number of members required for quorum
 */
export function calculateQuorum(
  memberCount: number,
  quorumType?: QuorumType | null,
  quorumValue?: number | null,
): number {
  if (memberCount <= 0) return 0;

  const type = quorumType ?? "simple_majority";

  switch (type) {
    case "simple_majority":
      return Math.floor(memberCount / 2) + 1;
    case "two_thirds":
      return Math.ceil((memberCount * 2) / 3);
    case "three_quarters":
      return Math.ceil((memberCount * 3) / 4);
    case "fixed_number": {
      const value = quorumValue ?? 1;
      return Math.min(value, memberCount);
    }
    default:
      return Math.floor(memberCount / 2) + 1;
  }
}

/**
 * Check if a meeting has quorum based on attendance.
 *
 * @param presentCount - Number of members present (including remote)
 * @param memberCount - Total number of board seats
 * @param quorumType - Quorum calculation method
 * @param quorumValue - Fixed number (for fixed_number type)
 * @returns Whether quorum is met
 */
export function hasQuorum(
  presentCount: number,
  memberCount: number,
  quorumType?: QuorumType | null,
  quorumValue?: number | null,
): boolean {
  const required = calculateQuorum(memberCount, quorumType, quorumValue);
  return presentCount >= required;
}

/**
 * Calculate quorum after accounting for recusals on a specific vote.
 * Members who recuse themselves are excluded from the quorum calculation
 * for that particular vote.
 *
 * @param presentCount - Number of members present
 * @param recusedCount - Number of members recused from this vote
 * @param memberCount - Total number of board seats
 * @param quorumType - Quorum calculation method
 * @param quorumValue - Fixed number (for fixed_number type)
 * @returns Object with adjusted quorum info
 */
export function quorumAfterRecusal(
  presentCount: number,
  recusedCount: number,
  memberCount: number,
  quorumType?: QuorumType | null,
  quorumValue?: number | null,
): {
  adjustedMemberCount: number;
  adjustedQuorum: number;
  eligibleVoters: number;
  hasQuorum: boolean;
} {
  const adjustedMemberCount = memberCount - recusedCount;
  const adjustedQuorum = calculateQuorum(adjustedMemberCount, quorumType, quorumValue);
  const eligibleVoters = presentCount - recusedCount;

  return {
    adjustedMemberCount,
    adjustedQuorum,
    eligibleVoters,
    hasQuorum: eligibleVoters >= adjustedQuorum,
  };
}

/**
 * Format quorum status for display.
 * e.g., "3 of 5 present (quorum: 3) ✓" or "2 of 5 present (quorum: 3) ✗"
 */
export function formatQuorumStatus(
  presentCount: number,
  memberCount: number,
  quorumType?: QuorumType | null,
  quorumValue?: number | null,
): string {
  const required = calculateQuorum(memberCount, quorumType, quorumValue);
  const met = presentCount >= required;
  const icon = met ? "✓" : "✗";
  return `${presentCount} of ${memberCount} present (quorum: ${required}) ${icon}`;
}

/**
 * Human-readable label for a quorum type.
 */
export const QUORUM_TYPE_LABELS: Record<string, string> = {
  simple_majority: "Simple majority",
  two_thirds: "Two-thirds",
  three_quarters: "Three-quarters",
  fixed_number: "Fixed number",
};
