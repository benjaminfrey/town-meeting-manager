/**
 * `DeleteTemplateDialog`'s cache invalidation.
 *
 * Wave 2, Task 2's fix round. A reviewer found this dialog was one of three
 * writers still invalidating only `queryKeys.agendaTemplates.byBoard` after
 * `boards.$boardId.templates.tsx`'s own list read moved onto
 * `trpc.agendaTemplate.list` — conventions item 7's "a read owns its key",
 * caught this time by `cache-key-parity.test.ts`'s new `agendaTemplates`
 * entry rather than a reviewer's grep. Deleting a template through this
 * dialog left it on screen for the full 60s `staleTime` before the fix.
 *
 * Same shape as `EditGovTitleDialog.test.tsx`: real options proxy, real
 * `QueryClient` singleton, only `globalThis.fetch` replaced
 * (`installTRPCFetchStub`); Supabase mocked at `@/hooks/useSupabase` for the
 * delete this dialog still performs directly (not migrated in this task).
 * Deleting the `trpc.agendaTemplate.pathFilter()` line from
 * `DeleteTemplateDialog.tsx` turns this file's second test red.
 */

import { describe, it, expect, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders, setupAppQueryClient } from "@/test/render";
import { installTRPCFetchStub } from "@/test/trpc";
import { trpc } from "@/lib/trpc";
import { queryKeys } from "@/lib/queryKeys";

const { deletes } = vi.hoisted(() => ({ deletes: [] as string[] }));

vi.mock("@/hooks/useSupabase", () => ({
  useSupabase: () => ({
    from: (table: string) => ({
      delete: () => ({
        eq: (_col: string, id: string) => {
          deletes.push(`${table}:${id}`);
          return Promise.resolve({ data: null, error: null });
        },
      }),
    }),
  }),
}));

import { DeleteTemplateDialog } from "../DeleteTemplateDialog";

const queryClient = setupAppQueryClient();

installTRPCFetchStub({});

const template = { id: "t1", name: "Standard Agenda", is_default: false };

async function remove() {
  const listKey = trpc.agendaTemplate.list.queryOptions({ boardId: "b1" }).queryKey;
  queryClient.setQueryData(listKey, [
    { id: "t1", name: "Standard Agenda", is_default: false, sections: [] },
  ]);
  expect(queryClient.getQueryState(listKey)?.isInvalidated).toBeFalsy();

  const legacyKey = queryKeys.agendaTemplates.byBoard("b1");
  queryClient.setQueryData(legacyKey, []);
  expect(queryClient.getQueryState(legacyKey)?.isInvalidated).toBeFalsy();

  const { user } = renderWithProviders(
    <DeleteTemplateDialog template={template} boardId="b1" open onOpenChange={() => {}} />,
    { queryClient },
  );

  await user.click(screen.getByRole("button", { name: /delete template/i }));
  await waitFor(() => expect(deletes).toContain("agenda_template:t1"));

  return { listKey, legacyKey };
}

describe("DeleteTemplateDialog", () => {
  it("deletes through Supabase and invalidates the legacy agendaTemplates key", async () => {
    const { legacyKey } = await remove();
    await waitFor(() => expect(queryClient.getQueryState(legacyKey)?.isInvalidated).toBe(true));
  });

  it("invalidates trpc.agendaTemplate.pathFilter() — the key boards.$boardId.templates.tsx reads under", async () => {
    const { listKey } = await remove();
    await waitFor(() => expect(queryClient.getQueryState(listKey)?.isInvalidated).toBe(true));
  });
});
