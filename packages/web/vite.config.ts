import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tailwindcss(), reactRouter(), tsconfigPaths()],
  server: {
    port: 5173,
    proxy: {
      "/auth": {
        target: "http://localhost:54321",
        changeOrigin: true,
      },
      "/rest": {
        target: "http://localhost:54321",
        changeOrigin: true,
      },
      "/storage": {
        target: "http://localhost:54321",
        changeOrigin: true,
      },
    },
  },
});
