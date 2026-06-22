import { type RouteConfig, index, layout, route } from "@react-router/dev/routes";

export default [
  // Auth — centered card layout
  layout("layouts/AuthLayout.tsx", [
    route("login", "routes/login.tsx"),
    route("signup", "routes/signup.tsx"),
    route("forgot-password", "routes/forgot-password.tsx"),
  ]),

  // Onboarding wizard — standalone, full-screen
  route("setup", "routes/setup.tsx"),

  // Authenticated application — ONE shell (sidebar + top bar + command palette)
  layout("layouts/AppShell.tsx", [
    index("routes/home.tsx"),
    route("meetings", "routes/meetings.tsx"), // Kanban board (a view, not the landing)

    // Back-compat redirects to the canonical home
    route("home", "routes/redirect-home.tsx", { id: "redirect-home" }),
    route("dashboard", "routes/redirect-home.tsx", { id: "redirect-dashboard" }),

    route("boards", "routes/boards.tsx"),
    route("boards/:boardId", "routes/boards.$boardId.tsx"),
    route("boards/:boardId/templates", "routes/boards.$boardId.templates.tsx"),
    route(
      "boards/:boardId/templates/:templateId/edit",
      "routes/boards.$boardId.templates.$templateId.edit.tsx",
    ),
    route("boards/:boardId/meetings", "routes/boards.$boardId.meetings.tsx"),

    route("people", "routes/people.tsx"),
    route("members", "routes/redirect-people.tsx"),
    route("templates", "routes/templates.tsx"),

    route("meetings/:meetingId", "routes/meetings.$meetingId.tsx"),
    // Live operator screen — full-screen focus mode, no sub-nav header
    route("meetings/:meetingId/live", "routes/meetings.$meetingId.live.tsx"),
    // Document screens share the meeting sub-nav header (board · status · tabs)
    layout("layouts/MeetingLayout.tsx", [
      route("meetings/:meetingId/agenda", "routes/meetings.$meetingId.agenda.tsx"),
      route("meetings/:meetingId/review", "routes/meetings.$meetingId.review.tsx"),
      route("meetings/:meetingId/minutes", "routes/meetings.$meetingId.minutes.tsx"),
    ]),

    route("settings", "routes/settings.tsx"),
    route("settings/town", "routes/settings.town.tsx"),
    route("settings/meeting-notices", "routes/settings.meeting-notices.tsx"),
    route("settings/minutes-workflow", "routes/settings.minutes-workflow.tsx"),
    route("settings/notifications", "routes/settings.notifications.tsx"),
    route("admin/notifications", "routes/admin.notifications.tsx"),
  ]),

  // Standalone — no shell
  route("invite/accept", "routes/invite.accept.tsx"),
] satisfies RouteConfig;
