/**
 * Board-level setting resolution utilities.
 *
 * Boards can override town-level defaults for formality and minutes style.
 * These utilities resolve the effective setting and indicate the source.
 */

export type SettingSource = "board_override" | "town_default";

export interface EffectiveBoardSettings {
  formality: string;
  formalitySource: SettingSource;
  minutesStyle: string;
  minutesStyleSource: SettingSource;
}

/**
 * Resolve effective board settings by falling back to town defaults
 * when the board has no override.
 *
 * @param board - Object with override fields (may be null)
 * @param town - Object with default fields
 */
export function getEffectiveBoardSettings(
  board: {
    meeting_formality_override: string | null;
    minutes_style_override: string | null;
  },
  town: {
    meeting_formality: string;
    minutes_style: string;
  },
): EffectiveBoardSettings {
  return {
    formality: board.meeting_formality_override ?? town.meeting_formality,
    formalitySource: board.meeting_formality_override ? "board_override" : "town_default",
    minutesStyle: board.minutes_style_override ?? town.minutes_style,
    minutesStyleSource: board.minutes_style_override ? "board_override" : "town_default",
  };
}
