import { Suspense, lazy } from "react";
import { Routes, Route } from "react-router";
import { PortalProvider } from "./PortalProvider";
import { PortalLayout } from "./PortalLayout";
import "./portal.css";

// Lazy load pages for code splitting
const PortalHome = lazy(() => import("./pages/PortalHome"));
const MeetingsList = lazy(() => import("./pages/MeetingsList"));
const MeetingDetail = lazy(() => import("./pages/MeetingDetail"));
const AgendaView = lazy(() => import("./pages/AgendaView"));
const MinutesView = lazy(() => import("./pages/MinutesView"));
const BoardDirectory = lazy(() => import("./pages/BoardDirectory"));
const BoardDetail = lazy(() => import("./pages/BoardDetail"));
const MeetingCalendar = lazy(() => import("./pages/MeetingCalendar"));
const SearchResults = lazy(() => import("./pages/SearchResults"));
const Portal404 = lazy(() => import("./pages/Portal404"));

export function PortalApp({ subdomain }: { subdomain: string }) {
  return (
    <PortalProvider subdomain={subdomain}>
      <PortalLayout>
        <Suspense fallback={<LoadingSpinner />}>
          <Routes>
            <Route index element={<PortalHome />} />
            <Route path="meetings" element={<MeetingsList />} />
            <Route path="meetings/:meetingId" element={<MeetingDetail />} />
            <Route
              path="meetings/:meetingId/agenda"
              element={<AgendaView />}
            />
            <Route
              path="meetings/:meetingId/minutes"
              element={<MinutesView />}
            />
            <Route path="boards" element={<BoardDirectory />} />
            <Route path="boards/:boardId" element={<BoardDetail />} />
            <Route path="calendar" element={<MeetingCalendar />} />
            <Route path="search" element={<SearchResults />} />
            <Route path="*" element={<Portal404 />} />
          </Routes>
        </Suspense>
      </PortalLayout>
    </PortalProvider>
  );
}

function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-300 border-t-slate-700" />
    </div>
  );
}
