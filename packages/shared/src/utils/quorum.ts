/**
 * Quorum calculation utilities for board meetings.
 *
 * Quorum is a simple majority of the filled seats (not total authorized seats).
 * This follows standard parliamentary procedure.
 */

/**
 * Calculate the quorum requirement for a board.
 * Quorum = floor(filledSeats / 2) + 1 (simple majority).
 *
 * @param filledSeats - Number of currently filled board seats
 * @returns Minimum number of members required for quorum
 */
export function calculateQuorum(filledSeats: number): number {
  if (filledSeats <= 0) return 0;
  return Math.floor(filledSeats / 2) + 1;
}

/**
 * Check if a meeting has quorum based on attendance.
 *
 * @param presentCount - Number of members present (including remote)
 * @param filledSeats - Total number of filled board seats
 * @returns Whether quorum is met
 */
export function hasQuorum(presentCount: number, filledSeats: number): boolean {
  const required = calculateQuorum(filledSeats);
  return presentCount >= required;
}

/**
 * Calculate quorum after accounting for recusals on a specific vote.
 * Members who recuse themselves are excluded from the quorum calculation
 * for that particular vote.
 *
 * @param presentCount - Number of members present
 * @param recusedCount - Number of members recused from this vote
 * @param filledSeats - Total number of filled board seats
 * @returns Object with adjusted quorum info
 */
export function quorumAfterRecusal(
  presentCount: number,
  recusedCount: number,
  filledSeats: number,
): {
  adjustedFilledSeats: number;
  adjustedQuorum: number;
  eligibleVoters: number;
  hasQuorum: boolean;
} {
  const adjustedFilledSeats = filledSeats - recusedCount;
  const adjustedQuorum = calculateQuorum(adjustedFilledSeats);
  const eligibleVoters = presentCount - recusedCount;

  return {
    adjustedFilledSeats,
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
  filledSeats: number,
): string {
  const required = calculateQuorum(filledSeats);
  const met = presentCount >= required;
  const icon = met ? "✓" : "✗";
  return `${presentCount} of ${filledSeats} present (quorum: ${required}) ${icon}`;
}
