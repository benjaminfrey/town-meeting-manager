/**
 * `DeleteTemplateDialog`'s write and cache invalidation.
 *
 * Phase E, wave 2, Task 3 — the write itself moved onto
 * `trpc.agendaTemplate.delete` (admin-gated, already existed, had no caller
 * — see the dialog's own header). Real options proxy, real `QueryClient`
 * singleton, only `globalThis.fetch` replaced (`installTRPCFetchStub`); no
 * Supabase mock needed any more, since there is no more direct Supabase call
 * in this file.
 *
 * Wave 2, Task 2's fix round is why the LEGACY key is still pinned here too:
 * a reviewer found this dialog was one of three writers still invalidating
 * only `queryKeys.agendaTemplates.byBoard` after
 * `boards.$boardId.templates.tsx`'s own list read moved onto
 * `trpc.agendaTemplate.list` — conventions item 7's "a read owns its key".
 * Deleting the `trpc.agendaTemplate.pathFilter()` line from
 * `DeleteTemplateDialog.tsx` turns this file's second test red. Authorization
 * (the admin gate `agendaTemplate.delete` now carries) is NOT re-proven here
 * — conventions item 6 — see `agenda-template.test.ts`'s own `delete` suite
 * for that.
 */

import { describe, it, expect } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders, setupAppQueryClient } from "@/test/render";
import { installTRPCFetchStub } from "@/test/trpc";
import { trpc } from "@/lib/trpc";
import { queryKeys } from "@/lib/queryKeys";

import { DeleteTemplateDialog } from "../DeleteTemplateDialog";

const queryClient = setupAppQueryClient();

const stub = installTRPCFetchStub({
  "agendaTemplate.delete": (input) => ({ id: input.templateId }),
});

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
  await waitFor(() => expect(stub.countFor("agendaTemplate.delete")).toBe(1));
  expect(stub.calls[0]?.inputs["0"]).toMatchObject({ templateId: "t1" });

  return { listKey, legacyKey };
}

describe("DeleteTemplateDialog", () => {
  it("deletes through trpc.agendaTemplate.delete and invalidates the legacy agendaTemplates key", async () => {
    const { legacyKey } = await remove();
    await waitFor(() => expect(queryClient.getQueryState(legacyKey)?.isInvalidated).toBe(true));
  });

  it("invalidates trpc.agendaTemplate.pathFilter() — the key boards.$boardId.templates.tsx reads under", async () => {
    const { listKey } = await remove();
    await waitFor(() => expect(queryClient.getQueryState(listKey)?.isInvalidated).toBe(true));
  });
});
