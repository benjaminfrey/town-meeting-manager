import { fileURLToPath } from "node:url";
import path from "node:path";
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import noSessionScopedSetConfig from "./eslint-rules/no-session-scoped-set-config.js";

// The root "lint" script runs a single `eslint .` from the repo root, so cwd
// is always the repo root today. Each package previously had its own "lint"
// script ("eslint src --config ../../eslint.config.js", cwd = the package
// dir) — those were removed because they scoped every run to that package's
// src/, so nothing at the repo root (e2e/, configs, this file) was ever
// linted. Flat-config `files`/`ignores` globs resolve relative to cwd by
// default, so a plain "packages/web/**" pattern would have silently matched
// nothing under the old per-package invocation. basePath is kept anchored to
// the config file's own directory (the repo root) so this block's pattern
// stays correct even if something invokes eslint from a different cwd again.
const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default tseslint.config(
  {
    // This is a bare `ignores`-only block, which ESLint treats as *global*
    // ignores. Empirically verified (see task-1-report.md) that these
    // patterns are STILL resolved relative to cwd, same as `files` above —
    // a plain "docker/volumes/**" matched an unrelated decoy file created
    // at packages/api/docker/volumes/ when eslint ran with cwd=packages/api.
    // All entries use a "**/" prefix so they match regardless of invoking
    // cwd, consistent with the dist/build/coverage/turbo/react-router
    // entries already written that way. (.superpowers is the SDD scratch
    // workspace, gitignored; added here for defense-in-depth. Now that
    // `eslint .` runs from the repo root, these repo-root paths are actually
    // reached — this is no longer just defense-in-depth.)
    ignores: [
      "**/dist/**",
      "**/build/**",
      "**/coverage/**",
      "**/.turbo/**",
      "**/.react-router/**",
      "**/docker/volumes/**",
      "**/playwright-report/**",
      "**/.superpowers/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: {
      // Repo-local rules. See eslint-rules/ for each rule's rationale; they
      // exist to make an invariant mechanical rather than cultural.
      tmm: { rules: { "no-session-scoped-set-config": noSessionScopedSetConfig } },
    },
    rules: {
      // Tenant context must be transaction-scoped. A session-scoped
      // `app.town_id` survives into the next request handed the same pooled
      // connection, with no error anywhere — see
      // eslint-rules/no-session-scoped-set-config.js.
      "tmm/no-session-scoped-set-config": "error",

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
  {
    // The rule's own RuleTester fixtures are string literals containing the
    // exact SQL the rule bans, so the rule flags its own test file — eight
    // errors, all of them the rule working correctly. Scoped to this one file
    // rather than to `**/__tests__/**`, because a real session-scoped
    // set_config in some other test would still be a defect worth failing on.
    files: ["**/no-session-scoped-set-config.test.ts"],
    rules: { "tmm/no-session-scoped-set-config": "off" },
  },
);
