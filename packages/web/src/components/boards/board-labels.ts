/**
 * Display labels for board-related enums.
 * Used across AddBoardDialog, EditBoardDialog, and BoardDetailPage.
 */

export const FORMALITY_LABELS: Record<string, string> = {
  informal: "Open (informal)",
  semi_formal: "Structured (semi-formal)",
  formal: "Formal (Robert's Rules)",
};

export const MINUTES_STYLE_LABELS: Record<string, string> = {
  action: "Action minutes",
  summary: "Summary minutes",
  narrative: "Narrative minutes",
};

export const QUORUM_TYPE_LABELS: Record<string, string> = {
  simple_majority: "Simple majority",
  two_thirds: "Two-thirds",
  three_quarters: "Three-quarters",
  fixed_number: "Fixed number",
};

export const MOTION_FORMAT_LABELS: Record<string, string> = {
  block_format: "Block format",
  inline_narrative: "Inline narrative",
};

export const ELECTION_METHOD_LABELS: Record<string, string> = {
  at_large: "At-large",
  role_titled: "Role-titled",
};

export const OFFICER_ELECTION_LABELS: Record<string, string> = {
  vote_of_board: "Vote of the board",
  highest_vote_getter: "Highest vote getter",
  appointed_by_authority: "Appointed by authority",
  rotation: "Rotation",
};
