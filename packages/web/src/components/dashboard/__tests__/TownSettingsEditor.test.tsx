/**
 * `TownSettingsEditor`'s cache invalidation — the pin conventions item 8
 * requires in the same commit a writer's `pathFilter()` call lands.
 *
 * Real options proxy, real `QueryClient` singleton (`setupAppQueryClient`),
 * `globalThis.fetch` replaced by `installTRPCFetchStub` — see
 * `ArchiveBoardDialog.test.tsx` and `boards.$boardId.test.tsx` for the same
 * shape. Verified by mutation: deleting either
 * `queryClient.invalidateQueries(...)` line from `TownSettingsEditor.tsx`'s
 * `onSuccess` turns the matching test below red.
 */

import { describe, it, expect } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders, setupAppQueryClient } from "@/test/render";
import { installTRPCFetchStub } from "@/test/trpc";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { queryKeys } from "@/lib/queryKeys";
import { TownSettingsEditor } from "../TownSettingsEditor";

/**
 * A full `town.detail` row, `satisfies`-checked. `queryClient.setQueryData`
 * on `trpc.town.detail`'s own key is not covered by `installTRPCFetchStub`'s
 * `TestHandlers` inference (see that file's "floor" doc comment) — this is
 * the manual form conventions item 8 requires instead. A green vitest run
 * with a bare `{ id, name }` payload here compiled and passed; only
 * `npx turbo run typecheck --force` caught that it was missing 12 fields
 * `RouterOutputs["town"]["detail"]` actually has.
 */
const fullTown = {
  id: "town-1",
  name: "Newcastle",
  state: "ME",
  municipality_type: "town",
  population_range: "under_1000",
  contact_name: "Jamie Clerk",
  contact_role: "Town Clerk",
  meeting_formality: "semi_formal",
  minutes_style: "action",
  presiding_officer_default: "chair_of_board",
  minutes_recorder_default: "town_clerk",
  staff_roles_present: null,
  subdomain: "newcastle",
  seal_url: null,
  retention_policy_acknowledged_at: null,
  minutes_workflow_configured_at: null,
} satisfies RouterOutputs["town"]["detail"];

const queryClient = setupAppQueryClient();

const stub = installTRPCFetchStub({
  "town.updateProfile": (input) => input,
});

const initial = {
  name: "Newcastle",
  state: "ME" as const,
  municipality_type: "town" as const,
  population_range: "under_1000" as const,
  contact_name: "Jamie Clerk",
  contact_role: "Town Clerk",
};

async function save() {
  const legacyKey = queryKeys.towns.detail("town-1");
  const detailKey = trpc.town.detail.queryOptions().queryKey;
  queryClient.setQueryData(legacyKey, [{ id: "town-1" }]);
  queryClient.setQueryData(detailKey, fullTown);
  expect(queryClient.getQueryState(legacyKey)?.isInvalidated).toBeFalsy();
  expect(queryClient.getQueryState(detailKey)?.isInvalidated).toBeFalsy();

  const { user } = renderWithProviders(
    <TownSettingsEditor townId="town-1" initial={initial} onDone={() => {}} />,
    { queryClient },
  );

  await user.click(screen.getByRole("button", { name: /save/i }));
  await waitFor(() => expect(stub.countFor("town.updateProfile")).toBeGreaterThan(0));

  return { legacyKey, detailKey };
}

describe("TownSettingsEditor cache invalidation", () => {
  it("invalidates the legacy towns-detail key", async () => {
    const { legacyKey } = await save();
    await waitFor(() => expect(queryClient.getQueryState(legacyKey)?.isInvalidated).toBe(true));
  });

  it("invalidates trpc.town.pathFilter() — the key settings.town.tsx now reads under", async () => {
    const { detailKey } = await save();
    await waitFor(() => expect(queryClient.getQueryState(detailKey)?.isInvalidated).toBe(true));
  });
});
