/**
 * MeetingLayout — wraps a meeting's document screens (agenda / review / minutes)
 * with the shared sub-nav header so every one shows which meeting, its status,
 * and tabs between stages. The live operator screen is intentionally NOT nested
 * here — it stays a full-screen focus mode.
 */

import { Outlet, useParams } from "react-router";
import { MeetingSubnavHeader } from "@/components/MeetingSubnavHeader";

export default function MeetingLayout() {
  const { meetingId } = useParams();
  return (
    <>
      {meetingId && <MeetingSubnavHeader meetingId={meetingId} />}
      <Outlet />
    </>
  );
}
