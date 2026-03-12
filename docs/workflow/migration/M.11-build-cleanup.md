# Session M.11 — Build & Cleanup: Final Verification and Dead File Deletion

**Phase:** Migration | **Block:** PowerSync → TanStack Query
**Dependencies:** M.10
**Estimated tasks:** 14

---

## Description

Final cleanup session. Delete all remaining PowerSync source files, remove the SyncStatusBar shim, verify no PowerSync references remain anywhere in the codebase, and run a full monorepo build. This is the "done" checkpoint — after this session the migration is complete, PowerSync is gone, and the app builds cleanly.

## Files Deleted

| File | Reason |
|------|--------|
| `packages/web/src/providers/PowerSyncProvider.tsx` | Replaced by QueryProvider |
| `packages/web/src/components/SyncStatusBar.tsx` | Replaced by ConnectionStatusBar; shim no longer needed |
| `packages/web/src/lib/powersync/SupabaseConnector.ts` | PowerSync removed |
| `packages/web/src/lib/powersync/db.ts` | PowerSync removed |
| `packages/web/src/lib/powersync/types.ts` | PowerSync removed |
| `packages/web/src/lib/powersync/` (directory) | Now empty |

Note: `packages/web/src/hooks/usePowerSync.ts`, `useDb.ts`, `useWizardForm.ts` were already deleted in M.05. `packages/shared/src/powersync/` was already deleted in M.03.

## Tasks

1. Verify all prior sessions completed: search for any remaining `@powersync` imports across the entire `packages/` tree
2. Verify no remaining `powersync.execute` calls in production code
3. Verify no remaining `useWizardForm` calls in production code
4. Delete `packages/web/src/providers/PowerSyncProvider.tsx`
5. Delete `packages/web/src/components/SyncStatusBar.tsx` (the shim created in M.02 — all callers have been updated)
6. Delete `packages/web/src/lib/powersync/SupabaseConnector.ts`
7. Delete `packages/web/src/lib/powersync/db.ts`
8. Delete `packages/web/src/lib/powersync/types.ts` (if it exists)
9. Remove the `packages/web/src/lib/powersync/` directory
10. Run full TypeScript check: `pnpm --filter @town-meeting/web tsc --noEmit` (no `--skipLibCheck`)
11. Run full monorepo build: `npx turbo run build`
12. Run all tests: `pnpm turbo run test`
13. Start the dev server and smoke test: navigate to login, dashboard, a board detail page, and the live meeting page
14. Commit the migration complete state

## Prompt

```
You are completing the PowerSync → TanStack Query migration for the Town Meeting Manager. This final session deletes all remaining PowerSync files, verifies the codebase is clean, and runs a full build to confirm everything works.

PROJECT CONTEXT:
- Monorepo root: /Users/ben/Documents/GitHub/town-meeting-manager/
- All prior migration sessions (M.01–M.10) should be complete before running this session

STEP 1: AUDIT FOR REMAINING POWERSYNC REFERENCES

Run these checks and address any issues found:

```bash
# Check for any remaining @powersync imports in source files
echo "=== @powersync imports ===" && grep -r "@powersync" packages/web/src/ packages/shared/src/ --include="*.ts" --include="*.tsx" -l

# Check for remaining powersync.execute calls
echo "=== powersync.execute calls ===" && grep -r "powerSync\.execute\|powersync\.execute" packages/web/src/ --include="*.ts" --include="*.tsx" -l

# Check for remaining usePowerSync calls
echo "=== usePowerSync calls ===" && grep -r "usePowerSync\|useDb()" packages/web/src/ --include="*.ts" --include="*.tsx" -l

# Check for remaining useWizardForm calls
echo "=== useWizardForm calls ===" && grep -r "useWizardForm" packages/web/src/ --include="*.ts" --include="*.tsx" -l

# Check for remaining PowerSyncProvider
echo "=== PowerSyncProvider ===" && grep -r "PowerSyncProvider\|SyncStatusBar" packages/web/src/ --include="*.ts" --include="*.tsx" -l
```

Expected: all searches return zero matches (except possibly in test files that mock things with those strings).

If any matches are found, fix them before proceeding to the delete step. Do not delete files if there are still callers.

STEP 2: DELETE REMAINING POWERSYNC SOURCE FILES

Only delete these files after confirming in Step 1 that no callers remain:

```bash
# Delete PowerSync provider
rm packages/web/src/providers/PowerSyncProvider.tsx

# Delete SyncStatusBar shim
rm packages/web/src/components/SyncStatusBar.tsx

# Delete PowerSync lib files
rm -f packages/web/src/lib/powersync/SupabaseConnector.ts
rm -f packages/web/src/lib/powersync/db.ts
rm -f packages/web/src/lib/powersync/types.ts
rm -f packages/web/src/lib/powersync/schema.ts  # If it wasn't moved to shared

# Remove directory (only if now empty)
rmdir packages/web/src/lib/powersync/ 2>/dev/null || ls packages/web/src/lib/powersync/
```

If `rmdir` fails because the directory still has files, list them:
```bash
ls packages/web/src/lib/powersync/
```
Delete any remaining files, then remove the directory.

STEP 3: UPDATE MEMORY.MD

Update the project MEMORY.md at /Users/ben/.claude/projects/-Users-ben-Documents-GitHub-town-meeting-manager/memory/MEMORY.md to reflect the completed migration:

Remove the "Key Patterns" section entries about PowerSync and replace with the React Query patterns:
- Remove: `useWizardForm`, `powerSync.execute()`, `useQuery() from @powersync/react`, `Booleans: SQLite stores as 0/1`, `JSONB: Stored as TEXT in PowerSync`
- Add: `DB reads: useQuery from @tanstack/react-query with supabase.from().select()`, `DB writes: useMutation with supabase.from().insert/update/delete(), then queryClient.invalidateQueries()`, `Forms: useForm from react-hook-form with zodResolver`, `Realtime: useRealtimeSubscription hook from @/hooks/useRealtimeSubscription`

Also update the "Architecture" section to remove PowerSync references.

STEP 4: TYPESCRIPT VERIFICATION

Run a strict TypeScript check (no --skipLibCheck):

```bash
cd /Users/ben/Documents/GitHub/town-meeting-manager && pnpm --filter @town-meeting/web tsc --noEmit 2>&1 | head -100
```

Fix any errors. Common remaining issues after migration:
- Type mismatches between PowerSync's SQLite types (strings for booleans/dates) and Supabase's proper types
- Components that did `row.archived === 1` instead of `row.archived === true`
- Components that did `JSON.parse(row.settings)` for JSONB fields now receiving objects
- Missing `?` optional chaining where Supabase JOINs can return null for related records

For null JOIN handling:
```typescript
// Old PowerSync (separate queries merged in JS — always had data):
const board = boards.find(b => b.id === boardId); // never null

// New Supabase JOIN (nullable if no related record):
const { data: meeting } = useQuery(...);
const boardName = meeting?.board?.name ?? 'Unknown'; // use optional chaining
```

STEP 5: FULL MONOREPO BUILD

```bash
cd /Users/ben/Documents/GitHub/town-meeting-manager && npx turbo run build
```

This builds shared, web, and api in dependency order. Fix any build errors:
- Shared package errors: likely missing exports or type issues in database.ts
- Web package errors: TypeScript or Vite bundling issues
- API package errors: should be unaffected by this migration (it uses Supabase directly already)

STEP 6: RUN ALL TESTS

```bash
cd /Users/ben/Documents/GitHub/town-meeting-manager && pnpm turbo run test
```

All tests should pass. If any fail, fix them before committing.

STEP 7: DEV SERVER SMOKE TEST

Start the dev server:
```bash
cd /Users/ben/Documents/GitHub/town-meeting-manager && pnpm --filter @town-meeting/web dev
```

Open http://localhost:5173 and verify:
1. Login page renders
2. After login, dashboard loads with town info and recent meetings
3. Boards list loads
4. Board detail page shows member roster
5. Meeting detail page loads
6. Live meeting page loads (no errors in console)
7. React Query DevTools appears in bottom-right corner (dev only)
8. Public portal at ?portal=testville loads correctly

Check the browser console for any remaining PowerSync-related errors.

STEP 8: VERIFY DOCKER COMPOSE

Check that the docker-compose.yml no longer starts a PowerSync service:
```bash
grep -i "powersync\|mongo" docker/docker-compose.yml
```
Expected: zero matches (both should have been removed in M.01).

STEP 9: UPDATE THE MIGRATION README

Update packages/web/src/docs/workflow/migration/README.md status if there's a status column, or add a completion note.

VERIFICATION CHECKLIST:
1. `grep -r "@powersync" packages/ --include="*.ts" --include="*.tsx"` → zero matches
2. `packages/web/src/providers/PowerSyncProvider.tsx` does not exist
3. `packages/web/src/components/SyncStatusBar.tsx` does not exist
4. `packages/web/src/lib/powersync/` directory does not exist
5. `pnpm --filter @town-meeting/web tsc --noEmit` → zero errors
6. `npx turbo run build` → all packages build successfully
7. `pnpm turbo run test` → all tests pass
8. Dev server starts and renders correctly
9. React Query DevTools visible in dev mode
10. MEMORY.md updated to reflect new patterns
11. docker-compose.yml has no powersync or mongo services
```

## Commit Message

```
M.11: Final cleanup — delete PowerSync files, full build passes, migration complete
```

---

## Post-Migration Notes

After M.11, the migration is complete. Key things to remember going forward:

- **Data fetching**: `useQuery({ queryKey: queryKeys.X.Y(id), queryFn: () => supabase.from('table').select('...') })`
- **Data mutation**: `useMutation({ mutationFn: () => supabase.from('table').insert/update/delete(...), onSuccess: () => queryClient.invalidateQueries(...) })`
- **Forms**: `useForm<Schema>({ resolver: zodResolver(schema), defaultValues: {...} })`
- **Realtime**: `useRealtimeSubscription(channelName, table, filter, callback)` — invalidates queryClient on each event
- **Table names**: Always singular (`board`, `meeting`, `agenda_item`, `motion`, `vote_record`, `meeting_attendance`, `minutes_document`)
- **Booleans**: Native booleans (not `0`/`1`)
- **JSONB**: Native objects (no `JSON.stringify`/`JSON.parse`)
- **JOINs**: Use Supabase `select('*, relation(*)')` syntax — now fully supported
