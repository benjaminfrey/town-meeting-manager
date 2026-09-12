/**
 * `calculateVoteResult` — Phase E, wave 5, Task 3.
 *
 * The function moved here from `packages/web/src/hooks/useVoteCalculation.ts`
 * so that `voteRecord.recordForMotion` can compute a motion's outcome
 * server-side instead of accepting the browser's. It had NO test on either
 * side of that move — `grep -rn "useVoteCalculation" packages/web/src` matched
 * only source files, never a test file — so these are the first assertions it
 * has ever carried, and they are what makes the move a move rather than a
 * transcription: if the body changed in transit, the table below says so.
 */

import { describe, expect, it } from "vitest";
import { calculateVoteResult, type VoteEntry } from "../vote-tally.js";

const entries = (...votes: string[]): VoteEntry[] =>
  votes.map((vote, index) => ({ boardMemberId: `m-${index}`, vote }));

describe("calculateVoteResult", () => {
  it("counts each vote_type value into its own bucket", () => {
    const result = calculateVoteResult(entries("yes", "yes", "no", "abstain", "recusal", "absent"));
    expect(result.yeas).toBe(2);
    expect(result.nays).toBe(1);
    expect(result.abstentions).toBe(1);
    expect(result.recusals).toBe(1);
    expect(result.absent).toBe(1);
  });

  it("excludes abstentions, recusals and absences from the majority base", () => {
    // Three yeas against two nays, with three non-voters — the threshold is
    // computed from the five who actually voted, not the eight seats.
    const result = calculateVoteResult(
      entries("yes", "yes", "yes", "no", "no", "abstain", "recusal", "absent"),
    );
    expect(result.votingMembers).toBe(5);
    expect(result.majorityNeeded).toBe(3);
    expect(result.passed).toBe(true);
    expect(result.result).toBe("passed");
  });

  it("fails a tie under a simple majority", () => {
    const result = calculateVoteResult(entries("yes", "yes", "no", "no"));
    expect(result.majorityNeeded).toBe(3);
    expect(result.passed).toBe(false);
    expect(result.result).toBe("failed");
  });

  it("needs two thirds of those voting when asked for it", () => {
    // 3 of 5 is a simple majority and is NOT two thirds (ceil(10/3) = 4).
    const votes = entries("yes", "yes", "yes", "no", "no");
    expect(calculateVoteResult(votes, "simple").passed).toBe(true);
    expect(calculateVoteResult(votes, "two_thirds").majorityNeeded).toBe(4);
    expect(calculateVoteResult(votes, "two_thirds").passed).toBe(false);
  });

  it("fails a motion nobody voted on, rather than passing it vacuously", () => {
    // `majorityNeeded` falls back to 1 when the base is zero, precisely so
    // that zero yeas cannot clear it. An all-abstain vote is the reachable
    // form of this.
    const result = calculateVoteResult(entries("abstain", "abstain"));
    expect(result.votingMembers).toBe(0);
    expect(result.majorityNeeded).toBe(1);
    expect(result.passed).toBe(false);
  });

  it("ignores a vote value outside the enum instead of counting it somewhere", () => {
    // `VotePanel` builds an entry with `vote: ""` for a member who has not
    // voted yet and filters those out before tallying; this pins that an
    // unrecognised value reaching the tally moves no counter.
    const result = calculateVoteResult(entries("yes", "", "nope"));
    expect(result.yeas).toBe(1);
    expect(result.votingMembers).toBe(1);
  });
});
