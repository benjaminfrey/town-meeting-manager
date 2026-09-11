/**
 * Vote calculation utilities for motion vote tallying.
 *
 * Pure functions — not a React hook. Computes vote results from
 * an array of vote records, supporting simple majority and
 * supermajority thresholds.
 *
 * **`calculateVoteResult` and its two types now live in
 * `@town-meeting/shared` (`utils/vote-tally.ts`) and are re-exported here
 * unchanged** — Phase E, wave 5, Task 3. `voteRecord.recordForMotion`
 * computes a motion's outcome server-side rather than accepting the browser's
 * word for whether it carried, so the tally needs a body `packages/api` can
 * import. Re-exported rather than relocated-and-rewired so every existing
 * import of this module (`VotePanel.tsx`, `MotionCard`, the tests) is
 * untouched, and so there is exactly ONE majority rule in the repository
 * rather than two that drift.
 *
 * The formatters below stay here: they are display concerns with no server
 * caller.
 */

export { calculateVoteResult, type VoteEntry, type VoteResult } from "@town-meeting/shared";

import type { VoteEntry, VoteResult } from "@town-meeting/shared";

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

  parts.push(`Yea: ${yeaNames.length > 0 ? `${yeaNames.join(", ")} (${result.yeas})` : "None"}`);
  parts.push(`Nay: ${nayNames.length > 0 ? `${nayNames.join(", ")} (${result.nays})` : "None"}`);

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
