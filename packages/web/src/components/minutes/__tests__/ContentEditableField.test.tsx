/**
 * `components/minutes/ContentEditableField.tsx` — the rich-text field the
 * minutes editor's discussion summaries are written in.
 *
 * Phase E, wave 6, Task 3. First test file this component has ever had.
 *
 * `document.execCommand` and `document.queryCommandState` do not exist in
 * jsdom at all, so both are installed here as spies. That is not a shortcut
 * around the component: the assertions are about what this component DOES
 * with them — that the toolbar delegates to the right command, that it
 * refuses to when disabled, and that a command's result is published through
 * `onChange` — and none of that is reachable without them.
 *
 * The one behaviour worth pinning beyond the toolbar is the `isInternalChange`
 * guard: the field writes `innerHTML` from its `value` prop, so without that
 * ref a re-render caused by the field's own keystroke would overwrite what the
 * user just typed, and the caret with it.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ContentEditableField } from "../ContentEditableField";

const execCommand = vi.fn().mockReturnValue(true);
const queryCommandState = vi.fn().mockReturnValue(false);

beforeEach(() => {
  execCommand.mockClear();
  queryCommandState.mockClear().mockReturnValue(false);
  Object.defineProperty(document, "execCommand", {
    configurable: true,
    writable: true,
    value: execCommand,
  });
  Object.defineProperty(document, "queryCommandState", {
    configurable: true,
    writable: true,
    value: queryCommandState,
  });
});

afterEach(() => {
  Reflect.deleteProperty(document, "execCommand");
  Reflect.deleteProperty(document, "queryCommandState");
});

/** The `contentEditable` div — it has no role, so it is found structurally. */
function editableOf(container: HTMLElement): HTMLElement {
  const el = container.querySelector('[contenteditable="true"], [contenteditable="false"]');
  if (!el) throw new Error("no contenteditable element rendered");
  return el as HTMLElement;
}

describe("ContentEditableField", () => {
  it("renders the value it is given as HTML, not as text", () => {
    const { container } = render(
      <ContentEditableField value="<b>Culvert</b> repairs" onChange={vi.fn()} />,
    );
    expect(editableOf(container).innerHTML).toBe("<b>Culvert</b> repairs");
    expect(screen.getByText("Culvert").tagName).toBe("B");
  });

  it("publishes the field's HTML on input", () => {
    const onChange = vi.fn();
    const { container } = render(<ContentEditableField value="" onChange={onChange} />);

    const editable = editableOf(container);
    editable.innerHTML = "<p>Discussed the culvert.</p>";
    fireEvent.input(editable);

    expect(onChange).toHaveBeenCalledWith("<p>Discussed the culvert.</p>");
  });

  it("does NOT overwrite the field on the re-render its own keystroke causes", () => {
    const onChange = vi.fn();
    const { container, rerender } = render(
      <ContentEditableField value="Old" onChange={onChange} />,
    );

    const editable = editableOf(container);
    editable.innerHTML = "Old and new";
    fireEvent.input(editable);

    // The parent applies what `onChange` reported, which is what
    // `MinutesEditor` does — the effect re-runs, sees its own change, and
    // leaves the caret alone.
    rerender(<ContentEditableField value="Old and new" onChange={onChange} />);
    expect(editable.innerHTML).toBe("Old and new");

    // A later value from somewhere else still wins.
    rerender(<ContentEditableField value="Replaced upstream" onChange={onChange} />);
    expect(editable.innerHTML).toBe("Replaced upstream");
  });

  /**
   * A PASSING pin on behaviour that is arguably wrong, so that fixing it is a
   * deliberate change rather than a silent one (the shape `exhibit.test.ts`
   * uses for rule 14's board-blind branch).
   *
   * `isInternalChange` is consumed by the `value` effect, and that effect only
   * runs when `value` CHANGES. So if a parent reports an edit and then renders
   * the SAME value it had before — rejecting the edit, or simply not applying
   * it — the flag survives, and the next genuine external value is swallowed.
   * `MinutesEditor`, this component's only caller, always applies the edit, so
   * nothing reaches this today.
   */
  it("swallows the next external value when the parent did NOT apply the edit (known quirk)", () => {
    const onChange = vi.fn();
    const { container, rerender } = render(
      <ContentEditableField value="Old" onChange={onChange} />,
    );

    const editable = editableOf(container);
    editable.innerHTML = "Old and new";
    fireEvent.input(editable);

    rerender(<ContentEditableField value="Old" onChange={onChange} />); // unchanged: no effect run
    rerender(<ContentEditableField value="Replaced upstream" onChange={onChange} />);

    expect(editable.innerHTML).toBe("Old and new");
  });

  it("runs the matching command for each toolbar button", async () => {
    const user = userEvent.setup();
    render(<ContentEditableField value="" onChange={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Bold" }));
    await user.click(screen.getByRole("button", { name: "Italic" }));
    await user.click(screen.getByRole("button", { name: "Unordered List" }));

    expect(execCommand.mock.calls.map((c) => c[0])).toEqual([
      "bold",
      "italic",
      "insertUnorderedList",
    ]);
  });

  it("publishes the result of a toolbar command through onChange", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { container } = render(<ContentEditableField value="" onChange={onChange} />);

    execCommand.mockImplementation(() => {
      editableOf(container).innerHTML = "<b>bolded</b>";
      return true;
    });
    await user.click(screen.getByRole("button", { name: "Bold" }));

    expect(onChange).toHaveBeenCalledWith("<b>bolded</b>");
  });

  it("runs nothing and accepts no input when disabled", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { container } = render(
      <ContentEditableField value="Locked" onChange={onChange} disabled />,
    );

    expect(editableOf(container)).toHaveAttribute("contenteditable", "false");
    // `pointer-events: none` on a disabled Radix button makes a real click
    // impossible, so the click is dispatched directly to prove the handler
    // itself refuses — the `if (disabled) return` in `execCommand`.
    fireEvent.click(screen.getByRole("button", { name: "Bold" }));
    await user.click(document.body);

    expect(execCommand).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("reflects the active formats the selection reports", () => {
    queryCommandState.mockImplementation((command: string) => command === "bold");
    const { container } = render(<ContentEditableField value="" onChange={vi.fn()} />);

    // Fired on the editable area, which is where `onKeyUp` lives — the
    // toolbar buttons carry no such handler, so firing at one of those would
    // assert nothing.
    fireEvent.keyUp(editableOf(container));

    // The active class is the bare token. `toContain` would also match the
    // base button's own `hover:bg-accent` and pass with the feature deleted.
    const classesOf = (name: string) => screen.getByRole("button", { name }).className.split(/\s+/);
    expect(classesOf("Bold")).toContain("bg-accent");
    expect(classesOf("Italic")).not.toContain("bg-accent");
  });

  it("renders the placeholder as an attribute the empty-state CSS reads", () => {
    const { container } = render(
      <ContentEditableField
        value=""
        onChange={vi.fn()}
        placeholder="Enter discussion summary..."
      />,
    );
    expect(editableOf(container)).toHaveAttribute(
      "data-placeholder",
      "Enter discussion summary...",
    );
  });
});
