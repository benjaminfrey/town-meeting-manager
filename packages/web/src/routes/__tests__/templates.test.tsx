/**
 * `/templates` — the town-wide agenda-template overview, on
 * `trpc.agendaTemplate.listByTown`.
 *
 * Phase E, wave 4, Task 4. This screen had no test file at all before: its
 * read was a hand-written `["agendaTemplates", "byTown", townId]` key nothing
 * invalidated, and it had no error state, so a failed request rendered the
 * "No agenda templates yet" empty state. Both are covered below.
 *
 * `@/lib/trpc` is NOT mocked, only `globalThis.fetch` — which is what makes
 * the invalidation test real (conventions item 8): the four template writers
 * already call `trpc.agendaTemplate.pathFilter()`, and this test is the proof
 * that those calls now reach this screen.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders, setupAppQueryClient } from "@/test/render";
import { installTRPCFetchStub, trpcTestError } from "@/test/trpc";
import { trpc } from "@/lib/trpc";
import TemplatesPage from "../templates";

const queryClient = setupAppQueryClient();

type Row = { id: string; name: string; board_id: string | null; board_name: string | null };

const server = {
  rejects: false,
  rows: [] as Row[],
};

const stub = installTRPCFetchStub({
  "agendaTemplate.listByTown": () => {
    if (server.rejects) trpcTestError("INTERNAL_SERVER_ERROR");
    return server.rows;
  },
});

function renderPage() {
  return renderWithProviders(<TemplatesPage />, { queryClient, route: "/templates" });
}

describe("TemplatesPage", () => {
  beforeEach(() => {
    server.rejects = false;
    server.rows = [
      { id: "t1", name: "Assessors Regular", board_id: "b1", board_name: "Assessors" },
      { id: "t2", name: "Zoning Regular", board_id: "b2", board_name: "Zoning Board" },
    ];
  });

  it("groups templates under each board's name", async () => {
    renderPage();
    expect(await screen.findByText("Assessors")).toBeInTheDocument();
    expect(await screen.findByText("Zoning Board")).toBeInTheDocument();
    expect(await screen.findByText("Assessors Regular")).toBeInTheDocument();
  });

  it("renders a board-less template under Unassigned, with no Manage link", async () => {
    // `agenda_template.board_id` is nullable, and `listByTown`'s LEFT JOIN is
    // what keeps these rows in the answer at all.
    server.rows = [{ id: "t3", name: "Adrift Template", board_id: null, board_name: null }];
    renderPage();
    expect(await screen.findByText("Unassigned")).toBeInTheDocument();
    expect(await screen.findByText("Adrift Template")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Manage/ })).not.toBeInTheDocument();
  });

  it("shows the empty state when the town has no templates", async () => {
    server.rows = [];
    renderPage();
    expect(await screen.findByText("No agenda templates yet")).toBeInTheDocument();
  });

  it("shows a visible error instead of the empty state when the read fails", async () => {
    // The failure this screen used to render as "No agenda templates yet" —
    // conventions item 5.
    server.rejects = true;
    renderPage();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(
      await screen.findByText("Something went wrong loading agenda templates."),
    ).toBeInTheDocument();
    expect(screen.queryByText("No agenda templates yet")).not.toBeInTheDocument();
  });

  it("refetches when a template writer invalidates trpc.agendaTemplate.pathFilter()", async () => {
    renderPage();
    expect(await screen.findByText("Assessors Regular")).toBeInTheDocument();
    const before = stub.countFor("agendaTemplate.listByTown");

    server.rows = [{ id: "t1", name: "Renamed Template", board_id: "b1", board_name: "Assessors" }];
    await queryClient.invalidateQueries(trpc.agendaTemplate.pathFilter());

    await waitFor(() => expect(stub.countFor("agendaTemplate.listByTown")).toBeGreaterThan(before));
    expect(await screen.findByText("Renamed Template")).toBeInTheDocument();
  });
});
