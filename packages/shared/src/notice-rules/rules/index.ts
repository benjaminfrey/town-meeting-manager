import { MAINE_RULES } from "./maine.js";
import { NEW_HAMPSHIRE_RULES } from "./new-hampshire.js";
import { VERMONT_RULES } from "./vermont.js";
import type { NoticeRule } from "../types.js";

export function getRulesForState(state: string): NoticeRule[] {
  switch (state.toUpperCase()) {
    case "ME":
    case "MAINE":
      return MAINE_RULES;
    case "NH":
    case "NEW HAMPSHIRE":
      return NEW_HAMPSHIRE_RULES;
    case "VT":
    case "VERMONT":
      return VERMONT_RULES;
    default:
      return [];
  }
}
