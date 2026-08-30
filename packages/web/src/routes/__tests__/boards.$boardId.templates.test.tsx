/**
 * Agenda template list screen — `board.detail`/`agendaTemplate.*` on tRPC.
 *
 * Same shape as `boards.$boardId.test.tsx`: `@/lib/trpc` is NOT mocked, only
 * `globalThis.fetch` is replaced via `installTRPCFetchStub`, so a writer's
 * `trpc.agendaTemplate.pathFilter()` invalidation reaches this screen's real
 * query key. `CreateTemplateDialog`/`DeleteTemplateDialog` are rendered
 * (always mounted, closed by default) but never opened by these tests, so
 * their own `@/lib/supabase` writes are never exercised.
 */

import { describe, it, expect, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders, setupAppQueryClient } from "@/test/render";
import { installTRPCFetchStub, trpcTestError } from "@/test/trpc";
import { trpc } from "@/lib/trpc";
import { queryKeys } from "@/lib/queryKeys";
import AgendaTemplateListPage from "../boards.$boardId.templates";

// ─── Mock identity ──────────────────────────────────────────────────────

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ townId: "town-1" }),
}));

// ─── Harness ────────────────────────────────────────────────────────────

const queryClient = setupAppQueryClient();

const fixedSection = {
  title: "Call to Order",
  sort_order: 0,
  section_type: "procedural" as const,
  is_fixed: true,
  description: null,
  default_items: [],
  minutes_behavior: "timestamp_only" as const,
  show_item_commentary: false,
};

/** Mutable so a test can change what the server returns between renders. */
const server = {
  boardDetailRejects: false,
  insertForbidden: false,
  templates: [
    { id: "t1", name: "Standard Agenda", is_default: true, sections: [fixedSection] },
    { id: "t2", name: "Special Session", is_default: false, sections: [] },
  ] as { id: string; name: string; is_default: boolean; sections: unknown }[],
};

const stub = installTRPCFetchStub({
  "board.detail": () => {
    if (server.boardDetailRejects) trpcTestError("NOT_FOUND");
    return {
      id: "b1",
      name: "Select Board",
      board_type: "select_board",
      elected_or_appointed: "elected",
      member_count: 5,
      election_method: "at_large",
      officer_election_method: "vote_of_board",
      is_governing_board: true,
      meeting_formality_override: null,
      minutes_style_override: null,
      quorum_type: "simple_majority",
      quorum_value: null,
      motion_display_format: "inline_narrative",
      archived_at: null,
      created_at: "2026-01-01T00:00:00Z",
      notice_template_blocks: null,
      minutes_consent_agenda: false,
      minutes_requires_second: true,
      r4_board_member_default: true,
      audio_retention_policy_override: null,
      auto_publish_on_approval_override: null,
    };
  },
  "agendaTemplate.list": () => server.templates,
  "agendaTemplate.insert": (input) => {
    if (server.insertForbidden) trpcTestError("FORBIDDEN");
    return { id: "new-template", name: input.name };
  },
  "agendaTemplate.setDefault": (input) => ({ id: input.templateId, is_default: true }),
});

function renderRoute() {
  return renderWithProviders(
    <AgendaTemplateListPage
      {...({ loaderData: { boardId: "b1" } } as Parameters<typeof AgendaTemplateListPage>[0])}
    />,
    { route: "/boards/b1/templates", queryClient },
  );
}

describe("agenda template list", () => {
  it("shows the board's templates with their section counts", async () => {
    server.boardDetailRejects = false;
    server.templates = [
      { id: "t1", name: "Standard Agenda", is_default: true, sections: [fixedSection] },
      { id: "t2", name: "Special Session", is_default: false, sections: [] },
    ];
    renderRoute();

    expect(await screen.findByText("Standard Agenda")).toBeInTheDocument();
    expect(screen.getByText("1 section")).toBeInTheDocument();
    expect(screen.getByText("Special Session")).toBeInTheDocument();
    expect(screen.getByText("0 sections")).toBeInTheDocument();
  });

  it("shows an error state when board.detail rejects, not an empty page", async () => {
    server.boardDetailRejects = true;
    renderRoute();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(await screen.findByText("This board could not be found.")).toBeInTheDocument();
  });

  it("clones a template through trpc.agendaTemplate.insert with parsed sections, and invalidates both the legacy key and pathFilter()", async () => {
    server.boardDetailRejects = false;
    server.insertForbidden = false;
    server.templates = [
      { id: "t1", name: "Standard Agenda", is_default: true, sections: [fixedSection] },
    ];
    const legacyKey = queryKeys.agendaTemplates.byBoard("b1");
    queryClient.setQueryData(legacyKey, server.templates);
    expect(queryClient.getQueryState(legacyKey)?.isInvalidated).toBeFalsy();

    const { user } = renderRoute();
    await screen.findByText("Standard Agenda");
    const listCallsBefore = stub.countFor("agendaTemplate.list");
    await user.click(screen.getByRole("button", { name: "Clone" }));

    await waitFor(() => expect(stub.countFor("agendaTemplate.insert")).toBeGreaterThan(0));
    const call = stub.calls.find((c) => c.paths.includes("agendaTemplate.insert"));
    expect(call?.inputs["0"]).toMatchObject({
      boardId: "b1",
      name: "Copy of Standard Agenda",
      isDefault: false,
      sections: [fixedSection],
    });

    await waitFor(() => expect(queryClient.getQueryState(legacyKey)?.isInvalidated).toBe(true));
    // The `pathFilter()` half of `invalidateTemplates` — a real refetch of
    // this screen's own `agendaTemplate.list` read, not just the legacy key
    // above. Deleting the `trpc.agendaTemplate.pathFilter()` line from
    // `invalidateTemplates` would leave the legacy-key assertion above still
    // green (a separate `invalidateQueries` call), so that alone is not a
    // pin on the `pathFilter()` call — this is.
    await waitFor(() =>
      expect(stub.countFor("agendaTemplate.list")).toBeGreaterThan(listCallsBefore),
    );
  });

  it("sets a template as default through trpc.agendaTemplate.setDefault", async () => {
    server.boardDetailRejects = false;
    server.templates = [
      { id: "t1", name: "Standard Agenda", is_default: true, sections: [] },
      { id: "t2", name: "Special Session", is_default: false, sections: [] },
    ];
    const { user } = renderRoute();
    await screen.findByText("Special Session");

    await user.click(screen.getByRole("button", { name: "Set as default" }));

    await waitFor(() => expect(stub.countFor("agendaTemplate.setDefault")).toBe(1));
    expect(
      stub.calls.find((c) => c.paths.includes("agendaTemplate.setDefault"))?.inputs["0"],
    ).toEqual({ templateId: "t2" });
  });

  it("auto-creates a default template exactly once when the board has none", async () => {
    server.boardDetailRejects = false;
    server.insertForbidden = false;
    server.templates = [];
    renderRoute();

    await waitFor(() => expect(stub.countFor("agendaTemplate.insert")).toBe(1));
    const call = stub.calls.find((c) => c.paths.includes("agendaTemplate.insert"));
    expect(call?.inputs["0"]).toMatchObject({ boardId: "b1", isDefault: true });
  });

  it("shows a real explanation, not an eternal spinner, when a non-admin's auto-create is refused", async () => {
    // `agendaTemplate.insert` is admin-gated (Task 1's own design); the
    // Supabase insert this auto-create effect used to run was tenancy-only.
    // See this route's own `autoCreateError` doc comment.
    server.boardDetailRejects = false;
    server.insertForbidden = true;
    server.templates = [];
    renderRoute();

    expect(
      await screen.findByText(
        "Ask a town administrator to set up this board's first agenda template.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});
