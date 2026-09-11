/**
 * `InlineItemForm` — its three writes, their refusals, and its cache keys.
 *
 * Phase E wave 3, Tasks 3+4's fix round pinned the two `pathFilter()` calls
 * this form had while it was still raw Supabase. Wave 4, Task 3 moved all
 * three writes onto `agendaItem.insert` / `.update` / `.delete`, so this file
 * is rewritten rather than adapted (conventions item 13: "a rewritten test is
 * not a migrated test" — an adapted chainable mock is how four vacuous suites
 * in this repo began). The real tRPC proxy runs against a stubbed transport,
 * which is what lets these tests assert on the real query keys AND on what
 * the form actually sent.
 *
 * The DELETE is the one this task changed most: it used to be three unwrapped
 * round trips (exhibits, then children, then the row), with no transaction
 * and no authorization check, and with no `TODO(phase-e-wave-*)` marker to
 * stop item 11's sweep reading this file as done. It is now one call, and its
 * test asserts the count.
 *
 * TWO `pathFilter()` calls live in this component, reached by four handlers:
 * `trpc.agendaItem.pathFilter()` inside the `invalidateItems` helper that
 * insert, update and delete all call, and `trpc.exhibit.pathFilter()` on the
 * delete alone. Each of the four paths has its own test, and the exhibit call
 * is pinned in its own right — conventions item 8's credit bleed is per test
 * FILE, so a second call in an already-pinned file rides in free without its
 * own assertion.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders, setupAppQueryClient } from "@/test/render";
import { installTRPCFetchStub, trpcTestError } from "@/test/trpc";
import { trpc } from "@/lib/trpc";

import { InlineItemForm } from "../InlineItemForm";
import type { AgendaItem } from "../agenda-types";

const queryClient = setupAppQueryClient();

const server = { insertRefuses: false, updateRefuses: false, deleteRefuses: false };

const stub = installTRPCFetchStub({
  "agendaItem.insert": () => {
    if (server.insertRefuses) trpcTestError("FORBIDDEN");
    return { id: "new-item" };
  },
  "agendaItem.update": ({ itemId }) => {
    if (server.updateRefuses) trpcTestError("FORBIDDEN");
    return { id: itemId };
  },
  "agendaItem.delete": ({ itemId }) => {
    if (server.deleteRefuses) trpcTestError("FORBIDDEN");
    return { id: itemId };
  },
});

const existing: AgendaItem = {
  id: "item-1",
  section_type: "new_business",
  sort_order: 0,
  title: "Site Plan Review",
  description: null,
  presenter: null,
  estimated_duration: null,
  parent_item_id: "sec-1",
  staff_resource: null,
  background: null,
  recommendation: null,
  suggested_motion: null,
};

function seedShellCount() {
  const countKey = trpc.agendaItem.countByMeeting.queryOptions({ meetingId: "m1" }).queryKey;
  queryClient.setQueryData(countKey, 3);
  expect(queryClient.getQueryState(countKey)?.isInvalidated).toBeFalsy();
  return countKey;
}

function seedExhibitList() {
  const exhibitKey = trpc.exhibit.byMeeting.queryOptions({ meetingId: "m1" }).queryKey;
  queryClient.setQueryData(exhibitKey, []);
  expect(queryClient.getQueryState(exhibitKey)?.isInvalidated).toBeFalsy();
  return exhibitKey;
}

function renderForm(existingItem?: AgendaItem) {
  return renderWithProviders(
    <InlineItemForm
      meetingId="m1"
      boardId="board-1"
      parentItemId="sec-1"
      sectionType="new_business"
      sortOrder={0}
      existingItem={existingItem}
      onSaved={() => {}}
      onCancel={() => {}}
    />,
    { queryClient },
  );
}

/**
 * `useWizardForm` runs react-hook-form in `mode: "onBlur"` and `setValue`
 * passes `shouldValidate: false`, so `formState.isValid` — which gates the
 * submit button's `disabled` — stays false until a field blurs.
 */
async function typeTitleAndSubmit(
  user: ReturnType<typeof renderForm>["user"],
  title: string,
  buttonName: "Add" | "Save",
) {
  const input = screen.getByPlaceholderText("Item title");
  await user.clear(input);
  await user.type(input, title);
  await user.tab();
  const button = screen.getByRole("button", { name: buttonName });
  await waitFor(() => expect(button).not.toBeDisabled());
  await user.click(button);
}

describe("InlineItemForm", () => {
  beforeEach(() => {
    server.insertRefuses = false;
    server.updateRefuses = false;
    server.deleteRefuses = false;
  });

  it("adds an item through agendaItem.insert, with the board and no client-minted id", async () => {
    // `town_id`, `id` and `status` are deliberately absent: the procedure
    // takes the town from the caller's own session, mints the id with the
    // column's default, and hardcodes `'pending'`. Asserting the exact input
    // is what would catch one of them creeping back.
    const { user } = renderForm();

    await typeTitleAndSubmit(user, "Site Plan Review", "Add");

    await waitFor(() => expect(stub.countFor("agendaItem.insert")).toBe(1));
    expect(stub.calls.at(-1)?.inputs).toEqual({
      0: {
        boardId: "board-1",
        meetingId: "m1",
        parentItemId: "sec-1",
        sectionType: "new_business",
        sortOrder: 0,
        title: "Site Plan Review",
        description: null,
        presenter: null,
        estimatedDuration: null,
        staffResource: null,
        background: null,
        recommendation: null,
        suggestedMotion: null,
      },
    });
  });

  it("edits an item through agendaItem.update, naming the row by id", async () => {
    const { user } = renderForm(existing);

    await typeTitleAndSubmit(user, "Site Plan Review (revised)", "Save");

    await waitFor(() => expect(stub.countFor("agendaItem.update")).toBe(1));
    expect(stub.calls.at(-1)?.inputs).toMatchObject({
      0: { boardId: "board-1", itemId: "item-1", title: "Site Plan Review (revised)" },
    });
    // The edit branch must not also insert.
    expect(stub.countFor("agendaItem.insert")).toBe(0);
  });

  it("deletes in ONE call — the database cascades children and exhibits", async () => {
    // The behaviour this task bought: three unwrapped round trips became one
    // statement inside one transaction. More than one call here would mean
    // the client is deleting by hand again.
    const { user } = renderForm(existing);

    await user.click(screen.getByRole("button", { name: /delete/i }));
    await user.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(stub.countFor("agendaItem.delete")).toBe(1));
    expect(stub.calls.at(-1)?.inputs).toEqual({ 0: { boardId: "board-1", itemId: "item-1" } });
  });

  it("invalidates trpc.agendaItem.pathFilter() when a new item is added", async () => {
    const countKey = seedShellCount();
    const { user } = renderForm();

    await typeTitleAndSubmit(user, "Site Plan Review", "Add");

    await waitFor(() => expect(queryClient.getQueryState(countKey)?.isInvalidated).toBe(true));
  });

  it("invalidates trpc.agendaItem.pathFilter() when an item is edited — the OTHER call site", async () => {
    const countKey = seedShellCount();
    const { user } = renderForm(existing);

    await typeTitleAndSubmit(user, "Site Plan Review (revised)", "Save");

    await waitFor(() => expect(queryClient.getQueryState(countKey)?.isInvalidated).toBe(true));
  });

  it("invalidates trpc.agendaItem.pathFilter() when an item is deleted — the THIRD call site", async () => {
    const countKey = seedShellCount();
    const { user } = renderForm(existing);

    await user.click(screen.getByRole("button", { name: /delete/i }));
    await user.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(queryClient.getQueryState(countKey)?.isInvalidated).toBe(true));
  });

  it("invalidates trpc.exhibit.pathFilter() when an item is deleted — the cascade", async () => {
    const exhibitKey = seedExhibitList();
    const { user } = renderForm(existing);

    await user.click(screen.getByRole("button", { name: /delete/i }));
    await user.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(queryClient.getQueryState(exhibitKey)?.isInvalidated).toBe(true));
  });

  it("shows a refusal when the insert is FORBIDDEN, rather than a Save that does nothing", async () => {
    server.insertRefuses = true;
    const { user } = renderForm();

    await typeTitleAndSubmit(user, "Site Plan Review", "Add");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "You don't have permission to add an item to this agenda.",
    );
  });

  it("shows a refusal when the update is FORBIDDEN, rather than a Save that does nothing", async () => {
    server.updateRefuses = true;
    const { user } = renderForm(existing);

    await typeTitleAndSubmit(user, "Site Plan Review (revised)", "Save");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "You don't have permission to edit this agenda item.",
    );
  });

  it("shows a refusal when the delete is FORBIDDEN", async () => {
    server.deleteRefuses = true;
    const { user } = renderForm(existing);

    await user.click(screen.getByRole("button", { name: /delete/i }));
    await user.click(screen.getByRole("button", { name: "Delete" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "You don't have permission to delete this agenda item.",
    );
  });
});
