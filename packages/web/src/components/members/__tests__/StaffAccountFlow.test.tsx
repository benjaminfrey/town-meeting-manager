/**
 * StaffAccountFlow — what actually gets PERSISTED.
 *
 * `handleBoardSelectionComplete` had no test, and it was broken: it queued
 * `setPermissions(prev => ({ ...prev, board_overrides }))` and then called
 * `onComplete({ permissions })` reading the CURRENT render's state, which does
 * not contain the overrides just computed. Every account created from a
 * `designated_boards` template was therefore written with global all-false AND
 * an empty `board_overrides` — no permissions at all — since 7d3aad6
 * (2026-03-10).
 *
 * So these tests assert on the ARGUMENT `onComplete` receives, not on what the
 * component renders. The rendered state was never the bug; the handed-off
 * value was, and it is the handed-off value the dialogs write to
 * `user_account.permissions`.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  TEMPLATE_BOARD_SPECIFIC_STAFF,
  TEMPLATE_RECORDING_SECRETARY,
  TEMPLATE_TOWN_CLERK,
  buildPermissionsFromTemplate,
  ALL_PERMISSION_ACTIONS,
} from "@town-meeting/shared";
import type { StaffAccountResult } from "../StaffAccountFlow";

const { BOARDS } = vi.hoisted(() => ({
  BOARDS: [
    { id: "board-planning", name: "Planning Board" },
    { id: "board-select", name: "Select Board" },
  ],
}));

vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual("@tanstack/react-query");
  return { ...(actual as object), useQuery: vi.fn().mockReturnValue({ data: BOARDS }) };
});

vi.mock("@/hooks/useSupabase", () => ({
  useSupabase: () => ({ from: vi.fn() }),
}));

// The matrix editor is step 2's whole UI and is tested on its own. Stubbed so
// these tests are about what leaves the flow, not about how it is edited.
vi.mock("../PermissionMatrixEditor", () => ({
  PermissionMatrixEditor: () => <div data-testid="matrix-editor" />,
}));

import { StaffAccountFlow } from "../StaffAccountFlow";

function renderFlow() {
  const onComplete = vi.fn<(result: StaffAccountResult) => void>();
  render(<StaffAccountFlow townId="town-1" onComplete={onComplete} onBack={vi.fn()} />);
  return onComplete;
}

/** Walk a designated_boards template through all three steps. */
function completeBoardScopedFlow(templateName: string, boardNames: string[]) {
  const onComplete = renderFlow();
  fireEvent.click(screen.getByText(templateName));
  fireEvent.click(screen.getByText("Select Boards"));
  for (const name of boardNames) {
    fireEvent.click(screen.getByText(name));
  }
  fireEvent.click(screen.getByText("Complete"));
  return onComplete;
}

describe("StaffAccountFlow — designated_boards templates", () => {
  beforeEach(() => vi.clearAllMocks());

  it("hands onComplete the board overrides it just built, not the pre-update state", () => {
    const onComplete = completeBoardScopedFlow(TEMPLATE_BOARD_SPECIFIC_STAFF.name, [
      "Planning Board",
    ]);

    expect(onComplete).toHaveBeenCalledTimes(1);
    const result = onComplete.mock.calls[0]![0];

    // The regression, stated directly: this array was empty.
    expect(result.permissions.board_overrides).toHaveLength(1);
    const override = result.permissions.board_overrides[0]!;
    expect(override.board_id).toBe("board-planning");

    // Every action the template grants, and nothing else. Keys are NAMES —
    // `buildPermissionsFromTemplate` returns `Record<PermissionAction, boolean>`
    // — which is the spelling `normalisePermissionsMatrix` has to accept on the
    // API side.
    expect(Object.keys(override.permissions).sort()).toEqual(
      [...TEMPLATE_BOARD_SPECIFIC_STAFF.permissions].sort(),
    );
    for (const action of TEMPLATE_BOARD_SPECIFIC_STAFF.permissions) {
      expect(override.permissions[action]).toBe(true);
    }

    // Global stays all-false: for this template the grant lives entirely in
    // the override, which is why the API must resolve these codes per board.
    for (const action of ALL_PERMISSION_ACTIONS) {
      expect(result.permissions.global[action]).toBe(false);
    }
  });

  it("writes one override per selected board", () => {
    const onComplete = completeBoardScopedFlow(TEMPLATE_RECORDING_SECRETARY.name, [
      "Planning Board",
      "Select Board",
    ]);

    const result = onComplete.mock.calls[0]![0];
    expect(result.permissions.board_overrides.map((o) => o.board_id)).toEqual([
      "board-planning",
      "board-select",
    ]);
    for (const override of result.permissions.board_overrides) {
      expect(Object.keys(override.permissions).sort()).toEqual(
        [...TEMPLATE_RECORDING_SECRETARY.permissions].sort(),
      );
    }
  });

  it("still hands an all_boards template its GLOBAL grants, with no overrides", () => {
    const onComplete = renderFlow();
    fireEvent.click(screen.getByText(TEMPLATE_TOWN_CLERK.name));
    fireEvent.click(screen.getByText("Complete"));

    const result = onComplete.mock.calls[0]![0];
    expect(result.permissions.board_overrides).toEqual([]);
    expect(result.permissions.global).toEqual(buildPermissionsFromTemplate(TEMPLATE_TOWN_CLERK));
  });
});
