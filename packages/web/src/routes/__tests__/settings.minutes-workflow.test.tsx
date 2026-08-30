/**
 * `settings.minutes-workflow.tsx`'s save mutation — cache invalidation.
 *
 * F1 from Task 2's review round: this screen writes
 * `minutes_workflow_configured_at`, one of `town.detail`'s own columns
 * (`settings.town.tsx`'s `ProgressChecklist` reads it back), but its save
 * mutation only ever invalidated the legacy `queryKeys.towns.detail` key.
 * Pinned here the same way `TownSealUpload.test.tsx` pins its two writers:
 * real options proxy, real `QueryClient`, `@/lib/supabase` mocked only
 * enough for this screen's own (unmigrated) read and write.
 */

import { describe, it, expect, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders, setupAppQueryClient } from "@/test/render";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { queryKeys } from "@/lib/queryKeys";

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ townId: "town-1" }),
}));

vi.mock("@/lib/supabase", () => {
  const chain: Record<string, unknown> = {};
  chain["single"] = () =>
    Promise.resolve({
      data: {
        audio_retention_policy: "retain_30_days",
        auto_publish_on_approval: false,
        minutes_review_window_days: 7,
        minutes_workflow_configured_at: null,
      },
      error: null,
    });
  chain["update"] = vi.fn().mockReturnValue({
    eq: vi.fn().mockResolvedValue({ error: null }),
  });
  for (const m of ["select", "eq"]) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  return { supabase: { from: vi.fn().mockReturnValue(chain) } };
});

import MinutesWorkflowSettingsPage from "../settings.minutes-workflow";

const queryClient = setupAppQueryClient();

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

async function save() {
  const legacyKey = queryKeys.towns.detail("town-1");
  const detailKey = trpc.town.detail.queryOptions().queryKey;
  queryClient.setQueryData(legacyKey, [{ id: "town-1" }]);
  queryClient.setQueryData(detailKey, fullTown);
  expect(queryClient.getQueryState(legacyKey)?.isInvalidated).toBeFalsy();
  expect(queryClient.getQueryState(detailKey)?.isInvalidated).toBeFalsy();

  const { user } = renderWithProviders(<MinutesWorkflowSettingsPage />, {
    route: "/settings/minutes-workflow",
    queryClient,
  });

  const saveButton = await screen.findByRole("button", { name: /save & complete setup/i });
  await user.click(saveButton);
  await screen.findByText("Settings saved");

  return { legacyKey, detailKey };
}

describe("settings.minutes-workflow save — cache invalidation", () => {
  it("invalidates the legacy towns-detail key", async () => {
    const { legacyKey } = await save();
    await waitFor(() => expect(queryClient.getQueryState(legacyKey)?.isInvalidated).toBe(true));
  });

  it("invalidates trpc.town.pathFilter() — town.detail's own key, since this write changes minutes_workflow_configured_at", async () => {
    const { detailKey } = await save();
    await waitFor(() => expect(queryClient.getQueryState(detailKey)?.isInvalidated).toBe(true));
  });
});
