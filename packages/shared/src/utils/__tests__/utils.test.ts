import { describe, expect, it } from "vitest";
import { generateId, isValidUuid, extractTimestamp } from "../id.js";
import {
  formatGovernmentTitle,
  formatBoardMemberDisplay,
  formatMeetingTitle,
  formatMeetingTime,
} from "../government.js";
import {
  calculateQuorum,
  hasQuorum,
  quorumAfterRecusal,
  formatQuorumStatus,
} from "../quorum.js";
import { getEffectiveBoardSettings } from "../board-settings.js";

// ─── generateId / isValidUuid ───────────────────────────────────────

describe("generateId", () => {
  it("returns a UUID-format string", () => {
    const id = generateId();
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it("generates unique values", () => {
    const ids = Array.from({ length: 100 }, () => generateId());
    const unique = new Set(ids);
    expect(unique.size).toBe(100);
  });
});

describe("isValidUuid", () => {
  it("validates correct UUIDs", () => {
    expect(isValidUuid("a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11")).toBe(true);
  });

  it("rejects invalid strings", () => {
    expect(isValidUuid("not-a-uuid")).toBe(false);
    expect(isValidUuid("")).toBe(false);
    expect(isValidUuid("12345")).toBe(false);
  });

  it("validates generated IDs", () => {
    expect(isValidUuid(generateId())).toBe(true);
  });
});

describe("extractTimestamp", () => {
  it("extracts timestamp from UUID v7", () => {
    const id = generateId();
    const ts = extractTimestamp(id);
    // Should be a recent timestamp (within last few seconds)
    if (ts !== null) {
      expect(ts).toBeGreaterThan(Date.now() - 5000);
      expect(ts).toBeLessThanOrEqual(Date.now());
    }
  });

  it("returns null for invalid UUID", () => {
    expect(extractTimestamp("not-a-uuid")).toBe(null);
  });
});

// ─── formatGovernmentTitle ──────────────────────────────────────────

describe("formatGovernmentTitle", () => {
  it("returns gov_title when provided", () => {
    expect(formatGovernmentTitle("Town Clerk", "Staff")).toBe("Town Clerk");
  });

  it("falls back to roleLabel when gov_title is null", () => {
    expect(formatGovernmentTitle(null, "Staff")).toBe("Staff");
  });

  it("falls back to roleLabel when gov_title is empty", () => {
    expect(formatGovernmentTitle("", "Staff")).toBe("Staff");
  });

  it("falls back to roleLabel when gov_title is whitespace", () => {
    expect(formatGovernmentTitle("   ", "Staff")).toBe("Staff");
  });

  it("trims whitespace from gov_title", () => {
    expect(formatGovernmentTitle("  Town Clerk  ", "Staff")).toBe("Town Clerk");
  });
});

// ─── formatBoardMemberDisplay ───────────────────────────────────────

describe("formatBoardMemberDisplay", () => {
  it("formats name with seat title", () => {
    expect(formatBoardMemberDisplay("Jane Smith", "Chair")).toBe(
      "Jane Smith (Chair)",
    );
  });

  it("returns just name when seat title is null", () => {
    expect(formatBoardMemberDisplay("Jane Smith", null)).toBe("Jane Smith");
  });

  it("returns just name when seat title is empty", () => {
    expect(formatBoardMemberDisplay("Jane Smith", "")).toBe("Jane Smith");
  });

  it("formats with ordinal seat title", () => {
    expect(formatBoardMemberDisplay("Jane Smith", "1st Selectman")).toBe(
      "Jane Smith (1st Selectman)",
    );
  });
});

// ─── formatMeetingTitle ─────────────────────────────────────────────

describe("formatMeetingTitle", () => {
  it("formats meeting title with board name, type, and date", () => {
    const result = formatMeetingTitle("Planning Board", "regular", "2025-01-15");
    expect(result).toContain("Planning Board");
    expect(result).toContain("Regular");
    expect(result).toContain("2025");
  });

  it("converts snake_case meeting type to Title Case", () => {
    const result = formatMeetingTitle("Select Board", "public_hearing", "2025-06-01");
    expect(result).toContain("Public Hearing");
  });
});

// ─── formatMeetingTime ──────────────────────────────────────────────

describe("formatMeetingTime", () => {
  it("converts 24h to 12h PM", () => {
    expect(formatMeetingTime("18:30")).toBe("6:30 PM");
  });

  it("converts midnight", () => {
    expect(formatMeetingTime("00:00")).toBe("12:00 AM");
  });

  it("converts noon", () => {
    expect(formatMeetingTime("12:00")).toBe("12:00 PM");
  });

  it("handles morning time", () => {
    expect(formatMeetingTime("09:15")).toBe("9:15 AM");
  });
});

// ─── calculateQuorum ────────────────────────────────────────────────

describe("calculateQuorum", () => {
  it("calculates simple majority", () => {
    expect(calculateQuorum(5, "simple_majority")).toBe(3);
    expect(calculateQuorum(7, "simple_majority")).toBe(4);
    expect(calculateQuorum(3, "simple_majority")).toBe(2);
    expect(calculateQuorum(1, "simple_majority")).toBe(1);
  });

  it("calculates two-thirds", () => {
    expect(calculateQuorum(5, "two_thirds")).toBe(4);
    expect(calculateQuorum(6, "two_thirds")).toBe(4);
    expect(calculateQuorum(9, "two_thirds")).toBe(6);
  });

  it("calculates three-quarters", () => {
    expect(calculateQuorum(4, "three_quarters")).toBe(3);
    expect(calculateQuorum(8, "three_quarters")).toBe(6);
  });

  it("returns fixed number capped at member count", () => {
    expect(calculateQuorum(5, "fixed_number", 5)).toBe(5);
    expect(calculateQuorum(3, "fixed_number", 5)).toBe(3);
  });

  it("returns 0 for 0 members", () => {
    expect(calculateQuorum(0, "simple_majority")).toBe(0);
  });

  it("defaults to simple majority when type is null", () => {
    expect(calculateQuorum(5, null)).toBe(3);
  });
});

describe("hasQuorum", () => {
  it("returns true when present meets quorum", () => {
    expect(hasQuorum(3, 5, "simple_majority")).toBe(true);
  });

  it("returns false when present is below quorum", () => {
    expect(hasQuorum(2, 5, "simple_majority")).toBe(false);
  });
});

describe("quorumAfterRecusal", () => {
  it("adjusts quorum for recused members", () => {
    const result = quorumAfterRecusal(4, 1, 5, "simple_majority");
    expect(result.adjustedMemberCount).toBe(4);
    expect(result.eligibleVoters).toBe(3);
    expect(result.hasQuorum).toBe(true);
  });
});

describe("formatQuorumStatus", () => {
  it("formats with checkmark when quorum met", () => {
    const result = formatQuorumStatus(3, 5, "simple_majority");
    expect(result).toContain("3 of 5");
    expect(result).toContain("quorum: 3");
  });
});

// ─── getEffectiveBoardSettings ──────────────────────────────────────

describe("getEffectiveBoardSettings", () => {
  const townDefaults = {
    meeting_formality: "informal",
    minutes_style: "summary",
  };

  it("returns board override when set", () => {
    const board = {
      meeting_formality_override: "formal",
      minutes_style_override: "narrative",
    };
    const result = getEffectiveBoardSettings(board, townDefaults);
    expect(result.formality).toBe("formal");
    expect(result.formalitySource).toBe("board_override");
    expect(result.minutesStyle).toBe("narrative");
    expect(result.minutesStyleSource).toBe("board_override");
  });

  it("falls back to town default when override is null", () => {
    const board = {
      meeting_formality_override: null,
      minutes_style_override: null,
    };
    const result = getEffectiveBoardSettings(board, townDefaults);
    expect(result.formality).toBe("informal");
    expect(result.formalitySource).toBe("town_default");
    expect(result.minutesStyle).toBe("summary");
    expect(result.minutesStyleSource).toBe("town_default");
  });

  it("handles mixed overrides", () => {
    const board = {
      meeting_formality_override: "formal",
      minutes_style_override: null,
    };
    const result = getEffectiveBoardSettings(board, townDefaults);
    expect(result.formality).toBe("formal");
    expect(result.formalitySource).toBe("board_override");
    expect(result.minutesStyle).toBe("summary");
    expect(result.minutesStyleSource).toBe("town_default");
  });
});
