# PowerSync → TanStack Query Migration

**Purpose:** Remove PowerSync offline-first sync layer and replace with TanStack Query v5 + Supabase Realtime.

**Why:** PowerSync forced `useWizardForm` instead of react-hook-form, prohibited JOINs, required boolean/JSONB workarounds, needed a separate Docker service, and caused stale-cache bugs. Rural Maine towns without wifi in 2026 is an edge case; graceful degradation is sufficient.

**Audit summary (files requiring changes):**
- 11 route files with PowerSync `clientLoader` queries
- 39 component files using `useQuery` / `powersync.execute()`
- 5 hook files
- 4 provider/lib files
- 9 test files
- 95 total `powersync.execute()` calls in production code
- 14 files using `useWizardForm`

---

## Session Index

| Session | Title | Files Changed | Dependencies |
|---------|-------|--------------|-------------|
| [M.01](M.01-infrastructure-swap.md) | Infrastructure Swap | docker-compose, package.json, vite.config, env | None |
| [M.02](M.02-data-layer-foundation.md) | Data Layer Foundation | 6 new files, root.tsx, RootLayout.tsx | M.01 |
| [M.03](M.03-shared-package.md) | Shared Package | packages/shared cleanup + Supabase type gen | M.01 |
| [M.04](M.04-route-migrations.md) | Route clientLoaders | 11 route files | M.02, M.03 |
| [M.05](M.05-hooks-migration.md) | Hooks Migration | 5 hook files | M.02 |
| [M.06](M.06-form-migration.md) | Form Migration | 14 files using useWizardForm | M.02 |
| [M.07](M.07-component-reads.md) | Component Reads | ~30 components using useQuery | M.04, M.05 |
| [M.08](M.08-component-writes.md) | Component Writes | 32 components with powersync.execute() | M.07 |
| [M.09](M.09-live-meeting-realtime.md) | Live Meeting Realtime | meetings.$meetingId.live.tsx | M.08 |
| [M.10](M.10-test-migration.md) | Test Migration | 9 test files | M.09 |
| [M.11](M.11-build-cleanup.md) | Build & Cleanup | Final verification, delete dead files | M.10 |

---

## Replacement Patterns

| Old (PowerSync) | New (TanStack Query) |
|----------------|---------------------|
| `import { useQuery } from '@powersync/react'` | `import { useQuery } from '@tanstack/react-query'` |
| `useQuery(sql, params)` | `useQuery({ queryKey: queryKeys.x.y(id), queryFn: () => supabase.from(...).select(...) })` |
| `powerSync.execute('INSERT INTO ...')` | `useMutation({ mutationFn: () => supabase.from(...).insert(...), onSuccess: () => queryClient.invalidateQueries(...) })` |
| `useWizardForm(schema)` | `useForm({ resolver: zodResolver(schema) })` |
| `<PowerSyncProvider>` | `<QueryProvider>` |
| `SyncStatusBar` | `ConnectionStatusBar` |
| `usePowerSync()` → `powerSync` | `useSupabase()` → `supabase` or `useQueryClient()` |
| `useDb()` → Kysely queries | `useQuery(...)` with Supabase client directly |
| Boolean `0/1` workarounds | Native booleans |
| `JSON.stringify/parse` for JSONB | Native object/array types |
| Separate queries + JS merge for relations | Single Supabase query with `select('*, relation(*)')` |

---

## New Files Created

| File | Purpose |
|------|---------|
| `packages/web/src/lib/queryClient.ts` | QueryClient singleton |
| `packages/web/src/lib/queryKeys.ts` | Typed query key factory |
| `packages/web/src/providers/QueryProvider.tsx` | QueryClientProvider wrapper |
| `packages/web/src/hooks/useRealtimeSubscription.ts` | Supabase Realtime hook |
| `packages/web/src/components/ConnectionStatusBar.tsx` | Replaces SyncStatusBar |
| `packages/shared/src/types/database.ts` | Auto-generated Supabase types |

## Files Deleted

| File | Reason |
|------|--------|
| `packages/web/src/providers/PowerSyncProvider.tsx` | Replaced by QueryProvider |
| `packages/web/src/hooks/usePowerSync.ts` | No longer needed |
| `packages/web/src/hooks/useDb.ts` | Kysely/PowerSync driver removed |
| `packages/web/src/hooks/useWizardForm.ts` | react-hook-form used directly |
| `packages/web/src/lib/powersync/SupabaseConnector.ts` | PowerSync removed |
| `packages/web/src/lib/powersync/db.ts` | PowerSync removed |
| `packages/web/src/components/SyncStatusBar.tsx` | Replaced by ConnectionStatusBar |
| `packages/shared/src/powersync/schema.ts` | PowerSync removed |
| `packages/shared/src/powersync/index.ts` | PowerSync removed |
| `powersync/powersync.yaml` | PowerSync Docker config |
| `powersync/sync-rules.yaml` | PowerSync sync rules |
