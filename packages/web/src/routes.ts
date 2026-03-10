import { type RouteConfig, index, layout, route } from "@react-router/dev/routes";

export default [
  // Auth routes — minimal layout (no sidebar)
  layout("layouts/AuthLayout.tsx", [
    route("login", "routes/login.tsx"),
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
    route("meetings/:meetingId", "routes/meetings.$meetingId.tsx"),
    route("settings", "routes/settings.tsx"),
  ]),
] satisfies RouteConfig;
