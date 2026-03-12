import React from "react";
import { vi, describe, it, expect, beforeEach } from "vitest";

// ─── Mock TanStack Query ───────────────────────────────────────────────

const { mockUseQuery } = vi.hoisted(() => ({
  mockUseQuery: vi.fn(),
}));

vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual("@tanstack/react-query");
  return {
    ...(actual as object),
    useQuery: (...args: unknown[]) => mockUseQuery(...args),
  };
});

// ─── Mock Supabase ─────────────────────────────────────────────────────

const { mockChain, mockFrom } = vi.hoisted(() => {
  const chain: Record<string, unknown> = {};
  chain["then"] = (resolve: any, reject?: any) =>
    Promise.resolve({ data: [], error: null }).then(resolve, reject);
  chain["catch"] = (reject: any) =>
    Promise.resolve({ data: [], error: null }).catch(reject as any);
  const methods = [
    "select", "insert", "update", "delete", "upsert",
    "eq", "neq", "in", "gte", "lte", "order", "limit",
    "single", "maybeSingle", "throwOnError", "or", "filter",
  ];
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  const mockFrom = vi.fn().mockReturnValue(chain);
  return { mockChain: chain as Record<string, ReturnType<typeof vi.fn>>, mockFrom };
});

vi.mock("@/lib/supabase", () => ({
  supabase: { from: mockFrom },
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

// ─── Helpers ──────────────────────────────────────────────────────────

function mockQueryResult<T>(data: T[]) {
  return { data, isLoading: false, isFetching: false, error: undefined };
}

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
  mockUseQuery.mockImplementation(({ queryKey }: { queryKey: readonly unknown[] }) => {
    const key = queryKey[0] as string;
    if (key === "boards") return { data: board ?? undefined, isLoading: false, isFetching: false, error: undefined };
    if (key === "agendaTemplates") return { data: template ?? undefined, isLoading: false, isFetching: false, error: undefined };
    return mockQueryResult([]);
  });
}

const defaultLoaderData = { boardId: "board-1", templateId: "template-1" };

// ─── Tests ───────────────────────────────────────────────────────────

describe("AgendaTemplateEditorPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFrom.mockReturnValue(mockChain);
    for (const m of ["select", "insert", "update", "delete", "eq", "neq", "order", "limit", "single", "throwOnError", "or", "filter", "upsert", "in", "maybeSingle"]) {
      if (typeof mockChain[m]?.mockReturnValue === "function") {
        mockChain[m].mockReturnValue(mockChain);
      }
    }
    mockUseQuery.mockReturnValue({ data: [], isLoading: false, isFetching: false, error: undefined });
  });

  it("renders loading state when template not yet loaded", () => {
    setupQueryMocks(createMockBoard(), null);

    renderWithProviders(
      <AgendaTemplateEditorPage {...{loaderData: defaultLoaderData} as any} />,
    );

    expect(screen.getByText("Loading template...")).toBeInTheDocument();
  });

  it("renders template name and breadcrumb when loaded", () => {
    setupQueryMocks(
      createMockBoard({ name: "Planning Board" }),
      createMockTemplate({ name: "Special Meeting" }),
    );

    renderWithProviders(
      <AgendaTemplateEditorPage {...{loaderData: defaultLoaderData} as any} />,
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
      <AgendaTemplateEditorPage {...{loaderData: defaultLoaderData} as any} />,
    );

    const saveButton = screen.getByRole("button", { name: /save/i });
    expect(saveButton).toBeDisabled();
  });

  it("marks form as dirty when template name changes", async () => {
    setupQueryMocks();

    const { user } = renderWithProviders(
      <AgendaTemplateEditorPage {...{loaderData: defaultLoaderData} as any} />,
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
      <AgendaTemplateEditorPage {...{loaderData: defaultLoaderData} as any} />,
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
      <AgendaTemplateEditorPage {...{loaderData: defaultLoaderData} as any} />,
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

  it("saves template via Supabase update", async () => {
    setupQueryMocks();

    const { user } = renderWithProviders(
      <AgendaTemplateEditorPage {...{loaderData: defaultLoaderData} as any} />,
    );

    // Make the form dirty by changing the name
    const nameInput = screen.getByDisplayValue("Regular Meeting");
    await user.clear(nameInput);
    await user.type(nameInput, "Updated Agenda");

    // Click save
    const saveButton = screen.getByRole("button", { name: /save/i });
    await user.click(saveButton);

    await waitFor(() => {
      expect(mockFrom).toHaveBeenCalledWith("agenda_template");
      expect(mockChain.update).toHaveBeenCalledWith(
        expect.objectContaining({ name: "Updated Agenda" }),
      );
      expect(mockChain.eq).toHaveBeenCalledWith("id", "template-1");
    });
  });

  it("selects section and shows detail panel", async () => {
    setupQueryMocks();

    const { user } = renderWithProviders(
      <AgendaTemplateEditorPage {...{loaderData: defaultLoaderData} as any} />,
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
