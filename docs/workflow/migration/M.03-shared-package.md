# Session M.03 — Shared Package: Remove PowerSync Schema, Add Supabase Types

**Phase:** Migration | **Block:** PowerSync → TanStack Query
**Dependencies:** M.01
**Estimated tasks:** 7

---

## Description

Remove the PowerSync table schema definitions from the shared package and replace them with auto-generated Supabase TypeScript types. The generated `database.ts` file becomes the single source of truth for all table shapes, replacing the manual PowerSync schema definitions. Rebuild the shared package so the web package can consume the new types.

## Tasks

1. Delete `packages/shared/src/powersync/schema.ts`
2. Delete `packages/shared/src/powersync/index.ts`
3. Remove the `packages/shared/src/powersync/` directory
4. Generate Supabase TypeScript types from the local Docker instance: `npx supabase gen types typescript --local > packages/shared/src/types/database.ts`
5. Export the `Database` type from `packages/shared/src/types/index.ts`
6. Remove the `"./powersync"` export entry from `packages/shared/package.json` exports field (if not already removed in M.01)
7. Rebuild the shared package: `npx turbo run build --filter=@town-meeting/shared`

## Prompt

```
You are updating the shared package for the Town Meeting Manager migration from PowerSync to TanStack Query. This session removes the PowerSync schema files and generates Supabase TypeScript types that will be used throughout the codebase.

PROJECT CONTEXT:
- Monorepo root: /Users/ben/Documents/GitHub/town-meeting-manager/
- Shared package: packages/shared/
- Local Supabase runs in Docker via docker/docker-compose.yml
- The MEMORY.md for this project notes: use `npx supabase` commands pointed at the Docker instance

BEFORE STARTING: Verify Docker is running
The Supabase gen types command requires the local Docker instance to be running. Check first:
```bash
docker ps | grep supabase
```
If Supabase containers are not running, start them:
```bash
cd /Users/ben/Documents/GitHub/town-meeting-manager && docker compose -f docker/docker-compose.yml up -d
```
Wait about 10 seconds for containers to be ready before running the type generation command.

TASK 1: Read existing shared package structure

Before making any changes, read these files to understand the current structure:
- packages/shared/src/powersync/schema.ts
- packages/shared/src/powersync/index.ts
- packages/shared/src/types/index.ts (if it exists)
- packages/shared/package.json (for exports field and directory structure)
- packages/shared/src/index.ts (the main barrel export)

TASK 2: Delete PowerSync schema files

Delete these files and the directory:
```bash
rm -f packages/shared/src/powersync/schema.ts
rm -f packages/shared/src/powersync/index.ts
rmdir packages/shared/src/powersync/
```

If the rmdir fails because the directory still has files, check what's in it first and delete any remaining files.

TASK 3: Generate Supabase TypeScript types

Run from the repo root:
```bash
cd /Users/ben/Documents/GitHub/town-meeting-manager && npx supabase gen types typescript --local > packages/shared/src/types/database.ts
```

If the `types/` directory doesn't exist in packages/shared/src/, create it first:
```bash
mkdir -p packages/shared/src/types
```

After generating, verify the file was created and is non-empty:
```bash
wc -l packages/shared/src/types/database.ts
```
The file should be several hundred lines. If it's empty or very short (under 50 lines), the Docker instance may not be fully started — wait and retry.

The generated file will contain a `Database` type with this structure:
```typescript
export type Database = {
  public: {
    Tables: {
      town: { Row: {...}; Insert: {...}; Update: {...}; };
      board: { Row: {...}; Insert: {...}; Update: {...}; };
      meeting: { Row: {...}; Insert: {...}; Update: {...}; };
      // ... all other tables
    };
    Views: { ... };
    Functions: { ... };
    Enums: { ... };
  };
};
```

TASK 4: Export the Database type

Read packages/shared/src/types/index.ts if it exists. Add or update the export:

```typescript
export type { Database } from './database.js';
```

Note the `.js` extension — this is required for ESM compatibility in the shared package build.

If packages/shared/src/types/index.ts does not exist, create it with just that export line.

Then verify that packages/shared/src/index.ts (or the main entry point) re-exports from types. If not, add:
```typescript
export type { Database } from './types/index.js';
```

TASK 5: Check for any remaining powersync references in shared package

Search for any remaining imports of the deleted files:
```bash
grep -r "powersync" packages/shared/src/ --include="*.ts" --include="*.tsx" -l
```

If any files still import from the powersync directory, update them. Most likely candidates:
- packages/shared/src/index.ts — remove any `export * from './powersync/index.js'` line

TASK 6: Verify package.json exports field

Read packages/shared/package.json and confirm:
1. The `"./powersync"` export entry has been removed (was done in M.01, but verify)
2. The exports field properly exposes the types output

If the package.json exports map needs a `"./types"` entry for the database types, add it:
```json
{
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  }
}
```
The exact structure depends on the existing exports — preserve the existing pattern for other entries.

TASK 7: Rebuild the shared package

```bash
cd /Users/ben/Documents/GitHub/town-meeting-manager && npx turbo run build --filter=@town-meeting/shared
```

If the build fails, read the error output carefully:
- If it fails because of a missing import in the barrel export, fix the import path
- If it fails because of the deleted powersync files, remove the import from index.ts
- Do NOT modify the generated database.ts file — regenerate it if needed

After a successful build, verify the dist folder contains the types:
```bash
ls packages/shared/dist/ | head -20
```

IMPORTANT NOTES ON SUPABASE TABLE NAMES:
The generated types will use the actual database table names, which are SINGULAR:
- `town` (not `towns`)
- `board` (not `boards`)
- `meeting` (not `meetings`)
- `agenda_item` (not `agenda_items`)
- `motion` (not `motions`)
- `vote_record` (not `vote_records`)
- `meeting_attendance` (not `meeting_attendances`)
- `minutes_document` (not `minutes_documents`)
- `board_member` (not `board_members`)
- `person` (not `persons`)
- `user_account` (not `user_accounts`)
- `exhibit` (not `exhibits`)
- `guest_speaker` (not `guest_speakers`)
- `agenda_template` (not `agenda_templates`)
- `executive_session` (not `executive_sessions`)
- `future_item_queue` (not `future_item_queues`)
- `agenda_item_transition` (not `agenda_item_transitions`)

This is critical — all subsequent migration sessions use supabase.from('table_name') with these SINGULAR names.

VERIFICATION CHECKLIST:
1. packages/shared/src/powersync/ directory no longer exists
2. packages/shared/src/types/database.ts exists and is non-empty (500+ lines expected)
3. The Database type is exported from packages/shared/src/types/index.ts
4. packages/shared/src/index.ts does not import from ./powersync
5. packages/shared/package.json exports field does not contain ./powersync
6. `npx turbo run build --filter=@town-meeting/shared` succeeds with 0 errors
```

## Commit Message

```
M.03: Remove PowerSync schema from shared package, add auto-generated Supabase types
```
