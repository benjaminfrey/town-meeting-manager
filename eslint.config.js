import { fileURLToPath } from "node:url";
import path from "node:path";
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

// turbo (and each package's own "lint" script) runs eslint with the package
// directory as cwd. Flat-config `files`/`ignores` globs are resolved relative
// to cwd by default, so a plain "packages/web/**" pattern silently matches
// nothing when eslint is invoked from inside packages/web itself. Anchoring
// this one block's basePath to the config file's own directory (the repo
// root) makes the pattern behave the same regardless of invoking cwd.
const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/build/**",
      "**/coverage/**",
      "**/.turbo/**",
      "**/.react-router/**",
      "docker/volumes/**",
      "playwright-report/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      // Errors: these indicate real defects.
      "no-console": ["error", { allow: ["warn", "error"] }],
      "@typescript-eslint/no-floating-promises": "off",

      // Warnings: real signal, but too numerous to gate CI on today.
      // Stage 2's test-floor task ratchets these to error.
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    basePath: rootDir,
    files: ["packages/web/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
  {
    files: ["**/*.test.ts", "**/*.test.tsx", "**/__tests__/**"],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
  {
    // Sole @ts-nocheck user in the repo (verified via repo-wide grep). The
    // file-level suppression predates this config and exists because
    // noUncheckedIndexedAccess makes its many `arr[i]` mock-builder accesses
    // read as possibly-undefined; the indices are safe by construction. One
    // file, not a pattern — downgraded to warn here rather than disabling
    // ban-ts-comment repo-wide, which would hide a real footgun everywhere else.
    files: ["**/minutes-generation.test.ts"],
    rules: { "@typescript-eslint/ban-ts-comment": "warn" },
  },
);
