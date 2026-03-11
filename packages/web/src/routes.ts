import { type RouteConfig, index, layout, route } from "@react-router/dev/routes";

export default [
  // Auth routes — minimal layout (no sidebar)
  layout("layouts/AuthLayout.tsx", [
    route("login", "routes/login.tsx"),
    route("signup", "routes/signup.tsx"),
    route("forgot-password", "routes/forgot-password.tsx"),
  ]),

  // Onboarding wizard — standalone layout (wider than auth, no sidebar)
  route("setup", "routes/setup.tsx"),

  // App routes — full layout with sidebar
  layout("layouts/RootLayout.tsx", [
    // Index route redirects to /dashboard
    index("routes/home.tsx"),
    route("dashboard", "routes/dashboard.tsx"),
    route("boards", "routes/boards.tsx"),
    route("boards/:boardId", "routes/boards.$boardId.tsx"),
    route("boards/:boardId/templates", "routes/boards.$boardId.templates.tsx"),
    route("boards/:boardId/templates/:templateId/edit", "routes/boards.$boardId.templates.$templateId.edit.tsx"),
    route("boards/:boardId/meetings", "routes/boards.$boardId.meetings.tsx"),
    route("meetings/:meetingId", "routes/meetings.$meetingId.tsx"),
    route("meetings/:meetingId/agenda", "routes/meetings.$meetingId.agenda.tsx"),
    route("settings", "routes/settings.tsx"),
  ]),
] satisfies RouteConfig;
