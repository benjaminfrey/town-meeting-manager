/**
 * `settings.notifications.tsx` — `notificationPreference.mine` /
 * `.setMine` on tRPC.
 *
 * Same shape as `settings.town.test.tsx`: the real options proxy and real
 * `QueryClient` singleton run; only `globalThis.fetch` is replaced
 * (`installTRPCFetchStub`). `usePushNotifications` is mocked — this screen's
 * Push Notifications card is independent of the tRPC read/write under test
 * and exercising the real browser Push API is out of scope here.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders, setupAppQueryClient } from "@/test/render";
import { installTRPCFetchStub, trpcTestError } from "@/test/trpc";
import { trpc } from "@/lib/trpc";

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ personId: "person-1", townId: "town-1" }),
}));

vi.mock("@/hooks/usePushNotifications", () => ({
  usePushNotifications: () => ({
    isSupported: false,
    permission: "default",
    isSubscribed: false,
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    isLoading: false,
  }),
}));

const queryClient = setupAppQueryClient();

/** Mutable so a test can change what the server returns/records between calls. */
const server = {
  prefs: [] as Array<{ event_type: string; channel: string; enabled: boolean }>,
  mineRejects: false,
};

const stub = installTRPCFetchStub({
  "notificationPreference.mine": () => {
    if (server.mineRejects) trpcTestError("INTERNAL_SERVER_ERROR");
    return server.prefs;
  },
  "notificationPreference.setMine": (input) => {
    server.prefs = [
      ...server.prefs.filter(
        (p) => !(p.event_type === input.event_type && p.channel === input.channel),
      ),
      input,
    ];
    return input;
  },
});

import NotificationPreferencesPage from "../settings.notifications";

function renderPage() {
  return renderWithProviders(<NotificationPreferencesPage />, {
    route: "/settings/notifications",
    queryClient,
  });
}

describe("settings.notifications", () => {
  beforeEach(() => {
    server.prefs = [];
    server.mineRejects = false;
  });

  it("defaults every event to enabled when no preference row exists (opt-out model)", async () => {
    renderPage();
    const toggle = await screen.findByRole("switch", { name: /toggle meeting scheduled/i });
    expect(toggle).toHaveAttribute("aria-checked", "true");
  });

  it("reflects a disabled preference once the read settles", async () => {
    server.prefs = [{ event_type: "meeting_scheduled", channel: "email", enabled: false }];
    renderPage();
    const toggle = await screen.findByRole("switch", { name: /toggle meeting scheduled/i });
    await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "false"));
  });

  it("shows an error state when notificationPreference.mine rejects, not an empty page", async () => {
    server.mineRejects = true;
    renderPage();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(
      await screen.findByText(/something went wrong loading your email notification preferences/i),
    ).toBeInTheDocument();
  });

  it("toggling a switch writes through setMine and refetches mine via trpc.notificationPreference.pathFilter()", async () => {
    const { user } = renderPage();
    const toggle = await screen.findByRole("switch", { name: /toggle meeting scheduled/i });
    expect(toggle).toHaveAttribute("aria-checked", "true");

    const before = stub.countFor("notificationPreference.mine");
    await user.click(toggle);

    await waitFor(() => expect(stub.countFor("notificationPreference.setMine")).toBe(1));
    await waitFor(() =>
      expect(stub.countFor("notificationPreference.mine")).toBeGreaterThan(before),
    );
    await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "false"));
  });
});
