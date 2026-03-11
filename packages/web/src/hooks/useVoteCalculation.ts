/**
 * Vote calculation utilities for motion vote tallying.
 *
 * Pure functions — not a React hook. Computes vote results from
 * an array of vote records, supporting simple majority and
 * supermajority thresholds.
 */

// ─── Types ──────────────────────────────────────────────────────────

export interface VoteEntry {
  boardMemberId: string;
  vote: string; // "yes" | "no" | "abstain" | "recusal" | "absent"
  recusalReason?: string | null;
}

export interface VoteResult {
  yeas: number;
  nays: number;
  abstentions: number;
  recusals: number;
  absent: number;
  /** Total members who actually voted yea or nay */
  votingMembers: number;
  /** Majority threshold needed to pass */
  majorityNeeded: number;
  /** Whether the motion passed */
  passed: boolean;
  /** "passed" or "failed" */
  result: "passed" | "failed";
}

// ─── Calculation ────────────────────────────────────────────────────

/**
 * Calculate vote results from an array of individual votes.
 *
 * Majority rules:
 * - Eligible voters who actually voted = yea + nay (abstentions excluded)
 * - Simple majority = floor(votingMembers / 2) + 1
 * - Passed = yeas >= majorityNeeded
 *
 * @param votes - Array of vote entries for all board members
 * @param requiredMajority - "simple" (default) or "two_thirds"
 */
export function calculateVoteResult(
  votes: VoteEntry[],
  requiredMajority: "simple" | "two_thirds" = "simple",
): VoteResult {
  let yeas = 0;
  let nays = 0;
  let abstentions = 0;
  let recusals = 0;
  let absent = 0;

  for (const v of votes) {
    switch (v.vote) {
      case "yes":
        yeas++;
        break;
      case "no":
        nays++;
        break;
      case "abstain":
        abstentions++;
        break;
      case "recusal":
        recusals++;
        break;
      case "absent":
        absent++;
        break;
    }
  }

  const votingMembers = yeas + nays;
  let majorityNeeded: number;

  if (requiredMajority === "two_thirds") {
    majorityNeeded = votingMembers > 0 ? Math.ceil((votingMembers * 2) / 3) : 1;
  } else {
    majorityNeeded = votingMembers > 0 ? Math.floor(votingMembers / 2) + 1 : 1;
  }

  const passed = yeas >= majorityNeeded;

  return {
    yeas,
    nays,
    abstentions,
    recusals,
    absent,
    votingMembers,
    majorityNeeded,
    passed,
    result: passed ? "passed" : "failed",
  };
}

// ─── Display Formatting ─────────────────────────────────────────────

/**
 * Compact vote summary: "Passed 4-1" or "Failed 2-3" or "Passed unanimously"
 */
export function formatVoteCompact(result: VoteResult): string {
  const verb = result.passed ? "Passed" : "Failed";
  if (result.nays === 0 && result.yeas > 0) {
    return `${verb} unanimously`;
  }
  return `${verb} ${result.yeas}-${result.nays}`;
}

/**
 * Detailed vote breakdown with member names.
 *
 * Format: "Yea: Smith, Jones (2). Nay: Wilson (1). Abstained: None. Recused: Taylor (conflict)."
 */
export function formatVoteDetailed(
  votes: VoteEntry[],
  result: VoteResult,
  memberNameMap: Map<string, string>,
): string {
  const byCategory = (type: string) =>
    votes
      .filter((v) => v.vote === type)
      .map((v) => memberNameMap.get(v.boardMemberId) ?? "Unknown");

  const yeaNames = byCategory("yes");
  const nayNames = byCategory("no");
  const abstainNames = byCategory("abstain");
  const recusalEntries = votes.filter((v) => v.vote === "recusal");
  const absentNames = byCategory("absent");

  const parts: string[] = [];

  parts.push(
    `Yea: ${yeaNames.length > 0 ? `${yeaNames.join(", ")} (${result.yeas})` : "None"}`,
  );
  parts.push(
    `Nay: ${nayNames.length > 0 ? `${nayNames.join(", ")} (${result.nays})` : "None"}`,
  );

  if (result.abstentions > 0) {
    parts.push(`Abstained: ${abstainNames.join(", ")}`);
  }

  if (recusalEntries.length > 0) {
    const recusalParts = recusalEntries.map((v) => {
      const name = memberNameMap.get(v.boardMemberId) ?? "Unknown";
      return v.recusalReason ? `${name} (${v.recusalReason})` : name;
    });
    parts.push(`Recused: ${recusalParts.join(", ")}`);
  }

  if (result.absent > 0) {
    parts.push(`Absent: ${absentNames.join(", ")}`);
  }

  return parts.join(". ") + ".";
}

/**
 * Inline narrative format for inline_narrative display.
 *
 * "[Mover] moved to [text]. [Seconder] seconded. Motion [passed/failed] [count]."
 */
export function formatVoteInline(
  motionText: string,
  movedByName: string,
  secondedByName: string | null,
  result: VoteResult,
): string {
  const parts: string[] = [];
  parts.push(`${movedByName} moved ${motionText}.`);
  if (secondedByName) {
    parts.push(`${secondedByName} seconded.`);
  }
  parts.push(`Motion ${formatVoteCompact(result).toLowerCase()}.`);
  return parts.join(" ");
}

/**
 * Block format for block_format display.
 *
 * Returns structured lines for display in a block layout.
 */
export function formatVoteBlock(
  motionText: string,
  movedByName: string,
  secondedByName: string | null,
  result: VoteResult,
): { label: string; value: string }[] {
  const lines: { label: string; value: string }[] = [
    { label: "Motion", value: motionText },
    { label: "Moved by", value: movedByName },
  ];

  if (secondedByName) {
    lines.push({ label: "Seconded by", value: secondedByName });
  }

  lines.push({
    label: "Vote",
    value: `Yea: ${result.yeas}, Nay: ${result.nays}${result.abstentions > 0 ? `, Abstain: ${result.abstentions}` : ""}`,
  });

  lines.push({
    label: "Result",
    value: result.passed ? "Passed" : "Failed",
  });

  return lines;
}
