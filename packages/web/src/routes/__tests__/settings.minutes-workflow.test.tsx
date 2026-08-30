/**
 * `settings.minutes-workflow.tsx` — `town.detail` / `town.updateMinutesWorkflow`
 * on tRPC.
 *
 * Same shape as `settings.town.test.tsx`: the real options proxy and real
 * `QueryClient` singleton run; only `globalThis.fetch` is replaced
 * (`installTRPCFetchStub`). `@/lib/supabase` is no longer mocked at all —
 * unlike `settings.town.tsx`, this screen has no remaining Supabase reads
 * (its only two calls, both now migrated, were the town-settings select and
 * the town-settings update).
 *
 * Carries forward F1's pin from the Task 2 fix round (both invalidations —
 * the legacy `queryKeys.towns.detail` key AND `trpc.town.pathFilter()` — must
 * fire on save), now against the real mutation instead of a Supabase mock.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders, setupAppQueryClient } from "@/test/render";
import { installTRPCFetchStub, trpcTestError } from "@/test/trpc";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { queryKeys } from "@/lib/queryKeys";
import { AudioRetentionPolicy } from "@town-meeting/shared";

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ townId: "town-1" }),
}));

const queryClient = setupAppQueryClient();

/** Mutable so a test can change what the server returns/does between calls. */
const server = {
  audio_retention_policy: AudioRetentionPolicy.RETAIN_30_DAYS as AudioRetentionPolicy,
  auto_publish_on_approval: false,
  minutes_review_window_days: 7,
  minutes_workflow_configured_at: null as string | null,
  detailRejects: false,
};

function fullTown(): RouterOutputs["town"]["detail"] {
  return {
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
    minutes_workflow_configured_at: server.minutes_workflow_configured_at,
    audio_retention_policy: server.audio_retention_policy,
    auto_publish_on_approval: server.auto_publish_on_approval,
    minutes_review_window_days: server.minutes_review_window_days,
  };
}

const stub = installTRPCFetchStub({
  "town.detail": () => {
    if (server.detailRejects) trpcTestError("NOT_FOUND");
    return fullTown();
  },
  "town.updateMinutesWorkflow": (input) => {
    server.audio_retention_policy = input.audio_retention_policy;
    server.auto_publish_on_approval = input.auto_publish_on_approval;
    server.minutes_review_window_days = input.minutes_review_window_days;
    server.minutes_workflow_configured_at ??= "2026-08-30T12:00:00.000Z";
    return {
      audio_retention_policy: server.audio_retention_policy,
      auto_publish_on_approval: server.auto_publish_on_approval,
      minutes_review_window_days: server.minutes_review_window_days,
      minutes_workflow_configured_at: server.minutes_workflow_configured_at,
    };
  },
});

import MinutesWorkflowSettingsPage from "../settings.minutes-workflow";

async function save() {
  const legacyKey = queryKeys.towns.detail("town-1");
  const detailKey = trpc.town.detail.queryOptions().queryKey;
  queryClient.setQueryData(legacyKey, [{ id: "town-1" }]);
  queryClient.setQueryData(detailKey, fullTown());
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

describe("settings.minutes-workflow", () => {
  beforeEach(() => {
    server.audio_retention_policy = "retain_30_days";
    server.auto_publish_on_approval = false;
    server.minutes_review_window_days = 7;
    server.minutes_workflow_configured_at = null;
    server.detailRejects = false;
  });

  it("shows the current settings once the read settles", async () => {
    renderWithProviders(<MinutesWorkflowSettingsPage />, {
      route: "/settings/minutes-workflow",
      queryClient,
    });
    expect(await screen.findByText("Retain 30 days")).toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: /save & complete setup/i }),
    ).toBeInTheDocument();
  });

  it("shows an error state when town.detail rejects, not an empty page", async () => {
    server.detailRejects = true;
    renderWithProviders(<MinutesWorkflowSettingsPage />, {
      route: "/settings/minutes-workflow",
      queryClient,
    });
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(await screen.findByText("This town's profile could not be found.")).toBeInTheDocument();
  });

  it("invalidates the legacy towns-detail key", async () => {
    const { legacyKey } = await save();
    await waitFor(() => expect(queryClient.getQueryState(legacyKey)?.isInvalidated).toBe(true));
  });

  // Not an `isInvalidated` assertion, unlike the legacy-key test above and
  // unlike `MeetingDefaultsEditor.test.tsx`'s copy of this pin: THIS screen
  // (unlike `MeetingDefaultsEditor`, a bare form with no query of its own)
  // actively observes `trpc.town.detail`'s query. Invalidating a key with a
  // live observer triggers an immediate refetch, which — resolving through
  // `installTRPCFetchStub`'s synchronous stub — clears `isInvalidated` back
  // to `false` before `waitFor` reliably observes the `true` in between, so
  // that assertion is flaky-to-outright-false here specifically BECAUSE the
  // invalidation worked. `settings.town.test.tsx`'s own
  // "refetches when a writer invalidates" test hits the identical shape and
  // uses the same fix: count the refetch instead of sampling the flag.
  it("invalidates trpc.town.pathFilter() — town.detail's own key, since this write changes minutes_workflow_configured_at", async () => {
    const { user } = renderWithProviders(<MinutesWorkflowSettingsPage />, {
      route: "/settings/minutes-workflow",
      queryClient,
    });
    const saveButton = await screen.findByRole("button", { name: /save & complete setup/i });
    const before = stub.countFor("town.detail");

    await user.click(saveButton);
    await screen.findByText("Settings saved");

    await waitFor(() => expect(stub.countFor("town.detail")).toBeGreaterThan(before));
  });
});
