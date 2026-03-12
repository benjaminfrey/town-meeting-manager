# Session M.07 — Component Reads: Replace @powersync/react useQuery

**Phase:** Migration | **Block:** PowerSync → TanStack Query
**Dependencies:** M.04, M.05
**Estimated tasks:** 35

---

## Description

Replace `useQuery` from `@powersync/react` with `useQuery` from `@tanstack/react-query` in all ~30 component files. Each file has at least one PowerSync reactive query that reads from the local SQLite cache; replace each with a Supabase fetch wrapped in TanStack Query's `useQuery`. This is the largest session by file count.

Component write operations (calls to `powerSync.execute()` or `usePowerSync()`) are NOT migrated in this session — those are M.08.

## Files

**Dashboard components (5):**
- `packages/web/src/components/dashboard/ProgressChecklist.tsx`
- `packages/web/src/components/dashboard/RetentionPolicyModal.tsx`
- `packages/web/src/components/dashboard/TownSealUpload.tsx`
- `packages/web/src/components/dashboard/MeetingRolesEditor.tsx`
- `packages/web/src/components/dashboard/MeetingDefaultsEditor.tsx`
- `packages/web/src/components/dashboard/TownSettingsEditor.tsx`

**Board components (4):**
- `packages/web/src/components/boards/MemberRoster.tsx`
- `packages/web/src/components/boards/ArchiveBoardDialog.tsx`
- `packages/web/src/components/boards/EditBoardDialog.tsx`
- `packages/web/src/components/boards/AddBoardDialog.tsx`

**Member components (6):**
- `packages/web/src/components/members/AddMemberDialog.tsx`
- `packages/web/src/components/members/MemberTransitionDialog.tsx`
- `packages/web/src/components/members/PermissionOverrideView.tsx`
- `packages/web/src/components/members/StaffAccountFlow.tsx`
- `packages/web/src/components/members/EditGovTitleDialog.tsx`
- `packages/web/src/components/members/MemberArchiveDialog.tsx`
- `packages/web/src/components/members/RoleConflictDialog.tsx`

**Meeting management components (5):**
- `packages/web/src/components/meetings/CreateMeetingDialog.tsx`
- `packages/web/src/components/meetings/CancelMeetingDialog.tsx`
- `packages/web/src/components/meetings/PublishAgendaDialog.tsx`
- `packages/web/src/components/meetings/ExhibitUploader.tsx`
- `packages/web/src/components/meetings/ExhibitRow.tsx`
- `packages/web/src/components/meetings/AgendaSection.tsx`
- `packages/web/src/components/meetings/InlineItemForm.tsx`

**Template components (2):**
- `packages/web/src/components/templates/CreateTemplateDialog.tsx`
- `packages/web/src/components/templates/DeleteTemplateDialog.tsx`

**Misc components (2):**
- `packages/web/src/components/LogoutDialog.tsx`
- `packages/web/src/components/SyncStatusBar.tsx` (the old component — replace with the new ConnectionStatusBar redirect)

**Minutes components (1):**
- `packages/web/src/components/minutes/SourceDataPanel.tsx`

## Tasks

1. Read each component file to understand what data it queries
2. For each file: replace `import { useQuery } from '@powersync/react'` with `import { useQuery } from '@tanstack/react-query'`
3. For each `useQuery(sql, params)` call: replace with `useQuery({ queryKey: queryKeys.X.Y(id), queryFn: async () => { ... } })`
4. Wire `useSupabase()` for the Supabase client in components that need it
5. Use `useQueryClient()` for cache invalidation where needed
6. Preserve all JSX exactly as-is — only the data loading pattern changes
7. Do NOT migrate write operations (`powerSync.execute()`, `usePowerSync()`) in this session — leave them for M.08
8. Verify TypeScript: after completing all files, run `pnpm --filter @town-meeting/web tsc --noEmit --skipLibCheck 2>&1 | grep "components/"` — fix any errors in component files

## Prompt

```
You are migrating all component-level data reads in the Town Meeting Manager from PowerSync (useQuery from @powersync/react) to TanStack Query (useQuery from @tanstack/react-query). This is a large session — approximately 30 component files need updating.

PROJECT CONTEXT:
- Monorepo root: /Users/ben/Documents/GitHub/town-meeting-manager/
- Web package: packages/web/
- useSupabase hook: packages/web/src/hooks/useSupabase.ts
- queryKeys: packages/web/src/lib/queryKeys.ts
- queryClient singleton: packages/web/src/lib/queryClient.ts
- useQueryClient hook: from @tanstack/react-query
- ALL table names are SINGULAR: town, board, meeting, agenda_item, motion, vote_record, meeting_attendance, minutes_document, board_member, person, user_account, exhibit, guest_speaker, agenda_template, executive_session

MIGRATION PATTERN:

Old (PowerSync):
```typescript
import { useQuery } from '@powersync/react';

// Raw SQL with positional params
const { data: boards } = useQuery(
  'SELECT * FROM board WHERE town_id = ? AND archived = 0 ORDER BY name',
  [townId]
);
```

New (TanStack Query + Supabase):
```typescript
import { useQuery } from '@tanstack/react-query';
import { useSupabase } from '@/hooks/useSupabase';
import { queryKeys } from '@/lib/queryKeys';

const supabase = useSupabase();

const { data: boards = [] } = useQuery({
  queryKey: queryKeys.boards.byTown(townId),
  queryFn: async () => {
    const { data, error } = await supabase
      .from('board')
      .select('*')
      .eq('town_id', townId)
      .eq('archived', false)
      .order('name');
    if (error) throw error;
    return data;
  },
  enabled: !!townId,
});
```

KEY DIFFERENCES:
1. PowerSync returned SQL row arrays with snake_case column names — Supabase also returns snake_case. The data shape is the same.
2. PowerSync had boolean workarounds: `archived = 0` (integer). With Supabase, use native boolean: `.eq('archived', false)`
3. PowerSync's JSONB was stored as TEXT. Supabase returns native JSONB as objects. If any code does `JSON.parse(row.json_field)`, remove the parse — the value is already an object.
4. JOINs are now supported. `SELECT board.*, board_member.*` → `supabase.from('board').select('*, board_member(*)')`
5. The `data` default should be `[]` for arrays: `const { data: boards = [] } = useQuery(...)`

APPROACH: Process files systematically by directory:

DIRECTORY: packages/web/src/components/dashboard/

For each dashboard component:
1. Read the file
2. Find all `useQuery` calls
3. Map each SQL query to a Supabase equivalent
4. Replace imports and hook calls
5. Leave any `powerSync.execute()` calls unchanged — those are M.08
6. Add `useSupabase()` call at top of component if any Supabase queries are needed

ProgressChecklist.tsx likely queries: boards for the town, any completion status fields
RetentionPolicyModal.tsx likely queries: town retention policy settings
TownSealUpload.tsx likely queries: town record for the current seal URL
MeetingRolesEditor.tsx likely queries: town meeting role config (e.g., roles table or town.meeting_roles JSONB)
MeetingDefaultsEditor.tsx likely queries: town settings/defaults
TownSettingsEditor.tsx likely queries: town record

DIRECTORY: packages/web/src/components/boards/

MemberRoster.tsx likely queries: board_members with person details; use JOIN: `supabase.from('board_member').select('*, person(*)').eq('board_id', boardId)`
ArchiveBoardDialog.tsx likely queries: board detail and possibly dependent records
EditBoardDialog.tsx likely queries: board record for the edit form initial values
AddBoardDialog.tsx likely queries: may not have reads (just a create form) — verify

DIRECTORY: packages/web/src/components/members/

These components query board_member, person, and user_account tables.
MemberTransitionDialog.tsx — queries board_member status and person details
PermissionOverrideView.tsx — queries board_member permissions
StaffAccountFlow.tsx — queries user_account for person
EditGovTitleDialog.tsx — queries board_member for current gov title
MemberArchiveDialog.tsx — queries board_member details
RoleConflictDialog.tsx — queries person's existing roles across boards
AddMemberDialog.tsx — queries person list for the town

DIRECTORY: packages/web/src/components/meetings/

CreateMeetingDialog.tsx — queries board list and agenda templates
CancelMeetingDialog.tsx — queries meeting details
PublishAgendaDialog.tsx — queries meeting and agenda items
ExhibitUploader.tsx — queries existing exhibits for the meeting
ExhibitRow.tsx — queries single exhibit details
AgendaSection.tsx — queries agenda items for a section
InlineItemForm.tsx — may query templates or suggestion lists

DIRECTORY: packages/web/src/components/templates/

CreateTemplateDialog.tsx — queries existing templates for the board
DeleteTemplateDialog.tsx — queries template details

DIRECTORY: packages/web/src/components/minutes/

SourceDataPanel.tsx — queries meeting attendance, motions, vote_records for minutes generation

DIRECTORY: packages/web/src/components/ (root)

LogoutDialog.tsx — likely has no queries (just a confirm dialog) — verify
SyncStatusBar.tsx — this component was already replaced by ConnectionStatusBar in M.02. Overwrite it with a re-export shim:
```typescript
// Replaced by ConnectionStatusBar in M.02. This file is kept as a shim for import compatibility.
// Will be deleted in M.11.
export { ConnectionStatusBar as SyncStatusBar } from './ConnectionStatusBar';
```

JSONB MIGRATION NOTES:
- If any component does `JSON.parse(row.some_field)` where `some_field` is a JSONB column in Postgres, remove the parse call. Supabase returns JSONB as native JS objects.
- Common JSONB fields: `meeting.agenda_settings`, `board.meeting_defaults`, `town.settings`, etc.
- Check the generated database.ts (packages/shared/src/types/database.ts) to confirm column types.

BOOLEAN MIGRATION NOTES:
- PowerSync stored booleans as 0/1 integers. SQLite queries used `WHERE column = 1` or `WHERE column = 0`.
- Supabase returns native booleans. Use `.eq('column', true)` or `.eq('column', false)`.
- If UI code checks `if (row.archived === 1)`, update to `if (row.archived)`.

IMPORTANT: DO NOT MIGRATE WRITE CALLS IN THIS SESSION
- Leave all `powerSync.execute('INSERT...')`, `powerSync.execute('UPDATE...')`, `powerSync.execute('DELETE...')` calls unchanged.
- Leave all `usePowerSync()` hook calls that are used for writes.
- These will be migrated in M.08.
- It is acceptable for a component to mix new Supabase reads with old PowerSync writes temporarily.

HANDLING useQueryClient() for INVALIDATION:
Some components may need to invalidate queries when a mutation completes. In those cases:
```typescript
import { useQuery, useQueryClient } from '@tanstack/react-query';
const queryClient = useQueryClient();
// After mutation:
queryClient.invalidateQueries({ queryKey: queryKeys.boards.byTown(townId) });
```

But DO NOT add this for components where the mutation hasn't been migrated yet — add it only where reads and writes are both being migrated together.

VERIFICATION CHECKLIST:
1. No component file imports useQuery from @powersync/react
2. All useQuery calls use the object form: useQuery({ queryKey: [...], queryFn: async () => ... })
3. All useQuery calls have a queryKey using the queryKeys factory
4. Boolean conditions use native booleans (.eq('archived', false), not 0/1)
5. JSONB fields are accessed directly without JSON.parse()
6. All write calls (powersync.execute) are left unchanged for M.08
7. TypeScript: `pnpm --filter @town-meeting/web tsc --noEmit --skipLibCheck 2>&1 | grep "components/"` — zero errors in component files
```

## Commit Message

```
M.07: Migrate all component reads from @powersync/react useQuery to TanStack Query + Supabase
```
