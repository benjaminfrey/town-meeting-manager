/**
 * AgendaTemplateEditorPage — `agendaTemplate.detail`/`agendaTemplate.update`
 * on tRPC.
 *
 * Phase E wave 4, Task 0 wired this route onto the two procedures named in
 * its own `TODO(phase-e-wave-2)` marker. Previously two files covered this
 * route: this one (a legacy `vi.mock("@tanstack/react-query")` test — the
 * exact anti-pattern conventions item 8 warns against, since it cannot
 * produce real tRPC query keys) and a separate
 * `__tests__/boards.$boardId.templates.$templateId.edit.pathfilter.test.tsx`
 * that mocked `@/lib/supabase` directly for the (then-raw) read and write.
 * Both are rewritten and merged here, same shape as `boards.$boardId.test.tsx`:
 * `@/lib/trpc` is NOT mocked, only `globalThis.fetch` is replaced via
 * `installTRPCFetchStub`. The narrow `@/lib/supabase` mock that covered the
 * `board` breadcrumb read is gone as of wave 6, Task 5 — that read is
 * `trpc.board.detail` now, so this file mocks nothing but identity and
 * `sonner`.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders, setupAppQueryClient } from "@/test/render";
import { installTRPCFetchStub, trpcTestError } from "@/test/trpc";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { toast } from "sonner";
import AgendaTemplateEditorPage from "./boards.$boardId.templates.$templateId.edit";

// ─── Mock identity ──────────────────────────────────────────────────────

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ townId: "town-1" }),
}));

// Same shape `MemberArchiveDialog.test.tsx`/`AddPersonDialog.test.tsx` use —
// no `Toaster` is mounted by `renderWithProviders`, so asserting the toast
// fired means mocking the module and checking the call, not the DOM.
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// ─── Harness ────────────────────────────────────────────────────────────

const queryClient = setupAppQueryClient();

const fixedSections = [
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
];

/** Mutable so a test can change what the server returns between refetches. */
const server = {
  templateName: "Regular Meeting",
  sections: fixedSections as unknown[],
  detailRejects: false,
  updateForbidden: false,
};

// Collection scope, once per file — see `installTRPCFetchStub`'s doc comment.
/** A full `board.detail` row — only `name` is read (the breadcrumb). */
const boardDetail = {
  id: "board-1",
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
} satisfies RouterOutputs["board"]["detail"];

const stub = installTRPCFetchStub({
  "board.detail": () => boardDetail,
  "agendaTemplate.detail": () => {
    if (server.detailRejects) trpcTestError("NOT_FOUND");
    return { id: "template-1", name: server.templateName, sections: server.sections };
  },
  "agendaTemplate.update": (input) => {
    if (server.updateForbidden) trpcTestError("FORBIDDEN");
    server.templateName = input.name;
    server.sections = input.sections;
    return { id: input.templateId, name: input.name };
  },
});

const defaultLoaderData = { boardId: "board-1", templateId: "template-1" };

function renderRoute() {
  return renderWithProviders(
    <AgendaTemplateEditorPage
      {...({ loaderData: defaultLoaderData } as Parameters<typeof AgendaTemplateEditorPage>[0])}
    />,
    { route: "/boards/board-1/templates/template-1/edit", queryClient },
  );
}

describe("AgendaTemplateEditorPage", () => {
  beforeEach(() => {
    server.templateName = "Regular Meeting";
    server.sections = fixedSections;
    server.detailRejects = false;
    server.updateForbidden = false;
  });

  it("renders loading state before the template resolves", () => {
    // `queryClient` has no primed cache and the stub never settles
    // synchronously, so the very first render is the loading branch.
    renderRoute();
    expect(screen.getByText("Loading template...")).toBeInTheDocument();
  });

  it("shows an error state when agendaTemplate.detail rejects, not an empty page", async () => {
    server.detailRejects = true;
    renderRoute();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(await screen.findByText("This template could not be found.")).toBeInTheDocument();
  });

  it("renders template name and breadcrumb when loaded", async () => {
    renderRoute();

    expect(await screen.findByText("Boards")).toBeInTheDocument();
    expect(await screen.findByText("Select Board")).toBeInTheDocument();
    expect(await screen.findByText("Templates")).toBeInTheDocument();
    expect(await screen.findByDisplayValue("Regular Meeting")).toBeInTheDocument();
  });

  it("disables save button when not dirty", async () => {
    renderRoute();
    const saveButton = await screen.findByRole("button", { name: /save/i });
    expect(saveButton).toBeDisabled();
  });

  it("marks form as dirty when template name changes", async () => {
    const { user } = renderRoute();
    const nameInput = await screen.findByDisplayValue("Regular Meeting");
    await user.clear(nameInput);
    await user.type(nameInput, "Updated Meeting");

    expect(await screen.findByRole("button", { name: /save/i })).toBeEnabled();
  });

  it("adds a new section with default values", async () => {
    const { user } = renderRoute();
    expect(await screen.findByText("Old Business")).toBeInTheDocument();

    // The real `SectionListPanel` renders one row per section plus an "Add
    // Section" control — click through it rather than a mocked stand-in, so
    // this exercises the same component tree production renders.
    await user.click(screen.getByRole("button", { name: /add section/i }));

    expect(await screen.findByRole("button", { name: /save/i })).toBeEnabled();
  });

  it("selects a section and shows its detail panel", async () => {
    const { user } = renderRoute();
    // Index 0 ("Call to Order") is selected by default.
    expect(await screen.findByDisplayValue("Call to Order")).toBeInTheDocument();

    await user.click(screen.getByText("Old Business"));

    expect(await screen.findByDisplayValue("Old Business")).toBeInTheDocument();
  });

  it("removes a section and adjusts selected index", async () => {
    const { user } = renderRoute();
    expect(await screen.findByText("Old Business")).toBeInTheDocument();

    // "Old Business" (`is_fixed: false`) carries a remove button; "Call to
    // Order" (`is_fixed: true`) does not — `SectionListPanel` hides it for
    // fixed sections, so this is the only one on the page.
    await user.click(screen.getByRole("button", { name: /remove section/i }));

    await waitFor(() => expect(screen.queryByText("Old Business")).not.toBeInTheDocument());
    expect(screen.getByText("Call to Order")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /save/i })).toBeEnabled();
  });

  it("saves through agendaTemplate.update and invalidates trpc.agendaTemplate.pathFilter()", async () => {
    const listKey = trpc.agendaTemplate.list.queryOptions({ boardId: "board-1" }).queryKey;
    queryClient.setQueryData(listKey, []);
    expect(queryClient.getQueryState(listKey)?.isInvalidated).toBeFalsy();

    const { user } = renderRoute();
    const nameInput = await screen.findByDisplayValue("Regular Meeting");
    await user.clear(nameInput);
    await user.type(nameInput, "Updated Agenda");

    const before = stub.countFor("agendaTemplate.update");
    await user.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(stub.countFor("agendaTemplate.update")).toBeGreaterThan(before));
    // `trpc.agendaTemplate.pathFilter()` matches every procedure under the
    // `agendaTemplate` router, including `list` — the key
    // `boards.$boardId.templates.tsx` reads under.
    await waitFor(() => expect(queryClient.getQueryState(listKey)?.isInvalidated).toBe(true));
  });

  it("toasts an error and re-enables Save when agendaTemplate.update answers FORBIDDEN", async () => {
    // The case Minor 5 of Task 0's fix round names: a non-admin save now
    // reaches a real authorization gate (`agendaTemplate.update`'s
    // `requireActor`) instead of writing silently, and that refusal has to
    // be visible from the user's seat, not just re-enable a button with no
    // explanation.
    server.updateForbidden = true;
    const { user } = renderRoute();
    const nameInput = await screen.findByDisplayValue("Regular Meeting");
    await user.clear(nameInput);
    await user.type(nameInput, "Updated Agenda");

    const saveButton = screen.getByRole("button", { name: /save/i });
    await user.click(saveButton);

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Couldn't save the template — please try again."),
    );
    // The button re-enables (it was already doing this before this fix
    // round — the `finally` block always ran) and the form stays dirty, so
    // the user can retry without losing their edit.
    await waitFor(() => expect(saveButton).toBeEnabled());
  });

  it("refetches this screen's own read when a writer invalidates trpc.agendaTemplate.pathFilter()", async () => {
    // Proves `agendaTemplate.pathFilter()` also reaches THIS screen's own
    // `agendaTemplate.detail` read, not only `list`'s — the reasoning
    // `handleSave`'s own comment gives for why no separate `.detail(...)`
    // invalidation is needed any more. Asserted on the refetch count, not the
    // displayed name: the component's `useEffect` seeds local form state from
    // `templateRow` exactly once (guarded by its own `initialized` flag), by
    // design — a background refetch must not stomp an in-progress edit, so a
    // renamed-elsewhere server value is deliberately NOT expected to reach
    // the input.
    renderRoute();
    expect(await screen.findByDisplayValue("Regular Meeting")).toBeInTheDocument();
    const before = stub.countFor("agendaTemplate.detail");

    server.templateName = "Renamed Elsewhere";
    await queryClient.invalidateQueries(trpc.agendaTemplate.pathFilter());

    await waitFor(() => expect(stub.countFor("agendaTemplate.detail")).toBeGreaterThan(before));
  });

  it("names the board in the breadcrumb, through trpc.board.detail", async () => {
    // Wave 6, Task 5 — the file's last raw Supabase read.
    renderRoute();
    expect(await screen.findByText("Select Board")).toBeInTheDocument();
  });

  it("refetches the breadcrumb when a writer invalidates trpc.board.pathFilter()", async () => {
    renderRoute();
    await screen.findByText("Select Board");
    const before = stub.countFor("board.detail");

    await queryClient.invalidateQueries(trpc.board.pathFilter());

    await waitFor(() => expect(stub.countFor("board.detail")).toBeGreaterThan(before));
  });
});
