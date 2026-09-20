/**
 * `checkPermission` — and specifically what `sys_admin` may do in a town.
 *
 * The server is unambiguous: `resolvePermission` short-circuits `admin` to
 * true and then denies `sys_admin` in its own branch, because a platform
 * operator administers the deployment and is not a clerk of any town. The
 * deleted `has_permission()` database function said the same.
 *
 * The client used to disagree, in three places, and the disagreement was
 * user-visible: the minutes screen offered Approve, Return for Amendments and
 * Unpublish to a `sys_admin`, and the server refused every one of them
 * (backlog 5). The buttons appeared, were pressed, and produced a FORBIDDEN
 * toast.
 *
 * These cases pin the reconciled behaviour. A `sys_admin` is not an operational
 * admin of a town; they fall through to the ordinary matrix like anyone else,
 * which for a platform operator is normally empty.
 */

import { describe, it, expect } from "vitest";
import { checkPermission } from "../usePermission.js";
import type { CurrentUser } from "../useCurrentUser.js";

const BOARD = "bbbb1111-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function userWith(role: CurrentUser["role"], global: Record<string, boolean> = {}): CurrentUser {
  // The full shape, not a cast: a partial fixture behind `as CurrentUser` is
  // how a test stops noticing that the type it claims to exercise has changed.
  return {
    id: "user-1",
    authUserId: "auth-1",
    personId: "person-1",
    email: "someone@example.gov",
    emailVerified: true,
    townId: "town-1",
    role,
    govTitle: null,
    permissions: { global, board_overrides: [] },
  };
}

describe("checkPermission — sys_admin is not a town administrator (backlog 5)", () => {
  it("denies a sys_admin the operational codes an admin gets", () => {
    const sysAdmin = userWith("sys_admin");

    // R4/R5 are the minutes codes whose buttons the screen used to offer.
    expect(checkPermission(sysAdmin, "R5", BOARD)).toBe(false);
    expect(checkPermission(sysAdmin, "R4", BOARD)).toBe(false);
    expect(checkPermission(sysAdmin, "A1", BOARD)).toBe(false);
  });

  it("still grants an admin the same codes", () => {
    const admin = userWith("admin");

    expect(checkPermission(admin, "R5", BOARD)).toBe(true);
    expect(checkPermission(admin, "R4", BOARD)).toBe(true);
    expect(checkPermission(admin, "A1", BOARD)).toBe(true);
  });

  it("denies a sys_admin even a code their matrix carries — matching the server exactly", () => {
    // The server does not fall through to the matrix for this role: it returns
    // false outright (`if (actor.role === "sys_admin") return false`). The
    // client now agrees by having no branch for the role at all, so a grant
    // written against a platform operator changes nothing on either side.
    // Whichever way that policy is revisited, both sides must move together —
    // the split between them is what backlog 5 was.
    const sysAdminWithGrant = userWith("sys_admin", { view_draft_minutes: true });

    expect(checkPermission(sysAdminWithGrant, "R4", BOARD)).toBe(false);
    expect(checkPermission(sysAdminWithGrant, "R5", BOARD)).toBe(false);
  });

  it("denies everything to a signed-out caller", () => {
    expect(checkPermission(null, "R4", BOARD)).toBe(false);
  });
});
