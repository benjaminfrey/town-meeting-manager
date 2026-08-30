/**
 * `RetentionPolicyModal`'s cache invalidation — see
 * `TownSettingsEditor.test.tsx` for the pattern this copies and why.
 *
 * No form fields here — the button is always enabled, so `save()` is just a
 * click.
 */

import { describe, it, expect } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders, setupAppQueryClient } from "@/test/render";
import { installTRPCFetchStub } from "@/test/trpc";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { queryKeys } from "@/lib/queryKeys";
import { RetentionPolicyModal } from "../RetentionPolicyModal";

/**
 * A full `town.detail` row, `satisfies`-checked — see
 * `TownSettingsEditor.test.tsx`'s copy of this comment for why a bare
 * `{ id, name }` payload here is a defect vitest cannot see.
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
  "town.acknowledgeRetentionPolicy": () => ({
    retention_policy_acknowledged_at: "2026-08-29T00:00:00.000Z",
  }),
});

async function acknowledge() {
  const legacyKey = queryKeys.towns.detail("town-1");
  const detailKey = trpc.town.detail.queryOptions().queryKey;
  queryClient.setQueryData(legacyKey, [{ id: "town-1" }]);
  queryClient.setQueryData(detailKey, fullTown);
  expect(queryClient.getQueryState(legacyKey)?.isInvalidated).toBeFalsy();
  expect(queryClient.getQueryState(detailKey)?.isInvalidated).toBeFalsy();

  const { user } = renderWithProviders(
    <RetentionPolicyModal townId="town-1" open onOpenChange={() => {}} />,
    { queryClient },
  );

  await user.click(screen.getByRole("button", { name: /i acknowledge this retention policy/i }));
  await waitFor(() =>
    expect(stub.countFor("town.acknowledgeRetentionPolicy")).toBeGreaterThan(0),
  );

  return { legacyKey, detailKey };
}

describe("RetentionPolicyModal cache invalidation", () => {
  it("invalidates the legacy towns-detail key", async () => {
    const { legacyKey } = await acknowledge();
    await waitFor(() => expect(queryClient.getQueryState(legacyKey)?.isInvalidated).toBe(true));
  });

  it("invalidates trpc.town.pathFilter() — the key settings.town.tsx now reads under", async () => {
    const { detailKey } = await acknowledge();
    await waitFor(() => expect(queryClient.getQueryState(detailKey)?.isInvalidated).toBe(true));
  });
});
