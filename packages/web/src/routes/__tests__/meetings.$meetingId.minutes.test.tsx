/**
 * The minutes screen (`/meetings/:meetingId/minutes`) — three reads and six
 * writes on tRPC.
 *
 * Phase E, wave 6, Task 3. This file REPLACES
 * `routes/meetings.$meetingId.minutes.test.tsx`, which was a single
 * cache-key pin driving a `vi.mock("@/lib/supabase")` chainable stub and
 * stubbing `MinutesEditor`/`TrackedChanges` out entirely. Rewritten, not
 * adapted (conventions item 13): `@/lib/trpc` is untouched and only
 * `globalThis.fetch` is replaced, so the real proxy produces real query keys
 * and every payload below is bound to its procedure's own output type.
 *
 * It also moves into `__tests__/`, matching every other route test in this
 * phase.
 *
 * What this file owns is the SCREEN: its three reads, its three
 * distinguishable states plus the two the minutes document adds (rule 9's
 * refusal and "no document yet"), the two defects the migration fixed, and a
 * refusal surface for every one of the six writes. `MinutesEditor`,
 * `SourceDataPanel`, `TrackedChanges` and `ContentEditableField` have their
 * own files under `components/minutes/__tests__/`; `MinutesEditor` is stubbed
 * here down to the one thing this screen owns about it — that `onSave` runs
 * `minutesDocument.saveDraft`.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { renderWithProviders, setupAppQueryClient } from "@/test/render";
import { installTRPCFetchStub, trpcTestError } from "@/test/trpc";
import { trpc, type RouterOutputs } from "@/lib/trpc";

const { currentUser } = vi.hoisted(() => ({
  currentUser: {
    value: {
      id: "user-1",
      townId: "town-1",
      role: "admin" as string | null,
      permissions: null as unknown,
    },
  },
}));

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => currentUser.value,
}));

const { toastSuccess, toastError } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: toastError } }));

const { apiFetch, apiJson } = vi.hoisted(() => ({
  apiFetch: vi.fn().mockResolvedValue({}),
  apiJson: vi.fn().mockResolvedValue({}),
}));
vi.mock("@/lib/api-client", () => ({ apiFetch, apiJson }));

// Stubbed down to the seam this screen owns: `onSave` is the screen's
// `saveDraft` write. The editor's own behaviour is covered in
// `components/minutes/__tests__/MinutesEditor.test.tsx`.
vi.mock("@/components/minutes/MinutesEditor", () => ({
  MinutesEditor: (props: {
    boardId: string;
    minutesDocId: string;
    onSave: (json: unknown) => Promise<void>;
  }) => (
    <div data-testid="minutes-editor">
      <span data-testid="editor-board-id">{props.boardId}</span>
      <span data-testid="editor-doc-id">{props.minutesDocId}</span>
      <button
        data-testid="editor-save"
        onClick={() => {
          void props.onSave({ sections: [{ title: "Edited" }] }).catch(() => {});
        }}
      >
        save
      </button>
    </div>
  ),
}));

vi.mock("@/components/minutes/TrackedChanges", () => ({
  TrackedChanges: () => <div data-testid="tracked-changes" />,
}));

vi.mock("@/components/RouteErrorBoundary", () => ({
  RouteErrorBoundary: () => <div>Error</div>,
}));

import MinutesReviewPage from "../meetings.$meetingId.minutes";

// ─── Harness ────────────────────────────────────────────────────────────

const queryClient = setupAppQueryClient();

/**
 * The three `& …: unknown` members are not decoration. `RouterOutputs` runs
 * the procedure's row through tRPC's serialization inference, which turns an
 * `unknown` column into an OPTIONAL property (`unknown` includes `undefined`),
 * while `TestHandlers` infers from `inferProcedureOutput` directly and still
 * requires it. The intersection restores the requirement, so a fixture that
 * forgets one of these columns is a compile error here.
 */
type MinutesDetail = NonNullable<RouterOutputs["minutesDocument"]["detail"]> & {
  content_json: unknown;
  original_content_json: unknown;
  amendments_history: unknown;
};

const baseDocument: MinutesDetail = {
  id: "minutes-1",
  meeting_id: "meeting-1",
  status: "review",
  content_json: { sections: [] },
  original_content_json: null,
  amendments_history: [],
  html_rendered: "<p>Minutes body</p>",
  minutes_style: "summary",
  generated_by: "manual",
  approved_as_amended: false,
  approved_at: null,
  approved_by_motion_id: null,
  submitted_for_review_at: "2026-01-03T00:00:00Z",
  published_at: null,
  created_at: "2026-01-02T00:00:00Z",
  updated_at: "2026-01-03T00:00:00Z",
  has_pdf: false,
};

const meetingDetail = {
  id: "meeting-1",
  board_id: "board-1",
  title: "Regular Board Meeting",
  status: "adjourned",
  meeting_type: "regular",
  agenda_status: "published",
  scheduled_date: "2026-01-01",
  scheduled_time: "19:00",
  location: "Town Hall",
  presiding_officer_id: null,
  recording_secretary_id: null,
  current_agenda_item_id: null,
  started_at: null,
  ended_at: null,
  agenda_packet_url: null,
  agenda_packet_generated_at: null,
  meeting_notice_url: null,
  meeting_notice_generated_at: null,
} satisfies RouterOutputs["meeting"]["detail"];

const boardDetail = {
  id: "board-1",
  name: "Select Board",
  board_type: "other",
  elected_or_appointed: "elected",
  member_count: 5,
  election_method: "at_large",
  officer_election_method: "vote_of_board",
  is_governing_board: false,
  meeting_formality_override: null,
  minutes_style_override: null,
  quorum_type: "simple_majority",
  quorum_value: null,
  motion_display_format: "inline_narrative",
  archived_at: null,
  created_at: "2026-01-01T00:00:00Z",
  notice_template_blocks: null,
  minutes_consent_agenda: false,
  minutes_requires_second: true,
  r4_board_member_default: true,
  audio_retention_policy_override: null,
  auto_publish_on_approval_override: null,
} satisfies RouterOutputs["board"]["detail"];

const server = {
  document: baseDocument as MinutesDetail | null,
  detailRejects: null as "FORBIDDEN" | "INTERNAL_SERVER_ERROR" | null,
  meetingRejects: false,
  saveDraftRefuses: false,
  submitRefuses: false,
  approveRefuses: false,
  publishRefuses: false,
  returnRefuses: false,
  unpublishRefuses: false,
};

const stub = installTRPCFetchStub({
  "minutesDocument.detail": () => {
    if (server.detailRejects) trpcTestError(server.detailRejects);
    return server.document;
  },
  "meeting.detail": () => {
    if (server.meetingRejects) trpcTestError("NOT_FOUND");
    return meetingDetail;
  },
  "board.detail": () => boardDetail,
  "minutesDocument.saveDraft": ({ minutesDocumentId }) => {
    if (server.saveDraftRefuses) trpcTestError("FORBIDDEN");
    return { id: minutesDocumentId };
  },
  "minutesDocument.submitForReview": ({ minutesDocumentId }) => {
    if (server.submitRefuses) trpcTestError("FORBIDDEN");
    return { id: minutesDocumentId, status: "review" as const };
  },
  "minutesDocument.approve": ({ minutesDocumentId }) => {
    if (server.approveRefuses) trpcTestError("FORBIDDEN");
    return { id: minutesDocumentId, status: "approved" as const };
  },
  "minutesDocument.publish": ({ minutesDocumentId }) => {
    if (server.publishRefuses) trpcTestError("FORBIDDEN");
    return { id: minutesDocumentId, status: "published" as const };
  },
  "minutesDocument.returnForAmendments": ({ minutesDocumentId }) => {
    if (server.returnRefuses) trpcTestError("FORBIDDEN");
    return { id: minutesDocumentId, status: "draft" as const };
  },
  "minutesDocument.unpublish": ({ minutesDocumentId }) => {
    if (server.unpublishRefuses) trpcTestError("FORBIDDEN");
    return { id: minutesDocumentId, status: "approved" as const };
  },
});

/**
 * The input a procedure was actually called with, unwrapping the batch index.
 * Not `stub.calls.at(-1)`: a mutation's `onSuccess` invalidates, which
 * refetches, so the LAST call is a query rather than the write under test.
 */
function inputFor(path: Parameters<typeof stub.countFor>[0]) {
  const call = [...stub.calls].reverse().find((c) => c.paths.includes(path));
  return call?.inputs[String(call.paths.indexOf(path))];
}

function renderRoute() {
  return renderWithProviders(
    <MinutesReviewPage
      {...({ loaderData: { meetingId: "meeting-1" } } as Parameters<typeof MinutesReviewPage>[0])}
    />,
    { route: "/meetings/meeting-1/minutes", queryClient },
  );
}

/** Every `[role="alert"]` node in the document, hidden or not. */
function alertNodes() {
  return Array.from(document.querySelectorAll('[role="alert"]'));
}

beforeEach(() => {
  currentUser.value = {
    id: "user-1",
    townId: "town-1",
    role: "admin",
    permissions: null,
  };
  server.document = { ...baseDocument };
  server.detailRejects = null;
  server.meetingRejects = false;
  server.saveDraftRefuses = false;
  server.submitRefuses = false;
  server.approveRefuses = false;
  server.publishRefuses = false;
  server.returnRefuses = false;
  server.unpublishRefuses = false;
  toastSuccess.mockClear();
  toastError.mockClear();
  apiFetch.mockClear();
  apiJson.mockClear();
});

// ─── Tests ──────────────────────────────────────────────────────────────

describe("MinutesReviewPage — reads", () => {
  it("renders the document, the board name and the status badge", async () => {
    renderRoute();

    expect(await screen.findByRole("heading", { name: "Select Board" })).toBeInTheDocument();
    expect(screen.getByText("Under Review")).toBeInTheDocument();
    expect(screen.getByText("Minutes body")).toBeInTheDocument();
    expect(screen.getByText("regular Meeting")).toBeInTheDocument();
  });

  it("shows a loading state until both reads have answered", () => {
    renderRoute();
    expect(screen.getByText("Loading meeting data...")).toBeInTheDocument();
  });

  it("renders an alert when meeting.detail answers NOT_FOUND", async () => {
    server.meetingRejects = true;
    renderRoute();

    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText("This meeting could not be found.")).toBeInTheDocument();
  });

  it("renders an alert when the minutes document read fails", async () => {
    server.detailRejects = "INTERNAL_SERVER_ERROR";
    renderRoute();

    const alert = await screen.findByRole("alert");
    expect(
      within(alert).getByText("Something went wrong loading these minutes."),
    ).toBeInTheDocument();
  });

  it("renders Access Denied when rule 9 refuses the document", async () => {
    server.detailRejects = "FORBIDDEN";
    renderRoute();

    expect(await screen.findByText("Access Denied")).toBeInTheDocument();
  });

  it("renders the empty state when the meeting has no minutes document", async () => {
    server.document = null;
    renderRoute();

    expect(await screen.findByText("No Minutes Generated Yet")).toBeInTheDocument();
  });
});

describe("MinutesReviewPage — the two migrated defects", () => {
  // Defect 1: the button gated on `minutesDoc.pdf_url`, which is not a column
  // on `minutes_document`, so it could never render. `has_pdf` is.
  it("renders the Download PDF link from has_pdf, pointing at the files route", async () => {
    server.document = { ...baseDocument, has_pdf: true };
    renderRoute();

    const link = await screen.findByRole("link", { name: /download pdf/i });
    expect(link).toHaveAttribute("href", "/api/files/minutes/minutes-1");
  });

  it("hides the Download PDF link when the document has no rendered PDF", async () => {
    server.document = { ...baseDocument, has_pdf: false };
    renderRoute();

    await screen.findByRole("heading", { name: "Select Board" });
    expect(screen.queryByRole("link", { name: /download pdf/i })).not.toBeInTheDocument();
  });

  // Defect 2: the "Generated" step read `generated_at`, also not a column, so
  // it has always rendered without a date. `created_at` records it.
  it("dates the Generated timeline step from created_at", async () => {
    server.document = {
      ...baseDocument,
      created_at: "2026-02-11T00:00:00Z",
      submitted_for_review_at: null,
    };
    renderRoute();

    // Formatted the way the component does, so the assertion does not depend
    // on the machine's timezone.
    const expected = new Date("2026-02-11T00:00:00Z").toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
    await screen.findByText("Generated");
    expect(screen.getByText(expected)).toBeInTheDocument();
  });
});

describe("MinutesReviewPage — writes", () => {
  it("invalidates trpc.minutesDocument.pathFilter() when minutes are approved — the shell's status pill", async () => {
    const pillKey = trpc.minutesDocument.byMeeting.queryOptions({
      meetingId: "meeting-1",
    }).queryKey;
    queryClient.setQueryData(pillKey, { id: "minutes-1", status: "review" });
    expect(queryClient.getQueryState(pillKey)?.isInvalidated).toBeFalsy();

    const { user } = renderRoute();
    await user.click(await screen.findByRole("button", { name: /approve minutes/i }));

    await waitFor(() => {
      expect(queryClient.getQueryState(pillKey)?.isInvalidated).toBe(true);
    });
    expect(inputFor("minutesDocument.approve")).toEqual({ minutesDocumentId: "minutes-1" });
  });

  it("submits for review with the board id the guard authorizes on", async () => {
    server.document = { ...baseDocument, status: "draft" };
    const { user } = renderRoute();

    await user.click(await screen.findByRole("button", { name: /submit for review/i }));
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Submit for Review",
      }),
    );

    await waitFor(() => expect(stub.countFor("minutesDocument.submitForReview")).toBe(1));
    expect(inputFor("minutesDocument.submitForReview")).toEqual({
      boardId: "board-1",
      minutesDocumentId: "minutes-1",
    });
  });

  it("publishes with the board id the guard authorizes on", async () => {
    server.document = { ...baseDocument, status: "approved" };
    const { user } = renderRoute();

    await user.click(await screen.findByRole("button", { name: /publish to portal/i }));
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Publish" }),
    );

    await waitFor(() => expect(stub.countFor("minutesDocument.publish")).toBe(1));
    expect(inputFor("minutesDocument.publish")).toEqual({
      boardId: "board-1",
      minutesDocumentId: "minutes-1",
    });
  });

  it("returns for amendments with a trimmed reason", async () => {
    const { user } = renderRoute();

    await user.click(await screen.findByRole("button", { name: /return for amendments/i }));
    await user.type(await screen.findByLabelText(/describe the requested changes/i), "  Fix it  ");
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "Return for Amendments",
      }),
    );

    await waitFor(() => expect(stub.countFor("minutesDocument.returnForAmendments")).toBe(1));
    expect(inputFor("minutesDocument.returnForAmendments")).toEqual({
      minutesDocumentId: "minutes-1",
      reason: "Fix it",
    });
  });

  it("unpublishes with the board id the R5 guard authorizes on", async () => {
    server.document = { ...baseDocument, status: "published" };
    const { user } = renderRoute();

    await user.click(await screen.findByRole("button", { name: /^unpublish$/i }));

    await waitFor(() => expect(stub.countFor("minutesDocument.unpublish")).toBe(1));
    expect(inputFor("minutesDocument.unpublish")).toEqual({
      boardId: "board-1",
      minutesDocumentId: "minutes-1",
    });
  });

  it("offers Unpublish to an R5 holder who is not an administrator", async () => {
    currentUser.value = {
      id: "user-2",
      townId: "town-1",
      role: "staff",
      permissions: { global: { publish_approved_minutes: true }, board_overrides: [] },
    };
    server.document = { ...baseDocument, status: "published" };
    renderRoute();

    expect(await screen.findByRole("button", { name: /^unpublish$/i })).toBeInTheDocument();
  });

  it("saves a draft through the editor and re-renders the PDF afterwards", async () => {
    server.document = { ...baseDocument, status: "draft" };
    const { user } = renderRoute();

    await user.click(await screen.findByRole("button", { name: "Edit" }));
    expect(screen.getByTestId("editor-board-id")).toHaveTextContent("board-1");
    await user.click(screen.getByTestId("editor-save"));

    await waitFor(() => expect(stub.countFor("minutesDocument.saveDraft")).toBe(1));
    expect(inputFor("minutesDocument.saveDraft")).toEqual({
      boardId: "board-1",
      minutesDocumentId: "minutes-1",
      contentJson: { sections: [{ title: "Edited" }] },
    });
    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        "/api/meetings/meeting-1/minutes/render",
        expect.objectContaining({ method: "POST" }),
      ),
    );
  });
});

describe("MinutesReviewPage — refusals", () => {
  // Publish, twice, because it has two surfaces and only one of them is
  // reachable at a time: conventions item 2's "render a refusal INSIDE the
  // confirmation dialog that triggered it", and the `aria-hidden` half of the
  // same rule.
  it("shows a refusal INSIDE the publish confirmation dialog when publish is FORBIDDEN", async () => {
    server.document = { ...baseDocument, status: "approved" };
    server.publishRefuses = true;
    const { user } = renderRoute();

    await user.click(await screen.findByRole("button", { name: /publish to portal/i }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Publish" }));

    // `findByRole` ignores anything inside an `aria-hidden` subtree, so this
    // passing at all is the assertion: the refusal is in the accessibility
    // tree, which it would not be if it rendered outside the open dialog.
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "You don't have permission to publish these minutes to the public portal.",
    );
    expect(dialog).toContainElement(alert);
  });

  it("renders the publish refusal exactly once, not also at the screen-level site", async () => {
    server.document = { ...baseDocument, status: "approved" };
    server.publishRefuses = true;
    const { user } = renderRoute();

    await user.click(await screen.findByRole("button", { name: /publish to portal/i }));
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Publish" }),
    );
    await screen.findByRole("alert");

    // Counted off the DOM rather than through the accessibility tree: a second
    // copy rendered behind the open dialog would be `aria-hidden` and
    // therefore invisible to `getAllByRole`, which is exactly how a duplicate
    // (or a misplaced sole) refusal goes unnoticed.
    expect(alertNodes()).toHaveLength(1);
  });

  it("shows a refusal INSIDE the submit dialog when submitForReview is FORBIDDEN", async () => {
    server.document = { ...baseDocument, status: "draft" };
    server.submitRefuses = true;
    const { user } = renderRoute();

    await user.click(await screen.findByRole("button", { name: /submit for review/i }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Submit for Review" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "You don't have permission to submit these minutes for review.",
    );
    expect(dialog).toContainElement(alert);
  });

  it("shows a refusal INSIDE the return-for-amendments dialog", async () => {
    server.returnRefuses = true;
    const { user } = renderRoute();

    await user.click(await screen.findByRole("button", { name: /return for amendments/i }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText(/describe the requested changes/i), "Fix it");
    await user.click(within(dialog).getByRole("button", { name: "Return for Amendments" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "You don't have permission to return these minutes for amendments.",
    );
    expect(dialog).toContainElement(alert);
  });

  it("shows a refusal at the screen level when approve is FORBIDDEN — no dialog to hold it", async () => {
    server.approveRefuses = true;
    const { user } = renderRoute();

    await user.click(await screen.findByRole("button", { name: /approve minutes/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("You don't have permission to approve these minutes.");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("shows a refusal at the screen level when unpublish is FORBIDDEN", async () => {
    server.document = { ...baseDocument, status: "published" };
    server.unpublishRefuses = true;
    const { user } = renderRoute();

    await user.click(await screen.findByRole("button", { name: /^unpublish$/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "You don't have permission to take these minutes off the public portal.",
    );
  });

  it("shows a refusal at the screen level when the editor's saveDraft is FORBIDDEN", async () => {
    server.document = { ...baseDocument, status: "draft" };
    server.saveDraftRefuses = true;
    const { user } = renderRoute();

    await user.click(await screen.findByRole("button", { name: "Edit" }));
    await user.click(screen.getByTestId("editor-save"));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "You don't have permission to save these minutes.",
    );
  });
});
