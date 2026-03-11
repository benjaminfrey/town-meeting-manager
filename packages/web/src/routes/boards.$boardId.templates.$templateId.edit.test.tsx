import React from "react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { mockQueryResult } from "@/test/mocks/powersync-mock";

// ─── Mock PowerSync ───────────────────────────────────────────────────

const { mockDb, mockUseQuery } = vi.hoisted(() => {
  return {
    mockDb: {
      execute: vi.fn().mockResolvedValue({ rows: { _array: [] }, insertId: undefined, rowsAffected: 0 }),
      getAll: vi.fn().mockResolvedValue([]),
      getOptional: vi.fn().mockResolvedValue(null),
      get: vi.fn().mockResolvedValue(undefined),
      watch: vi.fn(),
      writeTransaction: vi.fn().mockImplementation(async (callback: any) => {
        const mockTx = {
          execute: vi.fn().mockResolvedValue({ rows: { _array: [] }, insertId: undefined, rowsAffected: 0 }),
          getAll: vi.fn().mockResolvedValue([]),
          getOptional: vi.fn().mockResolvedValue(null),
          get: vi.fn().mockResolvedValue(undefined),
        };
        await callback(mockTx);
      }),
      connected: true,
      currentStatus: { connected: true, hasSynced: true, dataFlowStatus: { uploading: false, downloading: false } },
    },
    mockUseQuery: vi.fn(),
  };
});

vi.mock("@powersync/react", () => ({
  useQuery: (...args: unknown[]) => mockUseQuery(...args),
  usePowerSync: vi.fn().mockReturnValue(mockDb),
  PowerSyncContext: { Provider: ({ children }: any) => children },
}));

// ─── Mock child components ────────────────────────────────────────────

vi.mock("@/components/templates/SectionListPanel", () => ({
  SectionListPanel: (props: any) => (
    <div data-testid="section-list-panel">
      <button data-testid="add-section" onClick={props.onAdd}>
        Add
      </button>
      <button data-testid="remove-section" onClick={() => props.onRemove(0)}>
        Remove
      </button>
      <button data-testid="select-section" onClick={() => props.onSelect(1)}>
        Select 1
      </button>
      <span data-testid="section-count">{props.sections.length}</span>
    </div>
  ),
}));

vi.mock("@/components/templates/SectionDetailPanel", () => ({
  SectionDetailPanel: (props: any) => (
    <div data-testid="section-detail-panel">
      <span data-testid="section-title">{props.section?.title}</span>
    </div>
  ),
}));

vi.mock("./+types/boards.$boardId.templates.$templateId.edit", () => ({}));

// ─── Import component and test utils after mocks ─────────────────────

import AgendaTemplateEditorPage from "./boards.$boardId.templates.$templateId.edit";
import { renderWithProviders, screen, waitFor } from "@/test/render";

// ─── Mock data factory ───────────────────────────────────────────────

function createMockBoard(overrides: Record<string, unknown> = {}) {
  return {
    id: "board-1",
    name: "Select Board",
    ...overrides,
  };
}

function createMockTemplate(overrides: Record<string, unknown> = {}) {
  return {
    id: "template-1",
    board_id: "board-1",
    name: "Regular Meeting",
    sections: JSON.stringify([
      {
        title: "Call to Order",
        sort_order: 0,
        section_type: "procedural",
        is_fixed: true,
        description: null,
        default_items: [],
        minutes_behavior: "summarize",
        show_item_commentary: false,
      },
      {
        title: "Old Business",
        sort_order: 1,
        section_type: "discussion",
        is_fixed: false,
        description: null,
        default_items: [],
        minutes_behavior: "summarize",
        show_item_commentary: false,
      },
    ]),
    is_default: 1,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function setupQueryMocks(
  board: Record<string, unknown> | null = createMockBoard(),
  template: Record<string, unknown> | null = createMockTemplate(),
) {
  mockUseQuery.mockImplementation(((sql: string) => {
    if (sql.includes("FROM boards")) {
      return mockQueryResult(board ? [board] : []);
    }
    if (sql.includes("FROM agenda_templates")) {
      return mockQueryResult(template ? [template] : []);
    }
    return mockQueryResult([]);
  }) as any);
}

const defaultLoaderData = { boardId: "board-1", templateId: "template-1" };

// ─── Tests ───────────────────────────────────────────────────────────

describe("AgendaTemplateEditorPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.execute.mockResolvedValue({
      rows: { _array: [] },
      insertId: undefined,
      rowsAffected: 1,
    });
    mockUseQuery.mockReturnValue({
      data: [],
      isLoading: false,
      isFetching: false,
      error: undefined,
    } as any);
  });

  it("renders loading state when template not yet loaded", () => {
    setupQueryMocks(createMockBoard(), null);

    renderWithProviders(
      <AgendaTemplateEditorPage loaderData={defaultLoaderData} />,
    );

    expect(screen.getByText("Loading template...")).toBeInTheDocument();
  });

  it("renders template name and breadcrumb when loaded", () => {
    setupQueryMocks(
      createMockBoard({ name: "Planning Board" }),
      createMockTemplate({ name: "Special Meeting" }),
    );

    renderWithProviders(
      <AgendaTemplateEditorPage loaderData={defaultLoaderData} />,
    );

    // Breadcrumb links
    expect(screen.getByText("Boards")).toBeInTheDocument();
    expect(screen.getByText("Planning Board")).toBeInTheDocument();
    expect(screen.getByText("Templates")).toBeInTheDocument();

    // Template name in the editable input
    const nameInput = screen.getByDisplayValue("Special Meeting");
    expect(nameInput).toBeInTheDocument();
  });

  it("disables save button when not dirty", () => {
    setupQueryMocks();

    renderWithProviders(
      <AgendaTemplateEditorPage loaderData={defaultLoaderData} />,
    );

    const saveButton = screen.getByRole("button", { name: /save/i });
    expect(saveButton).toBeDisabled();
  });

  it("marks form as dirty when template name changes", async () => {
    setupQueryMocks();

    const { user } = renderWithProviders(
      <AgendaTemplateEditorPage loaderData={defaultLoaderData} />,
    );

    const nameInput = screen.getByDisplayValue("Regular Meeting");
    await user.clear(nameInput);
    await user.type(nameInput, "Updated Meeting");

    const saveButton = screen.getByRole("button", { name: /save/i });
    expect(saveButton).toBeEnabled();
  });

  it("adds a new section with default values", async () => {
    setupQueryMocks();

    const { user } = renderWithProviders(
      <AgendaTemplateEditorPage loaderData={defaultLoaderData} />,
    );

    // Verify initial section count (2 sections from mock template)
    expect(screen.getByTestId("section-count")).toHaveTextContent("2");

    // Click the add button exposed by mock SectionListPanel
    await user.click(screen.getByTestId("add-section"));

    // Section count should increment
    expect(screen.getByTestId("section-count")).toHaveTextContent("3");

    // Save should now be enabled since adding a section marks dirty
    const saveButton = screen.getByRole("button", { name: /save/i });
    expect(saveButton).toBeEnabled();
  });

  it("removes a section and adjusts selected index", async () => {
    setupQueryMocks();

    const { user } = renderWithProviders(
      <AgendaTemplateEditorPage loaderData={defaultLoaderData} />,
    );

    expect(screen.getByTestId("section-count")).toHaveTextContent("2");

    // Remove the first section (index 0)
    await user.click(screen.getByTestId("remove-section"));

    // Section count should decrement
    expect(screen.getByTestId("section-count")).toHaveTextContent("1");

    // Save should be enabled after removal
    const saveButton = screen.getByRole("button", { name: /save/i });
    expect(saveButton).toBeEnabled();
  });

  it("saves template via powerSync.execute", async () => {
    setupQueryMocks();

    const { user } = renderWithProviders(
      <AgendaTemplateEditorPage loaderData={defaultLoaderData} />,
    );

    // Make the form dirty by changing the name
    const nameInput = screen.getByDisplayValue("Regular Meeting");
    await user.clear(nameInput);
    await user.type(nameInput, "Updated Agenda");

    // Click save
    const saveButton = screen.getByRole("button", { name: /save/i });
    await user.click(saveButton);

    await waitFor(() => {
      expect(mockDb.execute).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE agenda_templates SET name = ?"),
        expect.arrayContaining(["Updated Agenda", expect.any(String), "template-1"]),
      );
    });
  });

  it("selects section and shows detail panel", async () => {
    setupQueryMocks();

    const { user } = renderWithProviders(
      <AgendaTemplateEditorPage loaderData={defaultLoaderData} />,
    );

    // Initially the first section ("Call to Order") is selected (index 0)
    expect(screen.getByTestId("section-title")).toHaveTextContent(
      "Call to Order",
    );

    // Click to select the second section (index 1)
    await user.click(screen.getByTestId("select-section"));

    // The detail panel should now show the second section's title
    expect(screen.getByTestId("section-title")).toHaveTextContent(
      "Old Business",
    );
  });
});
