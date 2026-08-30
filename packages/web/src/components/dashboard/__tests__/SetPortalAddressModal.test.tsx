/**
 * `SetPortalAddressModal`'s cache invalidation, and the split between the
 * client-side courtesy check and the server's actual enforcement — see
 * `RetentionPolicyModal.test.tsx` for the invalidation pattern this copies
 * and `TownSettingsEditor.test.tsx` for why a bare fixture is not enough
 * (`satisfies`-checked payloads throughout).
 */

import { describe, it, expect } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders, setupAppQueryClient } from "@/test/render";
import { installTRPCFetchStub, trpcTestError } from "@/test/trpc";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { queryKeys } from "@/lib/queryKeys";
import { SetPortalAddressModal } from "../SetPortalAddressModal";

/**
 * A full `town.detail` row, `satisfies`-checked — see
 * `RetentionPolicyModal.test.tsx`'s copy of this comment for why a bare
 * `{ id, name }` payload here is a defect vitest cannot see (it is one
 * `tsc` DID catch here, on the first typecheck run — see the task report).
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
  audio_retention_policy: "retain_30_days",
  auto_publish_on_approval: false,
  minutes_review_window_days: 7,
} satisfies RouterOutputs["town"]["detail"];

const queryClient = setupAppQueryClient();

/** Mutable so a test can make the mutation answer CONFLICT. */
const server = { conflicts: false };

const stub = installTRPCFetchStub({
  "town.setPortalAddress": (input) => {
    if (server.conflicts) trpcTestError("CONFLICT");
    return { subdomain: input.subdomain };
  },
});

function renderModal(onOpenChange = () => {}) {
  return renderWithProviders(
    <SetPortalAddressModal
      townId="town-1"
      currentSubdomain="newcastle"
      open
      onOpenChange={onOpenChange}
    />,
    { queryClient },
  );
}

async function save(user: ReturnType<typeof renderModal>["user"], value: string) {
  const input = await screen.findByLabelText("Portal address");
  await user.clear(input);
  await user.type(input, value);
  await user.click(screen.getByRole("button", { name: "Save" }));
}

describe("SetPortalAddressModal cache invalidation", () => {
  it("invalidates the legacy towns-detail key on success", async () => {
    server.conflicts = false;
    const legacyKey = queryKeys.towns.detail("town-1");
    queryClient.setQueryData(legacyKey, [{ id: "town-1" }]);
    expect(queryClient.getQueryState(legacyKey)?.isInvalidated).toBeFalsy();

    const { user } = renderModal();
    await save(user, "harbortown");
    await waitFor(() => expect(stub.countFor("town.setPortalAddress")).toBeGreaterThan(0));

    await waitFor(() => expect(queryClient.getQueryState(legacyKey)?.isInvalidated).toBe(true));
  });

  it("invalidates trpc.town.pathFilter() — the key settings.town.tsx now reads under", async () => {
    server.conflicts = false;
    const detailKey = trpc.town.detail.queryOptions().queryKey;
    queryClient.setQueryData(detailKey, fullTown);
    expect(queryClient.getQueryState(detailKey)?.isInvalidated).toBeFalsy();

    const { user } = renderModal();
    await save(user, "harbortown");
    await waitFor(() => expect(stub.countFor("town.setPortalAddress")).toBeGreaterThan(0));

    await waitFor(() => expect(queryClient.getQueryState(detailKey)?.isInvalidated).toBe(true));
  });
});

describe("SetPortalAddressModal validation", () => {
  it("shows the client-side courtesy check's message and never calls the mutation for a malformed address", async () => {
    server.conflicts = false;
    const { user } = renderModal();
    const before = stub.countFor("town.setPortalAddress");

    await save(user, "new castle");

    expect(
      await screen.findByText(
        "A portal address can use only lowercase letters, numbers and hyphens, " +
          "and must start and end with a letter or number. It cannot contain dots, " +
          "spaces or underscores — it becomes part of a web address.",
      ),
    ).toBeInTheDocument();
    expect(stub.countFor("town.setPortalAddress")).toBe(before);
  });

  it("shows the server's CONFLICT message when another town already holds the address", async () => {
    server.conflicts = true;
    const { user } = renderModal();

    await save(user, "harbortown");

    expect(await screen.findByRole("button", { name: "Save" })).toBeInTheDocument();
    await waitFor(() => expect(stub.countFor("town.setPortalAddress")).toBeGreaterThan(0));
    expect(await screen.findByText(/CONFLICT/)).toBeInTheDocument();
  });
});
