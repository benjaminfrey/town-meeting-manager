# Session M.01 — Infrastructure Swap: Remove PowerSync, Add TanStack Query

**Phase:** Migration | **Block:** PowerSync → TanStack Query
**Dependencies:** None
**Estimated tasks:** 12

---

## Description

Remove all PowerSync infrastructure from the monorepo: the Docker service, npm packages, config files, environment variables, and the powersync/ directory. Install TanStack Query, react-hook-form, and web-push. The app will not compile after this session because many source files still import from @powersync packages — that is expected and will be resolved in M.02 through M.11.

## Tasks

1. Remove the `powersync:` service block from `docker/docker-compose.yml` (the entire service section, approximately lines 274–310)
2. Remove the `mongo:` service from `docker/docker-compose.yml` if present (PowerSync dependency)
3. Remove `@powersync/react`, `@powersync/web`, and `@powersync/kysely-driver` from `packages/web/package.json`
4. Remove `@powersync/common` from `packages/shared/package.json`
5. Remove the `"./powersync"` export entry from `packages/shared/package.json` exports field
6. Remove the PowerSync WASM optimizeDeps exclusions from `packages/web/vite.config.ts` (the `optimizeDeps.exclude` entries for `@journeyapps/wa-sqlite` and `@powersync/web`, and the `optimizeDeps.include` entry for `@powersync/web > js-logger`)
7. Install TanStack Query in the web package: `pnpm --filter @town-meeting/web add @tanstack/react-query` and `pnpm --filter @town-meeting/web add -D @tanstack/react-query-devtools`
8. Install react-hook-form and Zod resolver in the web package: `pnpm --filter @town-meeting/web add react-hook-form @hookform/resolvers`
9. Install web-push in the API package: `pnpm --filter @town-meeting/api add web-push` and `pnpm --filter @town-meeting/api add -D @types/web-push`
10. Remove `VITE_POWERSYNC_URL` from `packages/web/.env` and `packages/web/.env.example`
11. Delete the `powersync/` directory at the repo root (contains `powersync.yaml` and `sync-rules.yaml`)
12. Run `pnpm install` at the repo root to update the lockfile

## Prompt

```
You are performing the first step of a migration from PowerSync to TanStack Query + Supabase Realtime for the Town Meeting Manager project. This session removes PowerSync infrastructure and installs the replacement packages. The app will NOT compile at the end of this session — that is expected and intentional. Do not attempt to fix TypeScript errors caused by remaining @powersync imports in source files. Those will be resolved in sessions M.02 through M.11.

PROJECT CONTEXT:
- Monorepo root: /Users/ben/Documents/GitHub/town-meeting-manager/
- Web package: packages/web/
- Shared package: packages/shared/
- API package: packages/api/
- Docker config: docker/docker-compose.yml
- Package manager: pnpm workspaces

TASK 1: Remove PowerSync from docker-compose.yml
- File: docker/docker-compose.yml
- Read the file first to locate the `powersync:` service block
- Remove the entire `powersync:` service block including all its sub-keys (image, environment, volumes, ports, depends_on, etc.)
- Also remove the `mongo:` service block if present (MongoDB was a PowerSync dependency)
- Do NOT remove any other services (supabase, postgres, storage, etc.)
- Verify the remaining docker-compose.yml is valid YAML after the edit

TASK 2: Remove PowerSync packages from package.json files
- File: packages/web/package.json
  - Remove from `dependencies`: `@powersync/react`, `@powersync/web`, `@powersync/kysely-driver`
  - Do not remove any other packages
- File: packages/shared/package.json
  - Remove from `dependencies`: `@powersync/common`
  - Remove the `"./powersync"` entry from the `exports` field (the entry that maps to `./src/powersync/index.ts` or similar)
  - Do not remove any other exports entries

TASK 3: Remove PowerSync WASM config from vite.config.ts
- File: packages/web/vite.config.ts
- Read the file first to locate the optimizeDeps configuration
- Remove these specific entries that were added for PowerSync:
  - From `optimizeDeps.exclude`: `"@journeyapps/wa-sqlite"` and `"@powersync/web"`
  - From `optimizeDeps.include`: `"@powersync/web > js-logger"`
- If `optimizeDeps.exclude` or `optimizeDeps.include` become empty arrays after removal, remove the empty array too
- If `optimizeDeps` becomes an empty object after removal, remove it entirely
- Do not modify any other vite config settings

TASK 4: Install replacement packages
Run these commands in order from the repo root:

```bash
pnpm --filter @town-meeting/web add @tanstack/react-query
pnpm --filter @town-meeting/web add -D @tanstack/react-query-devtools
pnpm --filter @town-meeting/web add react-hook-form @hookform/resolvers
pnpm --filter @town-meeting/api add web-push
pnpm --filter @town-meeting/api add -D @types/web-push
```

TASK 5: Remove VITE_POWERSYNC_URL from environment files
- File: packages/web/.env (if it exists)
  - Remove the line containing `VITE_POWERSYNC_URL`
  - Do not remove any other environment variables
- File: packages/web/.env.example (if it exists)
  - Remove the line containing `VITE_POWERSYNC_URL`
  - Do not remove any other environment variable examples

TASK 6: Delete the powersync/ directory
- Delete the entire `powersync/` directory at the repo root
- This contains: `powersync.yaml` and `sync-rules.yaml`
- Command: `rm -rf powersync/`

TASK 7: Update the lockfile
Run from the repo root:
```bash
pnpm install
```
This updates pnpm-lock.yaml to reflect the removed and added packages.

IMPORTANT RULES FOR THIS SESSION:
1. Do NOT touch any TypeScript/TSX source files (*.ts, *.tsx) — those will be migrated in M.02–M.11
2. Do NOT attempt to fix TypeScript compilation errors — the app will fail to compile after this session
3. Do NOT run `pnpm build` or `pnpm typecheck` — they will fail and that is expected
4. If pnpm install shows peer dependency warnings related to PowerSync packages that no longer exist, that is expected and acceptable
5. Only modify: docker/docker-compose.yml, packages/web/package.json, packages/shared/package.json, packages/web/vite.config.ts, packages/web/.env, packages/web/.env.example, and run the install commands

VERIFICATION CHECKLIST:
1. docker/docker-compose.yml no longer contains a `powersync:` service block
2. docker/docker-compose.yml no longer contains a `mongo:` service block (if it existed)
3. packages/web/package.json does not contain @powersync/react, @powersync/web, or @powersync/kysely-driver
4. packages/shared/package.json does not contain @powersync/common
5. packages/shared/package.json exports field does not contain a ./powersync entry
6. packages/web/vite.config.ts does not contain @journeyapps/wa-sqlite or @powersync/web references in optimizeDeps
7. packages/web/package.json contains @tanstack/react-query in dependencies
8. packages/web/package.json contains react-hook-form and @hookform/resolvers in dependencies
9. packages/api/package.json contains web-push in dependencies
10. packages/web/.env does not contain VITE_POWERSYNC_URL
11. The powersync/ directory at the repo root no longer exists
12. pnpm install completed without fatal errors (warnings are acceptable)
```

## Commit Message

```
M.01: Remove PowerSync infrastructure, install TanStack Query and react-hook-form
```
