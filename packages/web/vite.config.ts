import path from "node:path";
import { fileURLToPath } from "node:url";
import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, type Plugin } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";
import { VitePWA } from "vite-plugin-pwa";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.resolve(__dirname, "src");

/**
 * Explicit @/ path alias resolver for SSR compatibility.
 *
 * Vite 6's SSR module runner + React Router v7 has a two-part problem
 * with @/ tsconfig path aliases:
 *
 * 1. vite:import-analysis skips resolving SSR imports that don't match
 *    a configured resolve.alias (matchAlias check at line ~40604 in
 *    Vite source). Without a matching alias, @/... imports are treated
 *    as external packages and left as raw specifiers in the SSR code.
 *
 * 2. The SSR module runner's fetchModule() treats @/... as a bare npm
 *    import (starts with @, not . or /) and uses tryNodeResolve(),
 *    which bypasses Vite's plugin pipeline entirely.
 *
 * This plugin resolves @/ imports to absolute file paths in the
 * resolveId hook, AND we set resolve.alias so matchAlias returns true
 * for @/ imports, preventing them from being skipped.
 */
function srcAliasPlugin(): Plugin {
  return {
    name: "src-alias",
    enforce: "pre",
    async resolveId(id, importer) {
      if (id.startsWith("@/")) {
        const absolutePath = path.resolve(srcDir, id.slice(2));
        const resolved = await this.resolve(absolutePath, importer, {
          skipSelf: true,
        });
        return resolved ?? undefined;
      }
    },
  };
}

export default defineConfig({
  plugins: [
    srcAliasPlugin(),
    wasm(),
    topLevelAwait(),
    tailwindcss(),
    reactRouter(),
    tsconfigPaths(),
    VitePWA({
      registerType: "autoUpdate",
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      manifest: false, // we manage manifest.json manually in public/
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
      },
      devOptions: {
        enabled: false, // disabled in dev — conflicts with React Router v7 HMR
      },
    }),
  ],

  worker: {
    format: "es",
    plugins: () => [wasm(), topLevelAwait()],
  },

  resolve: {
    // "@" alias is required so Vite's import-analysis matchAlias() check
    // recognizes @/ imports and doesn't skip them in SSR mode. The actual
    // resolution is handled by srcAliasPlugin above.
    alias: {
      "@": srcDir,
    },
    // Ensure all packages use the same React instance.
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime"],
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
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
});
