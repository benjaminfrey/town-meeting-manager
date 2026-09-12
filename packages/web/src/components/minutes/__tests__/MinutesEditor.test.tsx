/**
 * `components/minutes/MinutesEditor.tsx` — the clerk's edit surface.
 *
 * Phase E, wave 6, Task 3. First test file this component has ever had.
 *
 * `SourceDataPanel` is stubbed here — it has its own file, and what this one
 * owns about it is the seam: that the `boardId` this component is given is
 * the one the panel is handed (the prop exists for no other reason), and that
 * the panel is shown the EDITED content rather than the saved content, which
 * is what makes the right-hand panel follow the section the clerk is in.
 *
 * The auto-save interval and the save-on-unmount effect are driven with fake
 * timers and an unmount respectively, because both write the legal record
 * without anyone pressing anything, and neither had a test.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { MinutesContentJson } from "@town-meeting/shared/types";
import { MinutesEditor } from "../MinutesEditor";

vi.mock("../SourceDataPanel", () => ({
  SourceDataPanel: (props: {
    boardId: string;
    selectedSectionIndex: number;
    contentJson: unknown;
  }) => (
    <div data-testid="source-data-panel">
      <span data-testid="panel-board-id">{props.boardId}</span>
      <span data-testid="panel-section-index">{props.selectedSectionIndex}</span>
      <span data-testid="panel-first-item-title">
        {(props.contentJson as MinutesContentJson).sections[0]?.items[0]?.title ?? ""}
      </span>
    </div>
  ),
}));

function contentJson(): MinutesContentJson {
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
    sections: [
      {
        section_type: "new_business",
        title: "New Business",
        marked_none: false,
        items: [
          {
            title: "Road repairs",
            discussion_summary: "Discussed the culvert.",
            timestamp_start: null,
            timestamp_end: null,
            motions: [],
            speakers: [{ name: "Jane Public", topic: "Culvert" }],
          },
        ],
      },
      { section_type: "adjournment", title: "Adjournment", marked_none: true, items: [] },
    ],
    adjournment: null,
    certification: { recorded_by: null, recorded_by_title: null, approved_on: null },
  } as unknown as MinutesContentJson;
}

function renderEditor(onSave = vi.fn().mockResolvedValue(undefined)) {
  const result = render(
    <MinutesEditor
      minutesDocId="minutes-1"
      meetingId="meeting-1"
      boardId="board-1"
      contentJson={contentJson()}
      onSave={onSave}
    />,
  );
  return { ...result, onSave };
}

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("MinutesEditor", () => {
  it("hands SourceDataPanel the board id it was given", () => {
    renderEditor();
    expect(screen.getByTestId("panel-board-id")).toHaveTextContent("board-1");
  });

  it("starts clean: Saved, and the Save button disabled", () => {
    renderEditor();
    expect(screen.getByText("Saved")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save/i })).toBeDisabled();
  });

  it("marks unsaved on an edit and shows the edit to the source panel", async () => {
    const user = userEvent.setup();
    renderEditor();

    await user.clear(screen.getByDisplayValue("Road repairs"));
    await user.type(screen.getByDisplayValue(""), "Culvert repairs");

    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    expect(screen.getByTestId("panel-first-item-title")).toHaveTextContent("Culvert repairs");
  });

  it("saves the EDITED content, not the content it was mounted with", async () => {
    const user = userEvent.setup();
    const { onSave } = renderEditor();

    await user.clear(screen.getByDisplayValue("Road repairs"));
    await user.type(screen.getByDisplayValue(""), "Culvert repairs");
    await user.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const saved = onSave.mock.calls[0]![0] as MinutesContentJson;
    expect(saved.sections[0]!.items[0]!.title).toBe("Culvert repairs");
    expect(screen.getByText("Saved")).toBeInTheDocument();
  });

  it("edits a speaker's name in place", async () => {
    const user = userEvent.setup();
    const { onSave } = renderEditor();

    await user.clear(screen.getByDisplayValue("Jane Public"));
    await user.type(screen.getByDisplayValue(""), "Jane Q. Public");
    await user.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const saved = onSave.mock.calls[0]![0] as MinutesContentJson;
    expect(saved.sections[0]!.items[0]!.speakers[0]!.name).toBe("Jane Q. Public");
  });

  it("leaves the save status at Unsaved when the save is refused", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockRejectedValue(new Error("FORBIDDEN"));
    renderEditor(onSave);

    await user.clear(screen.getByDisplayValue("Road repairs"));
    await user.type(screen.getByDisplayValue(""), "Culvert repairs");
    await user.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Unsaved changes")).toBeInTheDocument();
  });

  it("selects a section and collapses it when its header is clicked", async () => {
    const user = userEvent.setup();
    renderEditor();

    expect(screen.getByTestId("panel-section-index")).toHaveTextContent("0");
    await user.click(screen.getByRole("button", { name: /Adjournment/ }));

    expect(screen.getByTestId("panel-section-index")).toHaveTextContent("1");
    // Collapsing hides the section's own body, including its "marked as none".
    expect(screen.queryByText("Marked as none.")).not.toBeInTheDocument();
  });

  it("auto-saves a dirty document after the 30-second interval", async () => {
    // `fireEvent`, not `userEvent`: the latter awaits real delays of its own
    // between keystrokes, and pairing that with fake timers deadlocks. The
    // interval is what is under test here, not the typing.
    vi.useFakeTimers();
    const { onSave } = renderEditor();

    fireEvent.change(screen.getByDisplayValue("Road repairs"), {
      target: { value: "Culvert repairs" },
    });
    expect(onSave).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });

    expect(onSave).toHaveBeenCalledTimes(1);
    const saved = onSave.mock.calls[0]![0] as MinutesContentJson;
    expect(saved.sections[0]!.items[0]!.title).toBe("Culvert repairs");
  });

  it("saves a dirty document on unmount — the clerk navigating away", async () => {
    const user = userEvent.setup();
    const { onSave, unmount } = renderEditor();

    await user.clear(screen.getByDisplayValue("Road repairs"));
    await user.type(screen.getByDisplayValue(""), "Culvert repairs");
    unmount();

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const saved = onSave.mock.calls[0]![0] as MinutesContentJson;
    expect(saved.sections[0]!.items[0]!.title).toBe("Culvert repairs");
  });

  it("does NOT save on unmount when nothing was edited", () => {
    const { onSave, unmount } = renderEditor();
    unmount();
    expect(onSave).not.toHaveBeenCalled();
  });
});
