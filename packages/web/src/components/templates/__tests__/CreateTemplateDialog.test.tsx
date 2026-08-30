/**
 * `CreateTemplateDialog`'s write and cache invalidation.
 *
 * Rewritten in this wave's whole-branch review: this dialog was still a raw,
 * tenancy-only Supabase insert — `agendaTemplate.insert`'s own doc comment
 * always claimed this dialog as a co-consumer alongside `handleClone`
 * (`boards.$boardId.templates.tsx`), but only `handleClone` was ever wired.
 * That left the "Create Template" button as the one live path in the product
 * that bypassed `agendaTemplate.insert`'s admin gate — the deployed schema's
 * `agenda_template_tenant_isolation` policy has no `is_admin()` predicate, so
 * nothing else was catching it. See `CreateTemplateDialog.tsx`'s own header
 * for the full account.
 *
 * Real options proxy, real `QueryClient` singleton, only `globalThis.fetch`
 * replaced (`installTRPCFetchStub`) — no Supabase mock needed any more, since
 * there is no more direct Supabase call in this file. Deleting the
 * `trpc.agendaTemplate.pathFilter()` line from `CreateTemplateDialog.tsx`
 * turns this file's second test red. Authorization (the admin gate
 * `agendaTemplate.insert` already carried) is NOT re-proven here —
 * conventions item 6 — see `agenda-template.test.ts`'s own `insert` suite for
 * that.
 */

import { describe, it, expect } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders, setupAppQueryClient } from "@/test/render";
import { installTRPCFetchStub, trpcTestError } from "@/test/trpc";
import { trpc } from "@/lib/trpc";
import { queryKeys } from "@/lib/queryKeys";

import { CreateTemplateDialog } from "../CreateTemplateDialog";

const queryClient = setupAppQueryClient();

/** Mutable so a test can change what the server returns between renders. */
const server = { insertRejects: false };

const stub = installTRPCFetchStub({
  "agendaTemplate.insert": (input) => {
    if (server.insertRejects) trpcTestError("FORBIDDEN");
    return { id: "new-template", name: input.name };
  },
});

async function create() {
  const listKey = trpc.agendaTemplate.list.queryOptions({ boardId: "b1" }).queryKey;
  queryClient.setQueryData(listKey, []);
  expect(queryClient.getQueryState(listKey)?.isInvalidated).toBeFalsy();

  const legacyKey = queryKeys.agendaTemplates.byBoard("b1");
  queryClient.setQueryData(legacyKey, []);
  expect(queryClient.getQueryState(legacyKey)?.isInvalidated).toBeFalsy();

  const { user } = renderWithProviders(
    <CreateTemplateDialog boardId="b1" open onOpenChange={() => {}} />,
    { queryClient },
  );

  await user.type(screen.getByLabelText("Template name"), "Special Session");
  await user.click(screen.getByRole("button", { name: "Create" }));
  await waitFor(() => expect(stub.countFor("agendaTemplate.insert")).toBe(1));
  expect(stub.calls[0]?.inputs["0"]).toMatchObject({
    boardId: "b1",
    name: "Special Session",
    isDefault: false,
  });

  return { listKey, legacyKey };
}

describe("CreateTemplateDialog", () => {
  it("creates through trpc.agendaTemplate.insert and invalidates the legacy agendaTemplates key", async () => {
    const { legacyKey } = await create();
    await waitFor(() => expect(queryClient.getQueryState(legacyKey)?.isInvalidated).toBe(true));
  });

  it("invalidates trpc.agendaTemplate.pathFilter() — the key boards.$boardId.templates.tsx reads under", async () => {
    const { listKey } = await create();
    await waitFor(() => expect(queryClient.getQueryState(listKey)?.isInvalidated).toBe(true));
  });

  /**
   * Regression pin for the bug this rewrite fixes: before it, a refused
   * write here (FORBIDDEN) was swallowed silently — no `onError`, nothing
   * on screen, the same silent-failure mode conventions item 5 exists to
   * end. `agendaTemplate.insert`'s admin gate can now genuinely fire for
   * this dialog, so the dialog must show something.
   */
  it("shows a message and stays open when the server refuses the write", async () => {
    server.insertRejects = true;
    try {
      const { user } = renderWithProviders(
        <CreateTemplateDialog boardId="b1" open onOpenChange={() => {}} />,
        { queryClient },
      );
      await user.type(screen.getByLabelText("Template name"), "Special Session");
      await user.click(screen.getByRole("button", { name: "Create" }));

      expect(
        await screen.findByText("Ask a town administrator to create a new template."),
      ).toBeInTheDocument();
      expect(screen.getByRole("alert")).toBeInTheDocument();
    } finally {
      server.insertRejects = false;
    }
  });
});
