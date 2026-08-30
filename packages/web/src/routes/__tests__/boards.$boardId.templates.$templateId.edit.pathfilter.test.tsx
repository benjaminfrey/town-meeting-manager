/**
 * `AgendaTemplateEditorPage`'s cache invalidation — the third writer.
 *
 * See `DeleteTemplateDialog.test.tsx`'s header — same finding, same fix
 * round. This route's own `TODO`-free doc comment (and the original version
 * of this task's file list) named it a legacy READER of
 * `queryKeys.agendaTemplates` only; it is also a WRITER (`handleSave`), and
 * the same gap applied: a rename here left `boards.$boardId.templates.tsx`'s
 * list stale for up to 60s. Deleting the `trpc.agendaTemplate.pathFilter()`
 * line from this route's `handleSave` turns this file's second test red.
 *
 * A separate, narrower file from the route's own (pre-existing, legacy-style
 * `vi.mock("@tanstack/react-query")`) test file — that file mocks `useQuery`
 * wholesale, which cannot produce real tRPC query keys to assert against
 * (see `test/trpc.ts`'s own header for why mocking the proxy instead of the
 * transport cannot catch this class of bug). This file uses the real options
 * proxy and only replaces `globalThis.fetch`, the same shape as
 * `boards.$boardId.test.tsx`. `@/lib/supabase` is mocked directly (this
 * route imports the client itself, not the `useSupabase()` hook) for the
 * two reads and the one write it still performs there.
 */

import { describe, it, expect, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders, setupAppQueryClient } from "@/test/render";
import { installTRPCFetchStub } from "@/test/trpc";
import { trpc } from "@/lib/trpc";
import { queryKeys } from "@/lib/queryKeys";

const { updates, reads } = vi.hoisted(() => ({ updates: [] as string[], reads: [] as string[] }));

vi.mock("@/lib/supabase", () => {
  const board = { id: "b1", name: "Select Board" };
  const template = {
    id: "t1",
    name: "Standard Agenda",
    sections: JSON.stringify([]),
  };

  // One real chain per call: `select`/`eq`/`single`/`update` all return
  // `this`, matching the route's own `.select(...).eq(...).single().throwOnError()`
  // / `.update(...).eq(...).throwOnError()` shapes — `throwOnError()` is the
  // one method actually awaited in every case, so it is the terminal
  // resolver, and it tells a read apart from the write by whether `update`
  // was called on THIS chain.
  function chainFor(table: string): Record<string, unknown> {
    let wasUpdate = false;
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: () => chain,
      single: () => chain,
      update: () => {
        wasUpdate = true;
        return chain;
      },
      throwOnError: () => {
        if (wasUpdate) {
          updates.push(table);
          return Promise.resolve({ data: null, error: null });
        }
        // Only `agenda_template`'s own read is relevant to the refetch this
        // test proves — a re-render also reissues the `board` read, but that
        // key is untouched by `handleSave`'s invalidations, so counting it
        // too would make the assertion pass even if the template refetch
        // never happened.
        if (table === "agenda_template") reads.push(table);
        return Promise.resolve({ data: table === "board" ? board : template, error: null });
      },
    };
    return chain;
  }

  return { supabase: { from: (table: string) => chainFor(table) } };
});

import AgendaTemplateEditorPage from "../boards.$boardId.templates.$templateId.edit";

const queryClient = setupAppQueryClient();

installTRPCFetchStub({});

async function save() {
  const listKey = trpc.agendaTemplate.list.queryOptions({ boardId: "b1" }).queryKey;
  queryClient.setQueryData(listKey, []);
  expect(queryClient.getQueryState(listKey)?.isInvalidated).toBeFalsy();

  const legacyDetailKey = queryKeys.agendaTemplates.detail("t1");
  // A realistic row, not `{}` — the route's own `useEffect` initializes its
  // local form state from whatever this key holds the moment it first
  // renders truthy (`staleTime: 0` still shows cached data before the
  // background refetch resolves), so an empty placeholder here would
  // "initialize" the form with a blank name before the real Supabase mock
  // ever answers, and the name input this test types into would never
  // exist.
  queryClient.setQueryData(legacyDetailKey, {
    id: "t1",
    name: "Standard Agenda",
    sections: JSON.stringify([]),
  });
  expect(queryClient.getQueryState(legacyDetailKey)?.isInvalidated).toBeFalsy();

  const { user } = renderWithProviders(
    <AgendaTemplateEditorPage
      {...({
        loaderData: { boardId: "b1", templateId: "t1" },
      } as Parameters<typeof AgendaTemplateEditorPage>[0])}
    />,
    { queryClient },
  );

  const nameInput = await screen.findByDisplayValue("Standard Agenda");
  await user.clear(nameInput);
  await user.type(nameInput, "Renamed Agenda");

  // Captured after the initial mount's own read, before the save click —
  // this route both READS `queryKeys.agendaTemplates.detail(templateId)`
  // (via its own `templateRow` query) AND is the WRITER invalidating it, so
  // unlike a separate dialog/screen pair, invalidating this key here
  // triggers TanStack Query's default `refetchType: "active"` refetch
  // immediately, and a SUCCESSFUL refetch clears `isInvalidated` back to
  // `false` before this test could ever observe it `true` — asserting on the
  // read count that refetch produces is the reliable pin, not the
  // transient boolean (see `readsBeforeSave` below).
  const readsBeforeSave = reads.length;

  await user.click(screen.getByRole("button", { name: /save/i }));
  await waitFor(() => expect(updates).toContain("agenda_template"));

  return { listKey, legacyDetailKey, readsBeforeSave };
}

describe("AgendaTemplateEditorPage cache invalidation", () => {
  it("saves through Supabase and invalidates the legacy agendaTemplates.detail key", async () => {
    const { readsBeforeSave } = await save();
    // `trpc.agendaTemplate.pathFilter()` cannot be what causes this: its
    // namespace (`["agendaTemplate", ...]`, tRPC's own) is structurally
    // disjoint from the legacy `queryKeys.agendaTemplates.detail(...)`
    // (`["agendaTemplates", ...]`) this page actually reads under — so a
    // refetch here can only be the legacy `invalidateQueries({ queryKey:
    // queryKeys.agendaTemplates.detail(templateId) })` call actually firing.
    await waitFor(() => expect(reads.length).toBeGreaterThan(readsBeforeSave));
  });

  it("invalidates trpc.agendaTemplate.pathFilter() — the key boards.$boardId.templates.tsx reads under", async () => {
    const { listKey } = await save();
    await waitFor(() => expect(queryClient.getQueryState(listKey)?.isInvalidated).toBe(true));
  });
});
