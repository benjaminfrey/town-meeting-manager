/**
 * The agenda builder's row types, taken from the procedures themselves.
 *
 * Phase E, wave 4, Task 3. Every component on this screen used to take
 * `Record<string, unknown>` — the bag type conventions item 10 names as what
 * made unit 0's dropped-column regression silent (a dialog read
 * `board.town_id` off an object the screen passed down, compiled, and
 * produced `""`). These are `RouterOutputs`-derived, so a column dropped from
 * `agendaItem.byMeeting` or `exhibit.byMeeting` is a compile error at every
 * component that reads it, including the ones a screen only passes it to.
 *
 * They live in their own module rather than on the route that reads them so
 * that `AgendaSection` → `AgendaItemRow` → `InlineItemForm`/`ExhibitUploader`
 * do not have to import from the route they are rendered by.
 */

import type { RouterOutputs } from "@/lib/trpc";

/** One row of `agendaItem.byMeeting` — a section or an item; the shape is one. */
export type AgendaItem = RouterOutputs["agendaItem"]["byMeeting"][number];

/**
 * One row of `exhibit.byMeeting` — already filtered by rule 14, so a
 * component holding one of these never has to ask whether it may render it.
 */
export type MeetingExhibit = RouterOutputs["exhibit"]["byMeeting"][number];

/** A top-level item with its children attached, as the builder groups them. */
export type SectionWithChildren = AgendaItem & { children: AgendaItem[] };
