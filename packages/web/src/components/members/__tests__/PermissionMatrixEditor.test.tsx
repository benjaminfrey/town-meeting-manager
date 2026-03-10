import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PermissionMatrixEditor } from "../PermissionMatrixEditor";
import type { PermissionsMatrix } from "@town-meeting/shared";
import { PERMISSIONS, VIEW_ACTIONS } from "@town-meeting/shared";

// ─── Helpers ──────────────────────────────────────────────────────────

function emptyPerms(): PermissionsMatrix {
  return { global: {} as PermissionsMatrix["global"], board_overrides: [] };
}

function renderEditor(
  overrides: Partial<React.ComponentProps<typeof PermissionMatrixEditor>> = {},
) {
  const onChange = overrides.onChange ?? vi.fn();
  const onSelectedBoardIdsChange =
    overrides.onSelectedBoardIdsChange ?? vi.fn();

  return render(
    <PermissionMatrixEditor
      permissions={overrides.permissions ?? emptyPerms()}
      onChange={onChange}
      boards={overrides.boards ?? []}
      selectedBoardIds={overrides.selectedBoardIds ?? []}
      onSelectedBoardIdsChange={onSelectedBoardIdsChange}
    />,
  );
}

// ─── Tests ────────────────────────────────────────────────────────────

describe("PermissionMatrixEditor", () => {
  it("renders all 6 functional area group headers", () => {
    renderEditor();
    expect(screen.getByText("Town & System Management")).toBeInTheDocument();
    expect(screen.getByText("Agenda & Meeting Prep")).toBeInTheDocument();
    expect(screen.getByText("Live Meeting Operations")).toBeInTheDocument();
    expect(screen.getByText("Minutes & Records")).toBeInTheDocument();
    expect(screen.getByText("Civic Engagement")).toBeInTheDocument();
    expect(screen.getByText("View & Download")).toBeInTheDocument();
  });

  it("shows 'Admin only' for T1-T4 actions", () => {
    renderEditor();
    const adminLabels = screen.getAllByText("Admin only");
    expect(adminLabels.length).toBe(4);
    // T1-T4 codes should be visible
    expect(screen.getByText("T1")).toBeInTheDocument();
    expect(screen.getByText("T4")).toBeInTheDocument();
  });

  it("shows 'Always' for V1-V5 view actions", () => {
    renderEditor();
    const alwaysLabels = screen.getAllByText("Always");
    expect(alwaysLabels.length).toBe(5);
    expect(screen.getByText("V1")).toBeInTheDocument();
    expect(screen.getByText("V5")).toBeInTheDocument();
  });

  it("shows 'Board member only' for A4, A7, M8 actions", () => {
    renderEditor();
    const bmLabels = screen.getAllByText("Board member only");
    expect(bmLabels.length).toBe(3);
  });

  it("shows Denied state for toggleable action with no permission", () => {
    renderEditor();
    // A1 is toggleable and starts as "N" (Denied)
    expect(screen.getAllByText("Denied").length).toBeGreaterThan(0);
  });

  it("clicking a toggleable action calls onChange with updated permissions", async () => {
    const onChange = vi.fn();
    renderEditor({ onChange });

    const user = userEvent.setup();

    // Find the first "Denied" button and click it → should go N → Y
    const deniedButtons = screen.getAllByText("Denied");
    await user.click(deniedButtons[0]!);

    expect(onChange).toHaveBeenCalledTimes(1);
    const newPerms = onChange.mock.calls[0]![0] as PermissionsMatrix;
    // At least one global permission should be set to true
    const trueKeys = Object.entries(newPerms.global).filter(
      ([, v]) => v === true,
    );
    expect(trueKeys.length).toBeGreaterThan(0);
  });

  it("shows board selector when boards prop is non-empty", () => {
    renderEditor({
      boards: [
        { id: "b1", name: "Planning Board" },
        { id: "b2", name: "ZBA" },
      ],
    });
    expect(
      screen.getByText("Boards for board-specific permissions"),
    ).toBeInTheDocument();
    expect(screen.getByText("Planning Board")).toBeInTheDocument();
    expect(screen.getByText("ZBA")).toBeInTheDocument();
  });

  it("hides board selector when boards prop is empty", () => {
    renderEditor({ boards: [] });
    expect(
      screen.queryByText("Boards for board-specific permissions"),
    ).not.toBeInTheDocument();
  });
});
