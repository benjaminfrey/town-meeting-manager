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
 * `trpc.board.pathFilter()` in its `onSuccess` — that is what the writer pins
 * do: `ArchiveBoardDialog.test.tsx`, `EditBoardDialog.test.tsx`,
 * `NoticeTemplateEditor.test.tsx` and `MinutesWorkflowEditor.test.tsx` each
 * render the dialog, exercise its mutation, and assert the cache entry this
 * file proves the mechanism for was actually invalidated (conventions item 8,
 * "Pin the writers, not just the readers"). A missing `pathFilter()` call now
 * fails one of those four, which resolves the gap this file's previous
 * revision left open. This file deliberately stays narrower than that — it
 * proves only the shared mechanism the four pins rely on, not that any one
 * writer calls it.
 *
 * This file also deliberately does not use `setupAppQueryClient()` (item 9).
 * That helper exists to save and restore `setDefaultOptions()` on the
 * production singleton; this file never touches `setDefaultOptions()` at
 * all, it only sets and reads two cache entries under keys
 * (`board.detail({boardId:"b1"})`, `town.portalAddress()`) that no other test
 * file writes to. There is nothing here for a leaked default or an uncleared
 * cache entry to corrupt, which is also why this file is correctly absent
 * from "Files to copy from": a writer test that renders a component and
 * asserts on a mutation's side effects needs the helper's isolation between
 * tests; a test that only exercises the query-key matcher directly does not.
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
