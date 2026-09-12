/**
 * The two connection signals the SSE world has, and the silence they keep.
 *
 * Phase E, wave 5, Task 6. Both components in `ConnectionStatusBar.tsx` render
 * NOTHING in their healthy state, which is the property most likely to be
 * broken by a well-meaning edit and the one an eyeball on a running app cannot
 * check — "I don't see a banner" looks identical to "the component crashed and
 * its error boundary rendered null". So every test here asserts both
 * directions.
 *
 * No Supabase mock, deliberately: this module used to open a
 * `"connection-heartbeat"` Realtime channel and its test would have needed
 * one. It now reads TanStack Query's `onlineManager`, which is a real object
 * the test can drive directly — no transport, no fake.
 */

import { describe, it, expect, afterEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { onlineManager } from "@tanstack/react-query";
import { ConnectionStatusBar, LiveStreamStatusBar } from "@/components/ConnectionStatusBar";

afterEach(() => {
  // `onlineManager` is a module singleton shared with every other test file in
  // the same worker. Leaving it offline would make unrelated suites' queries
  // silently never run.
  onlineManager.setOnline(true);
});

describe("ConnectionStatusBar — the app shell's offline pill", () => {
  it("says nothing at all while the device is online", () => {
    onlineManager.setOnline(true);
    const { container } = render(<ConnectionStatusBar />);
    expect(container).toBeEmptyDOMElement();
  });

  it("announces the outage when the device goes offline", () => {
    onlineManager.setOnline(false);
    render(<ConnectionStatusBar />);
    // `role="status"` rather than `alert`: being offline is a standing
    // condition the user can see in their own OS, not an interruption.
    expect(screen.getByRole("status")).toHaveTextContent("Offline");
  });

  it("reacts to the same manager TanStack Query pauses mutations on", () => {
    // The whole point of reading `onlineManager` instead of `navigator.onLine`
    // directly: the pill cannot disagree with what the cache is doing. If this
    // subscription were replaced by a private `window.addEventListener`, this
    // test would go red while the component still "worked".
    onlineManager.setOnline(true);
    const { container } = render(<ConnectionStatusBar />);
    expect(container).toBeEmptyDOMElement();

    // `act` because the store notifies its subscribers synchronously, outside
    // React's own scheduling — the update is real, the wrapper is only what
    // lets the test observe it settled.
    act(() => onlineManager.setOnline(false));
    expect(screen.getByRole("status")).toHaveTextContent("Offline");

    act(() => onlineManager.setOnline(true));
    expect(container).toBeEmptyDOMElement();
  });
});

describe("LiveStreamStatusBar — the live meeting's own transport", () => {
  it("says nothing while the stream is healthy", () => {
    const { container } = render(<LiveStreamStatusBar status="healthy" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("is a polite status while the client is still trying", () => {
    render(<LiveStreamStatusBar status="reconnecting" />);
    const bar = screen.getByRole("status");
    expect(bar).toHaveTextContent("reconnecting");
    // Not an alert: the client usually wins, and this is the state a genuine
    // outage passes through on its way to being over.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("is an ALERT once the client has stopped, and says what to do", () => {
    render(<LiveStreamStatusBar status="stopped" />);
    const bar = screen.getByRole("alert");
    // A `TRPCError` makes `httpSubscriptionLink` stop rather than resume, so
    // nothing further happens without the user acting. The copy has to say so;
    // "connection lost" alone leaves a clerk waiting for a recovery that is
    // never coming.
    expect(bar).toHaveTextContent("Reload this page");
    expect(bar).toHaveTextContent("stopped");
  });
});
