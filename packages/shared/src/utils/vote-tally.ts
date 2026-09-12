/**
 * Vote tallying — moved here in Phase E, wave 5, Task 3.
 *
 * This function used to live in `packages/web/src/hooks/useVoteCalculation.ts`
 * and be called only by `components/meeting/VotePanel.tsx`, which computed the
 * result in the browser and then posted BOTH the individual votes and the
 * motion's outcome (`status`, `vote_summary`) straight to Supabase. Wave 5's
 * `voteRecord.recordForMotion` takes over that write, and a server that accepts
 * a client-computed "passed" is a server that lets a client declare a motion
 * carried. So the tally has to run in `packages/api`.
 *
 * **Moved rather than copied, deliberately.** A second implementation of a
 * majority rule is a drift hazard with a legal record on the other end of it:
 * the two copies would answer differently the first time either is edited, and
 * `vote_summary` is what the minutes assembler renders. `useVoteCalculation.ts`
 * now re-exports this function, so every existing web import is unchanged and
 * there is exactly one body.
 *
 * The formatters (`formatVoteCompact`, `formatVoteDetailed`, `formatVoteInline`,
 * `formatVoteBlock`) stayed in the web hook: they are display concerns with no
 * server caller, and moving code nothing on this side needs would be churn.
 */

/** One member's vote, as recorded against their seat. */
export interface VoteEntry {
  boardMemberId: string;
  /** "yes" | "no" | "abstain" | "recusal" | "absent" — the `vote_type` enum. */
  vote: string;
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
