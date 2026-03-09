import type { Config } from "@react-router/dev/config";

export default {
  // SPA mode — no server rendering for offline-first architecture
  ssr: false,
  // Source files live in src/
  appDirectory: "src",
} satisfies Config;
