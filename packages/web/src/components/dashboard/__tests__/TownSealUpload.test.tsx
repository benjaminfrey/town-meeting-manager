/**
 * `TownSealUpload`'s cache invalidation — the F1 finding from Task 2's
 * review round. Both mutations here write through `apiJson` (a REST call,
 * not tRPC — see the component's own header comment for why), but they
 * still invalidate `trpc.town.pathFilter()`: `sealUrl` is `town.detail`'s
 * own `seal_url` column, and this component is rendered by
 * `settings.town.tsx` itself. Before this pin, neither mutation invalidated
 * that key at all — a successful upload or removal left the seal preview
 * stale on the very screen the user was looking at, for up to 60s.
 *
 * Real options proxy, real `QueryClient` (`setupAppQueryClient`); only
 * `apiJson` is mocked (`@/lib/api-client`), the same way `ArchiveBoardDialog`
 * mocks `useSupabase` — the write transport is not what this pin is about.
 */

import { describe, it, expect, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders, setupAppQueryClient } from "@/test/render";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { queryKeys } from "@/lib/queryKeys";

const { calls } = vi.hoisted(() => ({ calls: [] as string[] }));

vi.mock("@/lib/api-client", () => ({
  apiJson: vi.fn(async (path: string, opts?: { method?: string }) => {
    calls.push(`${opts?.method ?? "GET"} ${path}`);
    return { sealUrl: "https://example.test/seal.png" };
  }),
}));

import { TownSealUpload } from "../TownSealUpload";

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

function seedKeys() {
  const legacyKey = queryKeys.towns.detail("town-1");
  const detailKey = trpc.town.detail.queryOptions().queryKey;
  queryClient.setQueryData(legacyKey, [{ id: "town-1" }]);
  queryClient.setQueryData(detailKey, fullTown);
  expect(queryClient.getQueryState(legacyKey)?.isInvalidated).toBeFalsy();
  expect(queryClient.getQueryState(detailKey)?.isInvalidated).toBeFalsy();
  return { legacyKey, detailKey };
}

describe("TownSealUpload cache invalidation — upload", () => {
  async function upload() {
    calls.length = 0;
    const keys = seedKeys();
    const { user } = renderWithProviders(<TownSealUpload townId="town-1" sealUrl={null} />, {
      queryClient,
    });

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["fake-png-bytes"], "seal.png", { type: "image/png" });
    await user.upload(input, file);
    await waitFor(() => expect(calls).toContain("POST /api/files/town-seal"));

    return keys;
  }

  it("invalidates the legacy towns-detail key", async () => {
    const { legacyKey } = await upload();
    await waitFor(() => expect(queryClient.getQueryState(legacyKey)?.isInvalidated).toBe(true));
  });

  it("invalidates trpc.town.pathFilter() — the key settings.town.tsx now reads under", async () => {
    const { detailKey } = await upload();
    await waitFor(() => expect(queryClient.getQueryState(detailKey)?.isInvalidated).toBe(true));
  });
});

describe("TownSealUpload cache invalidation — remove", () => {
  async function remove() {
    calls.length = 0;
    const keys = seedKeys();
    const { user } = renderWithProviders(
      <TownSealUpload townId="town-1" sealUrl="https://example.test/current-seal.png" />,
      { queryClient },
    );

    await user.click(screen.getByRole("button", { name: /remove/i }));
    await waitFor(() => expect(calls).toContain("DELETE /api/files/town-seal"));

    return keys;
  }

  it("invalidates the legacy towns-detail key", async () => {
    const { legacyKey } = await remove();
    await waitFor(() => expect(queryClient.getQueryState(legacyKey)?.isInvalidated).toBe(true));
  });

  it("invalidates trpc.town.pathFilter() — the key settings.town.tsx now reads under", async () => {
    const { detailKey } = await remove();
    await waitFor(() => expect(queryClient.getQueryState(detailKey)?.isInvalidated).toBe(true));
  });
});
