/**
 * `CreateMeetingDialog` — every read and write on tRPC, and its cache
 * invalidation.
 *
 * Phase E, wave 3, Task 2 migrated `trpc.meeting.insert` /
 * `trpc.agendaTemplate.list`. Phase E, wave 4, Task 4 finishes the file:
 * `trpc.boardMember.activeCountForBoard`, `trpc.town.detail` and
 * `trpc.agendaItem.instantiateFromTemplate`. The `@/hooks/useSupabase` mock
 * this file used to carry is GONE — the component no longer touches Supabase
 * in any form, which is the point of the task.
 *
 * Real options proxy, real `QueryClient` singleton, only `globalThis.fetch`
 * replaced (see `boards.$boardId.test.tsx` for why that distinction matters —
 * it is what lets the invalidation tests below prove a writer's
 * `pathFilter()`/legacy-key calls reach the reads migrated screens use).
 *
 * **Two refusal paths, pinned separately** (conventions item 2's "pin both
 * paths" discipline, in the shape this component has it): `meeting.insert`
 * can refuse, and `agendaItem.instantiateFromTemplate` can refuse AFTER the
 * meeting has already been created. They are different messages and different
 * footers — one still offers "Create Meeting", the other must not, because a
 * second click would make a second meeting. A single refusal test written
 * against whichever path was convenient would leave the other unpinned.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders, setupAppQueryClient } from "@/test/render";
import { installTRPCFetchStub, trpcTestError } from "@/test/trpc";
import { trpc } from "@/lib/trpc";
import { queryKeys } from "@/lib/queryKeys";

import { CreateMeetingDialog } from "../CreateMeetingDialog";

const queryClient = setupAppQueryClient();

/** Set by the handlers, so a test can assert on the exact input sent. */
const received: { insert?: unknown; instantiate?: unknown } = {};

/** Mutable so a test can make the next call refuse, or change the template list. */
const server = {
  insertRejects: false,
  instantiateRejects: false,
  hasTemplate: true,
};

const stub = installTRPCFetchStub({
  "agendaTemplate.list": () =>
    server.hasTemplate
      ? [
          {
            id: "11111111-1111-4111-8111-111111111111",
            name: "Regular",
            is_default: true,
            sections: [],
          },
        ]
      : [],
  "boardMember.activeCountForBoard": () => 5,
  "town.detail": () => ({
    id: "town-1",
    name: "Newcastle",
    state: "ME" as const,
    municipality_type: "town" as const,
    population_range: "under_1000" as const,
    contact_name: "Jamie Clerk",
    contact_role: "Town Clerk",
    meeting_formality: "formal" as const,
    minutes_style: "summary" as const,
    presiding_officer_default: null,
    minutes_recorder_default: null,
    staff_roles_present: null,
    subdomain: "newcastle",
    seal_url: null,
    retention_policy_acknowledged_at: "2026-01-01T00:00:00Z",
    minutes_workflow_configured_at: null,
    audio_retention_policy: "retain_30_days",
    auto_publish_on_approval: false,
    minutes_review_window_days: 7,
  }),
  "meeting.insert": (input) => {
    received.insert = input;
    if (server.insertRejects) trpcTestError("FORBIDDEN");
    return { id: "new-meeting" };
  },
  "agendaItem.instantiateFromTemplate": (input) => {
    received.instantiate = input;
    if (server.instantiateRejects) trpcTestError("FORBIDDEN");
    return { count: 4 };
  },
});

function renderDialog(onOpenChange: (open: boolean) => void = () => {}) {
  return renderWithProviders(
    <CreateMeetingDialog boardId="b1" boardName="Select Board" open onOpenChange={onOpenChange} />,
    { queryClient, route: "/boards/b1/meetings" },
  );
}

/** Fill nothing — the form's own defaults already satisfy the schema; a blur is
 * enough to run the resolver and flip `isValid`, matching
 * `AddBoardDialog.test.tsx`'s identical shape. */
async function submit(user: ReturnType<typeof renderDialog>["user"]) {
  const titleInput = await screen.findByPlaceholderText("Meeting title");
  await user.click(titleInput);
  await user.tab();

  const createButton = await screen.findByRole("button", { name: /create meeting/i });
  await waitFor(() => expect(createButton).not.toBeDisabled());
  await user.click(createButton);
}

/**
 * The component auto-selects the default template during render, once the
 * list has landed. Waited on through the CACHE rather than through rendered
 * text: Radix's `SelectValue` only knows an item's label after
 * `SelectContent` has mounted, which happens when the select is opened, so
 * the trigger still reads "Select a template" at this point.
 */
async function waitForTemplates() {
  const key = trpc.agendaTemplate.list.queryOptions({ boardId: "b1" }).queryKey;
  await waitFor(() => expect(queryClient.getQueryData(key)).toHaveLength(1));
}

async function create(onOpenChange: (open: boolean) => void = () => {}) {
  const byBoardKey = trpc.meeting.byBoard.queryOptions({ boardId: "b1" }).queryKey;
  const legacyKey = queryKeys.meetings.byBoard("b1");
  const agendaKey = trpc.agendaItem.countByMeeting.queryOptions({
    meetingId: "new-meeting",
  }).queryKey;
  queryClient.setQueryData(byBoardKey, []);
  queryClient.setQueryData(legacyKey, []);
  queryClient.setQueryData(agendaKey, 0);
  expect(queryClient.getQueryState(byBoardKey)?.isInvalidated).toBeFalsy();
  expect(queryClient.getQueryState(agendaKey)?.isInvalidated).toBeFalsy();

  const { user } = renderDialog(onOpenChange);
  // Wait for the template list to arrive: the component auto-selects the
  // default template, and without it `template_id` stays "" and the
  // instantiate call is (correctly) skipped.
  if (server.hasTemplate) await waitForTemplates();
  await submit(user);
  await waitFor(() => expect(stub.countFor("meeting.insert")).toBe(1));

  return { byBoardKey, legacyKey, agendaKey };
}

describe("CreateMeetingDialog", () => {
  beforeEach(() => {
    server.insertRejects = false;
    server.instantiateRejects = false;
    server.hasTemplate = true;
    received.insert = undefined;
    received.instantiate = undefined;
  });

  it("submits the new meeting through trpc.meeting.insert", async () => {
    await create();
    expect(received.insert).toMatchObject({ boardId: "b1" });
  });

  it("invalidates trpc.meeting.pathFilter() — the key boards.$boardId.meetings.tsx and meetings.tsx read under", async () => {
    const { byBoardKey } = await create();
    await waitFor(() => expect(queryClient.getQueryState(byBoardKey)?.isInvalidated).toBe(true));
  });

  it("invalidates the legacy meetings.byBoard key — EditBoardDialog's meeting-count check still reads it", async () => {
    const { legacyKey } = await create();
    await waitFor(() => expect(queryClient.getQueryState(legacyKey)?.isInvalidated).toBe(true));
  });

  it("builds the agenda through trpc.agendaItem.instantiateFromTemplate, naming the board, the new meeting and the template", async () => {
    // The defect this task fixed: the helper this replaces wrote `agenda_item`
    // rows through the credential-less Supabase client, so every
    // create-from-template produced an EMPTY agenda.
    const onOpenChange = vi.fn();
    await create(onOpenChange);
    await waitFor(() => expect(stub.countFor("agendaItem.instantiateFromTemplate")).toBe(1));
    expect(received.instantiate).toEqual({
      boardId: "b1",
      meetingId: "new-meeting",
      templateId: "11111111-1111-4111-8111-111111111111",
    });
    // Only closes once BOTH calls succeed.
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("invalidates trpc.agendaItem.pathFilter() after instantiating", async () => {
    const { agendaKey } = await create();
    await waitFor(() => expect(queryClient.getQueryState(agendaKey)?.isInvalidated).toBe(true));
  });

  it("does not instantiate an agenda when the board has no template to select", async () => {
    server.hasTemplate = false;
    await create();
    expect(stub.countFor("agendaItem.instantiateFromTemplate")).toBe(0);
  });

  it("shows a visible alert, and keeps the dialog open, when the CREATE is refused", async () => {
    // Before wave 3, `insert`'s raw write could never be refused. Closing that
    // hole made FORBIDDEN a real outcome — including from
    // boards.$boardId.meetings.tsx's own ungated "Create Meeting" button,
    // which has no client-side permission check at all.
    server.insertRejects = true;
    const onOpenChange = vi.fn();
    const { user } = renderDialog(onOpenChange);
    await submit(user);

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(
      await screen.findByText("You don't have permission to schedule a meeting for this board."),
    ).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();
    // The create can be retried: nothing was written.
    expect(screen.getByRole("button", { name: /create meeting/i })).toBeInTheDocument();
  });

  it("says the meeting WAS created, and offers Open agenda instead of Create Meeting, when only the INSTANTIATION is refused", async () => {
    // The second refusal path. `meeting.insert` has already committed by the
    // time this runs, so a message blaming the create would be false and a
    // still-armed "Create Meeting" button would produce a duplicate meeting.
    server.instantiateRejects = true;
    const onOpenChange = vi.fn();
    const { user } = renderDialog(onOpenChange);
    await waitForTemplates();
    await submit(user);

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(
      await screen.findByText(
        "The meeting was created, but you don't have permission to build its agenda from a template. Open the agenda to add items by hand.",
      ),
    ).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /open agenda/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /create meeting/i })).not.toBeInTheDocument();
    expect(stub.countFor("meeting.insert")).toBe(1);
  });
});
