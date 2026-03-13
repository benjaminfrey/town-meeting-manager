/**
 * Notification Service Tests
 *
 * Tests the event-to-delivery pipeline:
 *   createNotificationEvent → processNotificationEvent
 *   → subscriber resolution → preference filtering → email dispatch
 *   → push notification dispatch → delivery tracking
 *
 * Note: processNotificationEvent() catches all internal errors and marks
 * the event as "failed" rather than re-throwing. Tests verify behavior
 * through email dispatch counts and mock call assertions.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NotificationService } from "../notification-service";

// ─── Module mocks ─────────────────────────────────────────────────────

const mockSendEmail = vi.fn().mockResolvedValue({ MessageID: "test-message-id" });
const mockEmailSenderInstance = { sendEmail: mockSendEmail };

vi.mock("../email-sender.js", () => ({
  // Must use `function` (not arrow) so `new EmailSenderService()` works
  EmailSenderService: vi.fn(function () { return mockEmailSenderInstance; }),
  getMessageStream: vi.fn().mockReturnValue("outbound"),
  isBroadcastEvent: vi.fn().mockReturnValue(false),
  renderEmailTemplate: vi.fn().mockReturnValue({
    html: "<p>Test email</p>",
    text: "Test email",
    subject: "Test Subject",
  }),
}));

vi.mock("../../lib/postmark.js", () => ({
  getPostmarkClient: vi.fn().mockResolvedValue({}),
}));

const mockDispatchPushToTown = vi.fn().mockResolvedValue(undefined);
vi.mock("../../lib/push.js", () => ({
  dispatchPushToTown: (...args: unknown[]) => mockDispatchPushToTown(...args),
}));

// ─── Test data ────────────────────────────────────────────────────────

const TOWN_ID = "town-1";
const EVENT_ID = "event-1";
const BOARD_ID = "board-1";
const USER_ALICE = "user-alice";
const USER_BOB = "user-bob";
const USER_CAROL = "user-carol";

// Board-scoped event — needs board_id in payload for subscriber resolution
const mockEvent = {
  id: EVENT_ID,
  town_id: TOWN_ID,
  event_type: "agenda_published",
  payload: {
    board_id: BOARD_ID,
    boardName: "Select Board",
    meetingDate: "2026-03-13",
    agendaUrl: "https://testville.gov/agenda",
  },
  status: "pending",
};

const mockBoardMembers = [
  { user_account_id: USER_ALICE },
  { user_account_id: USER_BOB },
  { user_account_id: USER_CAROL },
];

const mockUsers = [
  { id: USER_ALICE, email: "alice@testville.gov", display_name: "Alice Johnson", email_bounced: false, email_complained: false },
  { id: USER_BOB, email: "bob@testville.gov", display_name: "Bob Smith", email_bounced: false, email_complained: false },
  { id: USER_CAROL, email: "carol@testville.gov", display_name: "Carol Davis", email_bounced: false, email_complained: false },
];

const mockTownConfig = {
  postmark_sender_email: "notifications@testville.gov",
  postmark_sender_name: "Town of Testville",
};

const mockDelivery = { id: "delivery-1" };

// ─── Mock Supabase factory ────────────────────────────────────────────

/**
 * Builds a mock Supabase for processNotificationEvent tests.
 * Uses per-table call counting to return the right data on each invocation.
 */
function buildProcessSupabase(opts: {
  event?: object | null;
  boardMembers?: object[];
  users?: object[];
  townConfig?: object | null;
  town?: object;
  disabledPrefs?: object[];
  delivery?: object;
} = {}) {
  const {
    event = mockEvent,
    boardMembers = mockBoardMembers,
    users = mockUsers,
    townConfig = mockTownConfig,
    town = { name: "Testville", subdomain: "testville" },
    disabledPrefs = [],
    delivery = mockDelivery,
  } = opts;

  // Track how many times notification_event has been visited
  const eventCallCount = { n: 0 };

  return {
    from: (table: string) => {
      // Count each from("notification_event") call:
      // call 1 = UPDATE (awaited via .then, no .single())
      // call 2 = SELECT .single() — this is where we return the event
      if (table === "notification_event") eventCallCount.n++;

      const builder: Record<string, unknown> = {};
      builder["select"] = () => builder;
      builder["update"] = () => builder;
      builder["insert"] = () => builder;
      builder["eq"] = () => builder;
      builder["in"] = () => builder;
      builder["not"] = () => builder;
      builder["order"] = () => builder;

      builder["single"] = () => {
        let data: unknown = null;
        if (table === "notification_event") {
          // Return the event only on the 2nd from() call (the SELECT)
          data = eventCallCount.n >= 2 ? event : null;
        } else if (table === "town_notification_config") {
          data = townConfig;
        } else if (table === "notification_delivery") {
          data = delivery;
        } else if (table === "user_account") {
          data = users[0] ?? null;
        } else if (table === "town") {
          data = town ?? null;
        }
        return Promise.resolve({ data, error: null });
      };

      builder["then"] = (
        resolve: (v: unknown) => unknown,
        reject?: (v: unknown) => unknown,
      ) => {
        let arr: unknown[] = [];
        switch (table) {
          case "board_member": arr = boardMembers; break;
          case "user_account": arr = users; break;
          case "subscriber_notification_preference": arr = disabledPrefs; break;
          case "town": arr = town ? [town] : []; break;
          default: arr = [];
        }
        return Promise.resolve({ data: arr, error: null }).then(resolve, reject);
      };

      return builder;
    },
  } as unknown as SupabaseClient;
}

// ─── Tests ────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockSendEmail.mockResolvedValue({ MessageID: "test-message-id" });
  mockDispatchPushToTown.mockResolvedValue(undefined);
});

describe("NotificationService", () => {
  describe("createNotificationEvent", () => {
    it("inserts an event record and returns the generated event ID", async () => {
      const supabase = {
        from: () => ({
          insert: () => ({
            select: () => ({
              single: () => Promise.resolve({ data: { id: EVENT_ID }, error: null }),
            }),
          }),
        }),
      } as unknown as SupabaseClient;

      const service = new NotificationService(supabase);
      const id = await service.createNotificationEvent(
        "agenda_published",
        TOWN_ID,
        { board_id: BOARD_ID, boardName: "Select Board" },
      );

      expect(id).toBe(EVENT_ID);
    });

    it("throws when notification_event insert fails", async () => {
      const supabase = {
        from: () => ({
          insert: () => ({
            select: () => ({
              single: () =>
                Promise.resolve({ data: null, error: { message: "DB connection lost" } }),
            }),
          }),
        }),
      } as unknown as SupabaseClient;

      const service = new NotificationService(supabase);
      await expect(
        service.createNotificationEvent("agenda_published", TOWN_ID, {}),
      ).rejects.toThrow("Failed to create notification event");
    });

    it("schedules async processing via setImmediate (non-blocking)", async () => {
      const processSpy = vi.fn().mockResolvedValue(undefined);
      const supabase = {
        from: () => ({
          insert: () => ({
            select: () => ({
              single: () => Promise.resolve({ data: { id: EVENT_ID }, error: null }),
            }),
          }),
        }),
      } as unknown as SupabaseClient;

      const service = new NotificationService(supabase);
      service.processNotificationEvent = processSpy;

      await service.createNotificationEvent("agenda_published", TOWN_ID, {});

      // Not called synchronously
      expect(processSpy).not.toHaveBeenCalled();

      // Flush setImmediate queue
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(processSpy).toHaveBeenCalledWith(EVENT_ID);
    });
  });

  describe("processNotificationEvent", () => {
    it("dispatches emails to all eligible board subscribers", async () => {
      const supabase = buildProcessSupabase();
      const service = new NotificationService(supabase);

      await service.processNotificationEvent(EVENT_ID);

      expect(mockSendEmail).toHaveBeenCalledTimes(3);
    });

    it("sends email to each board member's email address", async () => {
      const supabase = buildProcessSupabase();
      const service = new NotificationService(supabase);

      await service.processNotificationEvent(EVENT_ID);

      const recipients = mockSendEmail.mock.calls.map(
        (c) => (c[0] as { to: string }).to,
      );
      expect(recipients).toContain("alice@testville.gov");
      expect(recipients).toContain("bob@testville.gov");
      expect(recipients).toContain("carol@testville.gov");
    });

    it("uses town_notification_config sender details in From address", async () => {
      const supabase = buildProcessSupabase();
      const service = new NotificationService(supabase);

      await service.processNotificationEvent(EVENT_ID);

      const from = (mockSendEmail.mock.calls[0][0] as { from: string }).from;
      expect(from).toContain("notifications@testville.gov");
      expect(from).toContain("Town of Testville");
    });

    it("falls back to subdomain-derived sender when no town_notification_config row", async () => {
      const supabase = buildProcessSupabase({ townConfig: null });
      const service = new NotificationService(supabase);

      await service.processNotificationEvent(EVENT_ID);

      const from = (mockSendEmail.mock.calls[0][0] as { from: string }).from;
      expect(from).toContain("testville.townmeetingmanager.com");
    });

    it("excludes subscribers who have disabled the notification type", async () => {
      const supabase = buildProcessSupabase({
        disabledPrefs: [{ subscriber_id: USER_BOB }],
      });
      const service = new NotificationService(supabase);

      await service.processNotificationEvent(EVENT_ID);

      // Only Alice + Carol get emails
      expect(mockSendEmail).toHaveBeenCalledTimes(2);
      const recipients = mockSendEmail.mock.calls.map(
        (c) => (c[0] as { to: string }).to,
      );
      expect(recipients).not.toContain("bob@testville.gov");
    });

    it("sends zero emails when all subscribers have opted out", async () => {
      const supabase = buildProcessSupabase({
        disabledPrefs: [
          { subscriber_id: USER_ALICE },
          { subscriber_id: USER_BOB },
          { subscriber_id: USER_CAROL },
        ],
      });
      const service = new NotificationService(supabase);

      await service.processNotificationEvent(EVENT_ID);

      expect(mockSendEmail).not.toHaveBeenCalled();
    });

    it("sends zero emails when the board has no active members", async () => {
      const supabase = buildProcessSupabase({ boardMembers: [] });
      const service = new NotificationService(supabase);

      await service.processNotificationEvent(EVENT_ID);

      expect(mockSendEmail).not.toHaveBeenCalled();
    });

    it("dispatches push notifications for agenda_published events", async () => {
      const supabase = buildProcessSupabase();
      const service = new NotificationService(supabase);

      await service.processNotificationEvent(EVENT_ID);

      expect(mockDispatchPushToTown).toHaveBeenCalledOnce();
      const [, townId, eventType, payload] = mockDispatchPushToTown.mock.calls[0] as [
        unknown, string, string, { title: string },
      ];
      expect(townId).toBe(TOWN_ID);
      expect(eventType).toBe("agenda_published");
      expect(payload.title).toBeTruthy();
    });

    it("does not dispatch push for event types not in the push event map", async () => {
      // minutes_review has no push equivalent
      const supabase = buildProcessSupabase({
        event: { ...mockEvent, event_type: "minutes_review" },
      });
      const service = new NotificationService(supabase);

      await service.processNotificationEvent(EVENT_ID);

      expect(mockDispatchPushToTown).not.toHaveBeenCalled();
    });

    it("handles missing event gracefully without throwing (marks as failed internally)", async () => {
      // All notification_event queries return null event
      const noDataSupabase = {
        from: () => ({
          select: () => ({
            eq: () => ({
              single: () => Promise.resolve({ data: null, error: null }),
            }),
          }),
          update: () => ({
            eq: () => ({
              // Awaitable builder
              then: (resolve: (v: unknown) => unknown) =>
                Promise.resolve({ data: null, error: null }).then(resolve),
            }),
          }),
          insert: () => ({
            eq: () => ({
              then: (resolve: (v: unknown) => unknown) =>
                Promise.resolve({ data: null, error: null }).then(resolve),
            }),
          }),
        }),
      } as unknown as SupabaseClient;

      const service = new NotificationService(noDataSupabase);

      // Should resolve (not throw) — error is caught internally
      await expect(
        service.processNotificationEvent("missing-id"),
      ).resolves.toBeUndefined();

      expect(mockSendEmail).not.toHaveBeenCalled();
    });
  });

  describe("subscriber resolution by event type", () => {
    it("resolves zero subscribers for board-scoped event when payload lacks board_id", async () => {
      const supabase = buildProcessSupabase({
        event: { ...mockEvent, payload: { boardName: "Select Board" } }, // no board_id
      });
      const service = new NotificationService(supabase);

      await service.processNotificationEvent(EVENT_ID);

      expect(mockSendEmail).not.toHaveBeenCalled();
    });
  });

  describe("email delivery tracking", () => {
    it("tags emails with the event type", async () => {
      const supabase = buildProcessSupabase();
      const service = new NotificationService(supabase);

      await service.processNotificationEvent(EVENT_ID);

      const tag = (mockSendEmail.mock.calls[0][0] as { tag: string }).tag;
      expect(tag).toBe("agenda_published");
    });

    it("includes town_id, event_id, delivery_id in email metadata", async () => {
      const supabase = buildProcessSupabase();
      const service = new NotificationService(supabase);

      await service.processNotificationEvent(EVENT_ID);

      const meta = (
        mockSendEmail.mock.calls[0][0] as {
          metadata: { town_id: string; event_id: string; delivery_id: string };
        }
      ).metadata;
      expect(meta.town_id).toBe(TOWN_ID);
      expect(meta.event_id).toBe(EVENT_ID);
      expect(meta.delivery_id).toBeTruthy();
    });

    it("passes preferences URL in template variables", async () => {
      const { renderEmailTemplate } = await import("../email-sender.js");
      const supabase = buildProcessSupabase();
      const service = new NotificationService(supabase);

      await service.processNotificationEvent(EVENT_ID);

      const vars = vi.mocked(renderEmailTemplate).mock.calls[0][1] as {
        preferencesUrl: string;
      };
      expect(vars.preferencesUrl).toContain("/settings/notifications");
    });

    it("uses display_name as recipientName when available", async () => {
      const { renderEmailTemplate } = await import("../email-sender.js");
      const supabase = buildProcessSupabase();
      const service = new NotificationService(supabase);

      await service.processNotificationEvent(EVENT_ID);

      const vars = vi.mocked(renderEmailTemplate).mock.calls[0][1] as {
        recipientName: string;
      };
      expect(vars.recipientName).toBe("Alice Johnson");
    });

    it("falls back to email address when display_name is null", async () => {
      const { renderEmailTemplate } = await import("../email-sender.js");
      const usersNoName = mockUsers.map((u) => ({ ...u, display_name: null }));
      const supabase = buildProcessSupabase({ users: usersNoName });
      const service = new NotificationService(supabase);

      await service.processNotificationEvent(EVENT_ID);

      const vars = vi.mocked(renderEmailTemplate).mock.calls[0][1] as {
        recipientName: string;
      };
      expect(vars.recipientName).toBe("alice@testville.gov");
    });
  });
});
