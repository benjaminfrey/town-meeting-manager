import type { AgendaTemplateSection } from "../types/agenda.js";

function deepClone(sections: AgendaTemplateSection[]): AgendaTemplateSection[] {
  return JSON.parse(JSON.stringify(sections)) as AgendaTemplateSection[];
}

/**
 * Default Select Board template — 12 sections per Advisory 2.2 Spec §7.
 */
export const DEFAULT_SELECT_BOARD_SECTIONS: AgendaTemplateSection[] = [
  {
    title: "Call to Order",
    sort_order: 0,
    section_type: "procedural",
    is_fixed: true,
    description: null,
    default_items: [],
    minutes_behavior: "timestamp_only",
    show_item_commentary: false,
  },
  {
    title: "Amendments to the Agenda",
    sort_order: 1,
    section_type: "procedural",
    is_fixed: true,
    description: null,
    default_items: [],
    minutes_behavior: "action_only",
    show_item_commentary: false,
  },
  {
    title: "Minutes of Previous Meeting(s)",
    sort_order: 2,
    section_type: "minutes_approval",
    is_fixed: true,
    description: null,
    default_items: [],
    minutes_behavior: "action_only",
    show_item_commentary: false,
  },
  {
    title: "Public Comments",
    sort_order: 3,
    section_type: "public_input",
    is_fixed: true,
    description: null,
    default_items: [],
    minutes_behavior: "summarize",
    show_item_commentary: false,
  },
  {
    title: "Presentations and Special Guests",
    sort_order: 4,
    section_type: "report",
    is_fixed: false,
    description: null,
    default_items: [],
    minutes_behavior: "summarize",
    show_item_commentary: true,
  },
  {
    title: "Unfinished Business",
    sort_order: 5,
    section_type: "action",
    is_fixed: false,
    description: null,
    default_items: [],
    minutes_behavior: "summarize",
    show_item_commentary: true,
  },
  {
    title: "New Business",
    sort_order: 6,
    section_type: "action",
    is_fixed: true,
    description: null,
    default_items: [],
    minutes_behavior: "summarize",
    show_item_commentary: true,
  },
  {
    title: "Fiscal Warrants",
    sort_order: 7,
    section_type: "financial",
    is_fixed: true,
    description: null,
    default_items: [],
    minutes_behavior: "action_only",
    show_item_commentary: false,
  },
  {
    title: "Town Manager Report",
    sort_order: 8,
    section_type: "report",
    is_fixed: false,
    description: null,
    default_items: [],
    minutes_behavior: "summarize",
    show_item_commentary: true,
  },
  {
    title: "Future Agenda Items",
    sort_order: 9,
    section_type: "discussion",
    is_fixed: false,
    description: null,
    default_items: [],
    minutes_behavior: "summarize",
    show_item_commentary: false,
  },
  {
    title: "Executive Session",
    sort_order: 10,
    section_type: "executive_session",
    is_fixed: false,
    description: null,
    default_items: [],
    minutes_behavior: "full_record",
    show_item_commentary: false,
  },
  {
    title: "Adjournment",
    sort_order: 11,
    section_type: "procedural",
    is_fixed: true,
    description: null,
    default_items: [],
    minutes_behavior: "timestamp_only",
    show_item_commentary: false,
  },
];

/**
 * Default Planning Board template — 6 sections per Advisory 2.2 §11.
 */
export const DEFAULT_PLANNING_BOARD_SECTIONS: AgendaTemplateSection[] = [
  {
    title: "Call to Order",
    sort_order: 0,
    section_type: "procedural",
    is_fixed: true,
    description: null,
    default_items: [],
    minutes_behavior: "timestamp_only",
    show_item_commentary: false,
  },
  {
    title: "Minutes of Previous Meeting(s)",
    sort_order: 1,
    section_type: "minutes_approval",
    is_fixed: true,
    description: null,
    default_items: [],
    minutes_behavior: "action_only",
    show_item_commentary: false,
  },
  {
    title: "New Applications",
    sort_order: 2,
    section_type: "action",
    is_fixed: false,
    description: null,
    default_items: [],
    minutes_behavior: "full_record",
    show_item_commentary: true,
  },
  {
    title: "Public Hearings",
    sort_order: 3,
    section_type: "public_hearing",
    is_fixed: false,
    description: null,
    default_items: [],
    minutes_behavior: "full_record",
    show_item_commentary: true,
  },
  {
    title: "Old Business",
    sort_order: 4,
    section_type: "action",
    is_fixed: false,
    description: null,
    default_items: [],
    minutes_behavior: "summarize",
    show_item_commentary: true,
  },
  {
    title: "Adjournment",
    sort_order: 5,
    section_type: "procedural",
    is_fixed: true,
    description: null,
    default_items: [],
    minutes_behavior: "timestamp_only",
    show_item_commentary: false,
  },
];

/**
 * Default template for all other board types — minimal 4 sections.
 */
export const DEFAULT_OTHER_BOARD_SECTIONS: AgendaTemplateSection[] = [
  {
    title: "Call to Order",
    sort_order: 0,
    section_type: "procedural",
    is_fixed: true,
    description: null,
    default_items: [],
    minutes_behavior: "timestamp_only",
    show_item_commentary: false,
  },
  {
    title: "Minutes of Previous Meeting(s)",
    sort_order: 1,
    section_type: "minutes_approval",
    is_fixed: true,
    description: null,
    default_items: [],
    minutes_behavior: "action_only",
    show_item_commentary: false,
  },
  {
    title: "New Business",
    sort_order: 2,
    section_type: "action",
    is_fixed: false,
    description: null,
    default_items: [],
    minutes_behavior: "summarize",
    show_item_commentary: true,
  },
  {
    title: "Adjournment",
    sort_order: 3,
    section_type: "procedural",
    is_fixed: true,
    description: null,
    default_items: [],
    minutes_behavior: "timestamp_only",
    show_item_commentary: false,
  },
];

/**
 * Get default template sections for a given board type.
 * Returns a deep clone so callers can mutate safely.
 */
export function getDefaultTemplateSections(
  boardType: string,
): AgendaTemplateSection[] {
  if (boardType === "select_board")
    return deepClone(DEFAULT_SELECT_BOARD_SECTIONS);
  if (boardType === "planning_board")
    return deepClone(DEFAULT_PLANNING_BOARD_SECTIONS);
  return deepClone(DEFAULT_OTHER_BOARD_SECTIONS);
}

/**
 * Get the default template display name for a given board type.
 */
export function getDefaultTemplateName(boardType: string): string {
  if (boardType === "select_board") return "Select Board Standard Agenda";
  if (boardType === "planning_board") return "Planning Board Standard Agenda";
  return "Standard Agenda";
}
