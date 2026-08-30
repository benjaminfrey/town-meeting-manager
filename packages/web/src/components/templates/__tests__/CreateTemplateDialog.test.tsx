/**
 * `CreateTemplateDialog`'s cache invalidation.
 *
 * See `DeleteTemplateDialog.test.tsx`'s header — same finding, same fix
 * round, the second of three writers still keyed off the legacy
 * `queryKeys.agendaTemplates` alone. A template created here was missing
 * from `boards.$boardId.templates.tsx`'s list on back-navigation for up to
 * the 60s `staleTime` before the fix. Deleting the
 * `trpc.agendaTemplate.pathFilter()` line from `CreateTemplateDialog.tsx`
 * turns this file's second test red.
 */

import { describe, it, expect, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders, setupAppQueryClient } from "@/test/render";
import { installTRPCFetchStub } from "@/test/trpc";
import { trpc } from "@/lib/trpc";
import { queryKeys } from "@/lib/queryKeys";

const { inserts } = vi.hoisted(() => ({ inserts: [] as string[] }));

vi.mock("@/hooks/useSupabase", () => ({
  useSupabase: () => ({
    from: (table: string) => ({
      insert: () => {
        inserts.push(table);
        return Promise.resolve({ data: null, error: null });
      },
    }),
  }),
}));

import { CreateTemplateDialog } from "../CreateTemplateDialog";

const queryClient = setupAppQueryClient();

installTRPCFetchStub({});

async function create() {
  const listKey = trpc.agendaTemplate.list.queryOptions({ boardId: "b1" }).queryKey;
  queryClient.setQueryData(listKey, []);
  expect(queryClient.getQueryState(listKey)?.isInvalidated).toBeFalsy();

  const legacyKey = queryKeys.agendaTemplates.byBoard("b1");
  queryClient.setQueryData(legacyKey, []);
  expect(queryClient.getQueryState(legacyKey)?.isInvalidated).toBeFalsy();

  const { user } = renderWithProviders(
    <CreateTemplateDialog boardId="b1" townId="town-1" open onOpenChange={() => {}} />,
    { queryClient },
  );

  await user.type(screen.getByLabelText("Template name"), "Special Session");
  await user.click(screen.getByRole("button", { name: "Create" }));
  await waitFor(() => expect(inserts).toContain("agenda_template"));

  return { listKey, legacyKey };
}

describe("CreateTemplateDialog", () => {
  it("inserts through Supabase and invalidates the legacy agendaTemplates key", async () => {
    const { legacyKey } = await create();
    await waitFor(() => expect(queryClient.getQueryState(legacyKey)?.isInvalidated).toBe(true));
  });

  it("invalidates trpc.agendaTemplate.pathFilter() — the key boards.$boardId.templates.tsx reads under", async () => {
    const { listKey } = await create();
    await waitFor(() => expect(queryClient.getQueryState(listKey)?.isInvalidated).toBe(true));
  });
});
