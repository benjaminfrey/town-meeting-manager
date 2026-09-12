import React from "react";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { onlineManager } from "@tanstack/react-query";
import { renderWithProviders, screen, setupAppQueryClient, waitFor } from "@/test/render";
import { installTRPCFetchStub } from "@/test/trpc";
import { createAdminUser } from "@/test/mocks/auth-mock";
import { APP_NAME } from "@town-meeting/shared";
import type { CurrentUser } from "@/hooks/useCurrentUser";

// Current user is injected per-test
const { userRef } = vi.hoisted(() => ({
  userRef: { value: null as CurrentUser | null },
}));
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => userRef.value,
}));

// The live-meeting indicator's read, through the real options proxy — only
// `globalThis.fetch` is replaced (conventions item 8). `server.liveMeetingId`
// is mutable so a test can turn the indicator on without a second install.
const server = { liveMeetingId: null as string | null };
const stub = installTRPCFetchStub({
  "meeting.liveByTown": () => ({ id: server.liveMeetingId }),
});

// Isolate the shell from heavy children
vi.mock("@/components/ProtectedRoute", () => ({
  ProtectedRoute: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/components/CommandPalette", () => ({ CommandPalette: () => null }));
// NOT mocked, since wave 5 Task 6: `ConnectionStatusBar` no longer opens a
// Supabase Realtime channel (the reason it was stubbed), and it is the app
// shell's only connection signal — stubbing it out means the shell's own half
// of this task is pinned nowhere.
vi.mock("@/components/NavigationProgress", () => ({ NavigationProgress: () => null }));
vi.mock("@/components/LogoutDialog", () => ({
  LogoutDialog: ({ trigger }: { trigger: React.ReactNode }) => trigger,
}));

import AppShell from "@/layouts/AppShell";

const queryClient = setupAppQueryClient();

describe("AppShell", () => {
  beforeEach(() => {
    userRef.value = createAdminUser();
    server.liveMeetingId = null;
  });

  afterEach(() => {
    // Shared module singleton — leaving it offline would stop every later
    // suite in this worker from running a query.
    onlineManager.setOnline(true);
  });

  it("renders the wordmark and the primary navigation", () => {
    renderWithProviders(<AppShell />, { route: "/" });
    // Wordmark shows in the sidebar (and mobile top bar)
    expect(screen.getAllByText(APP_NAME).length).toBeGreaterThan(0);
    for (const label of ["Home", "Meetings", "Boards", "Settings"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("hides the live-meeting indicator when no meeting is open", async () => {
    renderWithProviders(<AppShell />, { route: "/", queryClient });
    await waitFor(() => expect(stub.countFor("meeting.liveByTown")).toBeGreaterThan(0));
    expect(screen.queryByText("Meeting live")).not.toBeInTheDocument();
  });

  it("shows the live-meeting indicator, linking to the open meeting", async () => {
    // Never actually reachable before wave 6, Task 5: the raw query this
    // replaced filtered on `in_progress`, which is not a `meeting_status`
    // value, so PostgREST rejected it and the hook fell to null on every
    // poll. See `useLiveMeetingId`'s own comment.
    server.liveMeetingId = "m-live";
    renderWithProviders(<AppShell />, { route: "/", queryClient });
    const link = await screen.findByRole("link", { name: /meeting live/i });
    expect(link).toHaveAttribute("href", "/meetings/m-live/live");
  });

  it("says nothing about the connection while the device is online", () => {
    // The shell's header is on every authenticated screen; a permanent badge
    // there would be noise. Silence-while-healthy is the requirement.
    onlineManager.setOnline(true);
    renderWithProviders(<AppShell />, { route: "/" });
    expect(screen.queryByText("Offline")).not.toBeInTheDocument();
  });

  it("surfaces an offline device in the top bar", () => {
    // The app-GLOBAL half of wave 5, Task 6. While offline, TanStack Query
    // pauses mutations rather than failing them, so without this the user gets
    // a Save button that appears to do nothing, with no error, indefinitely.
    onlineManager.setOnline(false);
    renderWithProviders(<AppShell />, { route: "/" });
    expect(screen.getByRole("status")).toHaveTextContent("Offline");
  });

  it("exposes a command-palette search trigger", () => {
    renderWithProviders(<AppShell />, { route: "/" });
    expect(screen.getByRole("button", { name: /search/i })).toBeInTheDocument();
  });
});
