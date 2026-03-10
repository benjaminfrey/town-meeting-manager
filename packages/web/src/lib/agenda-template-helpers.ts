import type { AgendaTemplateSection } from "@town-meeting/shared/types";
import { AgendaTemplateSectionSchema } from "@town-meeting/shared";

/**
 * Parse a JSON string from the PowerSync TEXT column into typed sections.
 * Returns empty array if the input is null or validation fails.
 */
export function parseSections(
  jsonText: string | null,
): AgendaTemplateSection[] {
  if (!jsonText) return [];
  try {
    const raw = JSON.parse(jsonText) as unknown[];
    if (!Array.isArray(raw)) return [];
    const results: AgendaTemplateSection[] = [];
    for (const item of raw) {
      const parsed = AgendaTemplateSectionSchema.safeParse(item);
      if (parsed.success) {
        results.push(parsed.data as AgendaTemplateSection);
      }
    }
    return results;
  } catch {
    return [];
  }
}

/**
 * Serialize sections array to JSON string for PowerSync TEXT storage.
 * Re-derives sort_order from array index. Validates each section with Zod.
 * Throws on invalid data.
 */
export function serializeSections(
  sections: AgendaTemplateSection[],
): string {
  const validated: AgendaTemplateSection[] = [];
  for (let i = 0; i < sections.length; i++) {
    const normalized = { ...sections[i], sort_order: i };
    const result = AgendaTemplateSectionSchema.safeParse(normalized);
    if (!result.success) {
      throw new Error(
        `Invalid section at index ${i}: ${result.error.message}`,
      );
    }
    validated.push(result.data as AgendaTemplateSection);
  }
  return JSON.stringify(validated);
}
