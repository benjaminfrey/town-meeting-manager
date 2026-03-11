/**
 * Timer hook for live meetings.
 *
 * Computes elapsed time from a stored `startedAt` timestamp using a
 * 1-second interval. Works offline since it references a stored
 * timestamp, not a network clock.
 */

import { useEffect, useState } from "react";

export function useMeetingTimer(startedAt: string | null): {
  elapsedSeconds: number;
  formatted: string;
} {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    if (!startedAt) {
      setElapsedSeconds(0);
      return;
    }

    const startTime = new Date(startedAt).getTime();

    const update = () => {
      const now = Date.now();
      setElapsedSeconds(Math.max(0, Math.floor((now - startTime) / 1000)));
    };

    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [startedAt]);

  const hours = Math.floor(elapsedSeconds / 3600);
  const minutes = Math.floor((elapsedSeconds % 3600) / 60);
  const seconds = elapsedSeconds % 60;

  let formatted: string;
  if (hours > 0) {
    formatted = `${hours}h ${minutes.toString().padStart(2, "0")}m`;
  } else if (minutes > 0) {
    formatted = `${minutes}:${seconds.toString().padStart(2, "0")}`;
  } else {
    formatted = `0:${seconds.toString().padStart(2, "0")}`;
  }

  return { elapsedSeconds, formatted };
}
