/**
 * `components/minutes/TrackedChanges.tsx` — what the clerk changed from the
 * generated draft.
 *
 * Phase E, wave 6, Task 3. First test file this component has ever had. It
 * makes no network call of its own, so there is no transport to stub: it is a
 * pure function of two `MinutesContentJson` values and a boolean.
 *
 * What is worth pinning is the arithmetic nobody was checking — that an
 * UNCHANGED document says so rather than rendering an empty shell, that a
 * changed one shows both halves of the edit (the removed words AND the added
 * ones), and that a section or item present on only one side does not crash
 * the paired walk.
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { MinutesContentJson } from "@town-meeting/shared/types";
import { TrackedChanges } from "../TrackedChanges";

function doc(
  sections: Array<{ title: string; items: Array<{ title: string; discussion?: string | null }> }>,
): MinutesContentJson {
  return {
    meeting_header: {
      town_name: "Testville",
      board_name: "Select Board",
      board_type: null,
      meeting_date: "2026-01-01",
      meeting_type: "regular",
      location: null,
      called_to_order_at: null,
      adjourned_at: null,
    },
    attendance: { present: [], absent: [], staff: [], quorum_met: true },
    sections: sections.map((s) => ({
      section_type: "new_business",
      title: s.title,
      marked_none: false,
      items: s.items.map((i) => ({
        title: i.title,
        discussion_summary: i.discussion ?? null,
        timestamp_start: null,
        timestamp_end: null,
        motions: [],
        speakers: [],
      })),
    })),
    adjournment: null,
    certification: { recorded_by: null, recorded_by_title: null, approved_on: null },
  } as unknown as MinutesContentJson;
}

describe("TrackedChanges", () => {
  it("renders nothing at all when it is not visible", () => {
    const { container } = render(
      <TrackedChanges
        originalContentJson={doc([{ title: "A", items: [{ title: "One" }] }])}
        currentContentJson={doc([{ title: "B", items: [{ title: "Two" }] }])}
        visible={false}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("says so when the document is unchanged", () => {
    const same = doc([{ title: "New Business", items: [{ title: "Road repairs" }] }]);
    render(
      <TrackedChanges
        originalContentJson={same}
        currentContentJson={doc([{ title: "New Business", items: [{ title: "Road repairs" }] }])}
        visible
      />,
    );
    expect(screen.getByText("No changes from the original draft.")).toBeInTheDocument();
  });

  it("shows both halves of an edited item title", () => {
    render(
      <TrackedChanges
        originalContentJson={doc([{ title: "New Business", items: [{ title: "Road repairs" }] }])}
        currentContentJson={doc([{ title: "New Business", items: [{ title: "Culvert repairs" }] }])}
        visible
      />,
    );
    expect(screen.getByText("Road")).toBeInTheDocument();
    expect(screen.getByText("Culvert")).toBeInTheDocument();
    // The unchanged word is carried through, not re-rendered as a change.
    expect(screen.getByText("repairs")).toBeInTheDocument();
  });

  it("shows an edited discussion summary under its item", () => {
    render(
      <TrackedChanges
        originalContentJson={doc([
          { title: "New Business", items: [{ title: "Road repairs", discussion: "Brief" }] },
        ])}
        currentContentJson={doc([
          { title: "New Business", items: [{ title: "Road repairs", discussion: "Lengthy" }] },
        ])}
        visible
      />,
    );
    expect(screen.getByText("Brief")).toBeInTheDocument();
    expect(screen.getByText("Lengthy")).toBeInTheDocument();
  });

  it("renders an edited section title and leaves untouched sections out", () => {
    render(
      <TrackedChanges
        originalContentJson={doc([
          { title: "Old Business", items: [] },
          { title: "Adjournment", items: [] },
        ])}
        currentContentJson={doc([
          { title: "New Business", items: [] },
          { title: "Adjournment", items: [] },
        ])}
        visible
      />,
    );
    expect(screen.getByText("Old")).toBeInTheDocument();
    expect(screen.getByText("New")).toBeInTheDocument();
    expect(screen.queryByText("Adjournment")).not.toBeInTheDocument();
  });

  it("handles a section the clerk added, which exists on only one side", () => {
    render(
      <TrackedChanges
        originalContentJson={doc([{ title: "New Business", items: [] }])}
        currentContentJson={doc([
          { title: "New Business", items: [] },
          { title: "Public Comment", items: [{ title: "Culvert" }] },
        ])}
        visible
      />,
    );
    expect(screen.getByText("Public Comment")).toBeInTheDocument();
    expect(screen.getByText("Culvert")).toBeInTheDocument();
  });
});
