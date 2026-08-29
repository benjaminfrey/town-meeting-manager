/**
 * `trpc.board.pathFilter()` invalidates every `board.*` query, not just the
 * one procedure a caller happens to name.
 *
 * Added after a Task 4 review finding: `EditBoardDialog`, `ArchiveBoardDialog`,
 * `NoticeTemplateEditor` and `MinutesWorkflowEditor` all still invalidate
 * `queryKeys.boards.detail(boardId)` (the legacy factory) after their writes,
 * but `packages/web/src/routes/boards.$boardId.tsx`'s board.detail/stats
 * reads moved to tRPC's own query keys in Task 4 — the legacy key no longer
 * reaches them. Each writer now ALSO calls `trpc.board.pathFilter()`.
 *
 * This test proves the MECHANISM those four calls rely on: that
 * `trpc.board.pathFilter()` matches a `board.detail`-keyed cache entry and
 * does not over-match an unrelated router. It uses the real `trpc` options
 * proxy and the real `queryClient` singleton — nothing here is mocked.
 *
 * It does NOT prove that any of the four writer files actually calls
 * `trpc.board.pathFilter()` in its `onSuccess` — that would mean rendering
 * each dialog and exercising its mutation, and every existing test for those
 * files mocks `@/lib/trpc` (or `@tanstack/react-query` itself) wholesale, so
 * a missing call would not fail such a test. That mocking convention is being
 * revisited separately; this file deliberately stays narrow rather than
 * pretending to cover ground it doesn't.
 */
import { describe, it, expect } from "vitest";
import { trpc, type RouterOutputs } from "../trpc";
import { queryClient } from "../queryClient";

/** A fully-shaped fake `board.detail` row — only its presence in the cache matters here. */
const fakeBoard: RouterOutputs["board"]["detail"] = {
  id: "b1",
  name: "Old Name",
  elected_or_appointed: null,
  member_count: null,
  election_method: null,
  officer_election_method: null,
  is_governing_board: false,
  meeting_formality_override: null,
  minutes_style_override: null,
  quorum_type: null,
  quorum_value: null,
  motion_display_format: null,
  archived_at: null,
  created_at: "2026-01-01T00:00:00Z",
  notice_template_blocks: null,
  minutes_consent_agenda: false,
  minutes_requires_second: true,
  r4_board_member_default: true,
  audio_retention_policy_override: null,
  auto_publish_on_approval_override: null,
};

describe("trpc.board.pathFilter()", () => {
  it("invalidates a board.detail query cached under trpc's own key", async () => {
    const opts = trpc.board.detail.queryOptions({ boardId: "b1" });
    queryClient.setQueryData(opts.queryKey, fakeBoard);
    expect(queryClient.getQueryState(opts.queryKey)?.isInvalidated).toBeFalsy();

    await queryClient.invalidateQueries(trpc.board.pathFilter());

    expect(queryClient.getQueryState(opts.queryKey)?.isInvalidated).toBe(true);
  });

  it("does not invalidate an unrelated router's query", async () => {
    const opts = trpc.town.portalAddress.queryOptions();
    queryClient.setQueryData(opts.queryKey, { subdomain: null });

    await queryClient.invalidateQueries(trpc.board.pathFilter());

    expect(queryClient.getQueryState(opts.queryKey)?.isInvalidated).toBeFalsy();
  });
});
