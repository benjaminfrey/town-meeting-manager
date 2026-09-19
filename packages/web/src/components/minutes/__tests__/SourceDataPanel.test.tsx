/**
 * `components/minutes/SourceDataPanel.tsx` — its six reads, and the five
 * phantom columns the migration removed.
 *
 * Phase E, wave 6, Task 3. `components/minutes/` had NO test file at all
 * before this wave, so nothing here is adapted from anything: the transport
 * is stubbed (conventions item 8), `@/lib/trpc` is untouched, and every
 * payload below is bound to its procedure's own output type.
 *
 * The four assertions that matter most are the ones that could not have been
 * written before: this panel read `motion.moved_by_name`,
 * `motion.seconded_by_name`, `motion.yeas`/`nays`/`abstentions`,
 * `vote_record.member_name` and `agenda_item_transition.transition_type` off
 * `Record<string, unknown>` rows, and NONE of those five is a column. Each
 * read `undefined` behind a truthiness guard, so the panel rendered less than
 * its source suggested and no test could see it. They are pinned here as
 * behaviour, by the text that now appears.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders, setupAppQueryClient } from "@/test/render";
import { installTRPCFetchStub } from "@/test/trpc";
import { type RouterOutputs } from "@/lib/trpc";
import type { MinutesContentJson } from "@town-meeting/shared/types";
import { SourceDataPanel } from "../SourceDataPanel";

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ townId: "town-1" }),
}));

const queryClient = setupAppQueryClient();

type AgendaItem = RouterOutputs["agendaItem"]["byMeeting"][number];
/**
 * `& { vote_summary: unknown }` is not decoration. `RouterOutputs` runs the
 * procedure's row through tRPC's serialization inference, which turns an
 * `unknown` column into an OPTIONAL property (`unknown` includes `undefined`),
 * while `TestHandlers` infers from `inferProcedureOutput` directly and still
 * requires it. The intersection restores the requirement, so a fixture that
 * forgets the column is a compile error here rather than a handler TS rejects.
 */
type Motion = RouterOutputs["motion"]["byMeeting"][number] & { vote_summary: unknown };
type VoteRecord = RouterOutputs["voteRecord"]["byMeeting"][number];
type Transition = RouterOutputs["agendaItemTransition"]["byMeeting"][number];
type Speaker = RouterOutputs["guestSpeaker"]["byMeeting"][number];
type Seat = RouterOutputs["boardMember"]["roster"][number];

function agendaItem(overrides: Partial<AgendaItem> & { id: string }): AgendaItem {
  return {
    section_type: "new_business",
    sort_order: 0,
    title: "Road repairs",
    description: null,
    presenter: null,
    estimated_duration: null,
    parent_item_id: null,
    staff_resource: null,
    background: null,
    recommendation: null,
    suggested_motion: null,
    status: "completed",
    operator_notes: null,
    source_minutes_document_id: null,
    ...overrides,
  };
}

function motion(overrides: Partial<Motion> & { id: string }): Motion {
  return {
    agenda_item_id: "item-1",
    motion_text: "Move to approve the road repairs contract",
    motion_type: "main",
    moved_by: null,
    seconded_by: null,
    status: "passed",
    parent_motion_id: null,
    vote_summary: null,
    created_at: "2026-01-01T19:05:00Z",
    ...overrides,
  };
}

function seat(overrides: Partial<Seat> & { id: string; name: string }): Seat {
  return {
    person_id: "person-1",
    board_id: "board-1",
    seat_title: null,
    term_start: null,
    term_end: null,
    status: "active",
    is_default_rec_sec: false,
    email: null,
    user_account_id: null,
    role: null,
    gov_title: null,
    user_account_archived_at: null,
    invitation_id: null,
    invitation_status: null,
    invitation_sent_at: null,
    invitation_expires_at: null,
    ...overrides,
  };
}

const server = {
  items: [] as AgendaItem[],
  motions: [] as Motion[],
  votes: [] as VoteRecord[],
  transitions: [] as Transition[],
  speakers: [] as Speaker[],
  roster: [] as Seat[],
};

const stub = installTRPCFetchStub({
  "agendaItem.byMeeting": () => server.items,
  "motion.byMeeting": () => server.motions,
  "voteRecord.byMeeting": () => server.votes,
  "agendaItemTransition.byMeeting": () => server.transitions,
  "guestSpeaker.byMeeting": () => server.speakers,
  "boardMember.roster": () => server.roster,
});

const contentJson = {
  meeting_header: {
    town_name: "Testville",
    board_name: "Select Board",
    board_type: null,
    meeting_date: "2026-01-01",
    meeting_type: "regular",
    location: null,
    called_to_order_at: null,
    adjourned_at: null,
  },
  attendance: { present: [], absent: [], staff: [], quorum_met: true },
  sections: [
    { section_type: "new_business", title: "New Business", items: [], marked_none: false },
  ],
  adjournment: null,
  certification: { recorded_by: null, recorded_by_title: null, approved_on: null },
} as unknown as MinutesContentJson;

function renderPanel(sectionIndex = 0) {
  return renderWithProviders(
    <SourceDataPanel
      meetingId="meeting-1"
      boardId="board-1"
      selectedSectionIndex={sectionIndex}
      contentJson={contentJson}
    />,
    { queryClient },
  );
}

beforeEach(() => {
  server.items = [agendaItem({ id: "item-1" })];
  server.motions = [];
  server.votes = [];
  server.transitions = [];
  server.speakers = [];
  server.roster = [];
});

describe("SourceDataPanel", () => {
  it("asks a section it has no content for to be selected", () => {
    renderPanel(7);
    expect(screen.getByText("Select a section to view source data")).toBeInTheDocument();
  });

  it("reads all six procedures for the meeting and the board", async () => {
    renderPanel();

    await screen.findByText("Section: New Business");
    expect(stub.countFor("agendaItem.byMeeting")).toBeGreaterThan(0);
    expect(stub.countFor("motion.byMeeting")).toBeGreaterThan(0);
    expect(stub.countFor("voteRecord.byMeeting")).toBeGreaterThan(0);
    expect(stub.countFor("agendaItemTransition.byMeeting")).toBeGreaterThan(0);
    expect(stub.countFor("guestSpeaker.byMeeting")).toBeGreaterThan(0);
    expect(stub.countFor("boardMember.roster")).toBeGreaterThan(0);
  });

  it("renders the empty state when the section has no source data", async () => {
    renderPanel();
    expect(await screen.findByText("No source data found for this section.")).toBeInTheDocument();
  });

  it("shows the mover and seconder by NAME — the columns read before were moved_by_name/seconded_by_name, which do not exist", async () => {
    server.roster = [
      seat({ id: "seat-1", name: "Ada Whitfield" }),
      seat({ id: "seat-2", name: "Marcus Bell", person_id: "person-2" }),
    ];
    server.motions = [motion({ id: "m-1", moved_by: "seat-1", seconded_by: "seat-2" })];
    renderPanel();

    expect(await screen.findByText("Moved: Ada Whitfield")).toBeInTheDocument();
    expect(screen.getByText("| Seconded: Marcus Bell")).toBeInTheDocument();
  });

  it("shows the vote tally from vote_summary — the yeas/nays/abstentions columns read before do not exist", async () => {
    server.motions = [
      motion({
        id: "m-1",
        vote_summary: { yeas: 3, nays: 1, abstentions: 2, recusals: 0, absent: 0 },
      }),
    ];
    renderPanel();

    expect(await screen.findByText("Yeas: 3")).toBeInTheDocument();
    expect(screen.getByText("Nays: 1")).toBeInTheDocument();
    expect(screen.getByText("Abstentions: 2")).toBeInTheDocument();
  });

  it("hides the tally for a motion that has never been voted on", async () => {
    server.motions = [motion({ id: "m-1", vote_summary: null })];
    renderPanel();

    await screen.findByText("Move to approve the road repairs contract");
    expect(screen.queryByText(/^Yeas:/)).not.toBeInTheDocument();
  });

  it("names each individual voter — vote_record.member_name is not a column either", async () => {
    server.roster = [seat({ id: "seat-1", name: "Ada Whitfield" })];
    server.motions = [motion({ id: "m-1" })];
    server.votes = [
      {
        id: "v-1",
        motion_id: "m-1",
        board_member_id: "seat-1",
        vote: "yea",
        recusal_reason: null,
        created_at: "2026-01-01T19:06:00Z",
      },
      {
        id: "v-2",
        motion_id: "m-1",
        board_member_id: "seat-missing",
        vote: "nay",
        recusal_reason: null,
        created_at: "2026-01-01T19:06:00Z",
      },
    ];
    renderPanel();

    expect(await screen.findByText("Ada Whitfield: yea")).toBeInTheDocument();
    // A seat the roster no longer carries is named, not rendered as ": nay".
    expect(screen.getByText("Unknown member: nay")).toBeInTheDocument();
  });

  it("renders a transition's timestamps under a literal label", async () => {
    server.transitions = [
      {
        id: "t-1",
        agenda_item_id: "item-1",
        started_at: "2026-01-01T19:00:00Z",
        ended_at: null,
      },
    ];
    renderPanel();

    expect(await screen.findByText("Transition")).toBeInTheDocument();
    // An open transition still renders its placeholder end time.
    expect(screen.getByText(/→ --/)).toBeInTheDocument();
  });

  it("lists guest speakers and operator notes for the section's items", async () => {
    server.items = [agendaItem({ id: "item-1", operator_notes: "Chair called for order" })];
    server.speakers = [
      {
        id: "gs-1",
        agenda_item_id: "item-1",
        name: "Jane Public",
        address: null,
        topic: "Culvert",
        created_at: "2026-01-01T19:10:00Z",
      },
    ];
    renderPanel();

    expect(await screen.findByText("Jane Public")).toBeInTheDocument();
    expect(screen.getByText("- Culvert")).toBeInTheDocument();
    expect(screen.getByText("Chair called for order")).toBeInTheDocument();
  });

  it("ignores rows belonging to another section's agenda items", async () => {
    server.items = [
      agendaItem({ id: "item-1", section_type: "new_business" }),
      agendaItem({ id: "item-2", section_type: "old_business" }),
    ];
    server.motions = [
      motion({ id: "m-1", agenda_item_id: "item-2", motion_text: "Not this section" }),
    ];
    renderPanel();

    expect(await screen.findByText("No source data found for this section.")).toBeInTheDocument();
    expect(screen.queryByText("Not this section")).not.toBeInTheDocument();
  });
});
