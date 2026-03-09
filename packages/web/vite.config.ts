import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";

export default defineConfig({
  plugins: [wasm(), topLevelAwait(), tailwindcss(), reactRouter(), tsconfigPaths()],

  worker: {
    format: "es",
    plugins: () => [wasm(), topLevelAwait()],
  },

  optimizeDeps: {
    // @journeyapps/wa-sqlite and @powersync/web contain WASM + web workers
    // that esbuild cannot process — exclude from Vite's dep pre-bundling.
    exclude: ["@journeyapps/wa-sqlite", "@powersync/web"],
    include: ["@powersync/web > js-logger"],
  },

  server: {
    port: 5173,
    // Required for SharedArrayBuffer (OPFS multi-tab support)
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
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
