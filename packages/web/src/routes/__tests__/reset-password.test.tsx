/**
 * Stage 1, Task C2 — the page the emailed reset link lands on.
 *
 * `forgot-password.tsx` has always pointed `redirectTo` at `/reset-password`,
 * and until this task no route was registered there: the link 404'd, in every
 * environment, silently. These tests exist so that cannot happen again. The
 * first one reads the real route CONFIG rather than rendering the component,
 * because the component was never the problem — the missing path was, and a
 * test that renders the component directly would have passed happily
 * throughout the entire outage.
 */

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router";

const { mockResetPassword, mockNavigate } = vi.hoisted(() => ({
  mockResetPassword: vi.fn(),
  mockNavigate: vi.fn(),
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: { resetPassword: mockResetPassword },
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

vi.mock("react-router", async () => {
  const actual = await vi.importActual<typeof import("react-router")>("react-router");
  return { ...actual, useNavigate: () => mockNavigate };
});

import ResetPasswordPage from "../reset-password";
import routeConfig from "@/routes";

/** Every `path` in the route config, flattened through layout nesting. */
function allPaths(routes: readonly unknown[]): string[] {
  const paths: string[] = [];
  for (const entry of routes as Array<{ path?: string; children?: readonly unknown[] }>) {
    if (entry.path) paths.push(entry.path);
    if (entry.children) paths.push(...allPaths(entry.children));
  }
  return paths;
}

function renderAt(search: string) {
  return render(
    <MemoryRouter initialEntries={[`/reset-password${search}`]}>
      <Routes>
        <Route path="/reset-password" element={<ResetPasswordPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("ResetPasswordPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResetPassword.mockResolvedValue({ error: null });
  });

  it("IS actually registered — the whole defect was a page with no route", async () => {
    // Rendering the component directly proves nothing about whether the
    // emailed link resolves. The link points at a PATH, and the path is what
    // was missing. So this reads the real route config.
    expect(allPaths(await routeConfig)).toContain("reset-password");
  });

  it("refuses a link with no token, before asking for a password", () => {
    // Not after: making someone type a new password twice and then telling
    // them the link was dead is the worse half of this failure.
    renderAt("");
    expect(screen.getByText(/no longer valid/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/new password/i)).not.toBeInTheDocument();
  });

  it("refuses a link Better Auth already rejected", () => {
    // The endpoint redirects here with `?error=INVALID_TOKEN` for an expired
    // or already-used token rather than passing one through.
    renderAt("?error=INVALID_TOKEN");
    expect(screen.getByText(/no longer valid/i)).toBeInTheDocument();
  });

  it("sends the new password with the token from the link", async () => {
    const user = userEvent.setup();
    renderAt("?token=reset-token-123");

    await user.type(screen.getByLabelText("New password"), "a-new-passphrase");
    await user.type(screen.getByLabelText(/confirm new password/i), "a-new-passphrase");
    await user.click(screen.getByRole("button", { name: /set new password/i }));

    await waitFor(() =>
      expect(mockResetPassword).toHaveBeenCalledWith({
        newPassword: "a-new-passphrase",
        token: "reset-token-123",
      }),
    );
    // No session is created by a reset — see the page's header.
    expect(mockNavigate).toHaveBeenCalledWith("/login", { replace: true });
  });

  it("does not submit when the two passwords disagree", async () => {
    const user = userEvent.setup();
    renderAt("?token=reset-token-123");

    await user.type(screen.getByLabelText("New password"), "a-new-passphrase");
    await user.type(screen.getByLabelText(/confirm new password/i), "a-different-one");
    await user.click(screen.getByRole("button", { name: /set new password/i }));

    expect(await screen.findByText(/do not match/i)).toBeInTheDocument();
    expect(mockResetPassword).not.toHaveBeenCalled();
  });

  it("explains an expired token instead of showing Better Auth's code", async () => {
    mockResetPassword.mockResolvedValue({ error: { code: "INVALID_TOKEN" } });
    const user = userEvent.setup();
    renderAt("?token=stale");

    await user.type(screen.getByLabelText("New password"), "a-new-passphrase");
    await user.type(screen.getByLabelText(/confirm new password/i), "a-new-passphrase");
    await user.click(screen.getByRole("button", { name: /set new password/i }));

    expect(await screen.findByText(/expired or has already been used/i)).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
