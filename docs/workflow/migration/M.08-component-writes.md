# Session M.08 — Component Writes: Replace powersync.execute() with useMutation

**Phase:** Migration | **Block:** PowerSync → TanStack Query
**Dependencies:** M.07
**Estimated tasks:** 38

---

## Description

Replace all remaining `powerSync.execute()` and `usePowerSync()` calls with `useMutation` from `@tanstack/react-query` backed by Supabase. This session covers all component files — the route-level writes were handled in M.04 and the live meeting page (95 execute calls across the codebase) is handled specially in M.09. After this session, PowerSync execute calls exist only in `meetings.$meetingId.live.tsx` (M.09).

## Files Modified

**Dashboard components:**
- `packages/web/src/components/dashboard/RetentionPolicyModal.tsx`
- `packages/web/src/components/dashboard/TownSealUpload.tsx`
- `packages/web/src/components/dashboard/MeetingRolesEditor.tsx`
- `packages/web/src/components/dashboard/MeetingDefaultsEditor.tsx`
- `packages/web/src/components/dashboard/TownSettingsEditor.tsx`

**Board components:**
- `packages/web/src/components/boards/EditBoardDialog.tsx`
- `packages/web/src/components/boards/AddBoardDialog.tsx`
- `packages/web/src/components/boards/ArchiveBoardDialog.tsx`

**Member components:**
- `packages/web/src/components/members/AddMemberDialog.tsx`
- `packages/web/src/components/members/MemberTransitionDialog.tsx`
- `packages/web/src/components/members/EditGovTitleDialog.tsx`
- `packages/web/src/components/members/MemberArchiveDialog.tsx`
- `packages/web/src/components/members/RoleConflictDialog.tsx`
- `packages/web/src/components/members/StaffAccountFlow.tsx`

**Meeting management components:**
- `packages/web/src/components/meetings/CreateMeetingDialog.tsx`
- `packages/web/src/components/meetings/CancelMeetingDialog.tsx`
- `packages/web/src/components/meetings/PublishAgendaDialog.tsx`
- `packages/web/src/components/meetings/ExhibitUploader.tsx`
- `packages/web/src/components/meetings/ExhibitRow.tsx`
- `packages/web/src/components/meetings/AgendaSection.tsx`
- `packages/web/src/components/meetings/InlineItemForm.tsx`

**Template components:**
- `packages/web/src/components/templates/CreateTemplateDialog.tsx`
- `packages/web/src/components/templates/DeleteTemplateDialog.tsx`

**Meeting detail components:**
- `packages/web/src/components/meeting/AgendaItemDetailPanel.tsx`
- `packages/web/src/components/meeting/ExitExecutiveSessionDialog.tsx`
- `packages/web/src/components/meeting/AttendancePanel.tsx`
- `packages/web/src/components/meeting/RecusalDialog.tsx`
- `packages/web/src/components/meeting/MotionPanel.tsx`
- `packages/web/src/components/meeting/MotionCaptureDialog.tsx`
- `packages/web/src/components/meeting/MeetingStartFlow.tsx`
- `packages/web/src/components/meeting/GuestSpeakerEntry.tsx`

**Misc:**
- `packages/web/src/lib/meeting-helpers.ts`
- `packages/web/src/components/LogoutDialog.tsx`

## Tasks

1. Read `packages/web/src/lib/meeting-helpers.ts` to understand its write operations
2. Migrate `meeting-helpers.ts` — replace powersync.execute calls with exported async functions using the supabase singleton
3. For each of the 30+ component files: read the file, identify all `powerSync.execute()` or `usePowerSync()` write calls, replace with `useMutation`
4. Ensure each mutation calls `queryClient.invalidateQueries()` with the correct query key in `onSuccess`
5. Ensure each mutation calls `toast.error()` in `onError`
6. Remove `usePowerSync` and `useDb` imports from all files
7. Run TypeScript check: `pnpm --filter @town-meeting/web tsc --noEmit --skipLibCheck 2>&1 | grep -v "live.tsx"` — fix all errors except those in the live meeting file (handled in M.09)

## Prompt

```
You are migrating all component-level write operations in the Town Meeting Manager from PowerSync (powerSync.execute()) to TanStack Query mutations (useMutation) backed by Supabase. After this session, the only remaining PowerSync execute calls will be in meetings.$meetingId.live.tsx (which will be migrated in M.09).

PROJECT CONTEXT:
- Monorepo root: /Users/ben/Documents/GitHub/town-meeting-manager/
- Web package: packages/web/
- useSupabase: packages/web/src/hooks/useSupabase.ts
- queryKeys: packages/web/src/lib/queryKeys.ts
- queryClient: packages/web/src/lib/queryClient.ts
- All table names are SINGULAR

THE MUTATION PATTERN:

Old (PowerSync):
```typescript
import { usePowerSync } from '@/hooks/usePowerSync';
const powerSync = usePowerSync();

// Inside an event handler or form submit:
async function handleSave() {
  await powerSync.execute(
    'INSERT INTO meeting (id, board_id, title, scheduled_date) VALUES (?, ?, ?, ?)',
    [id, boardId, title, date]
  );
  toast.success('Meeting created');
  onClose();
}
```

New (TanStack Query + Supabase):
```typescript
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useSupabase } from '@/hooks/useSupabase';
import { queryKeys } from '@/lib/queryKeys';
import { toast } from 'sonner';

const supabase = useSupabase();
const queryClient = useQueryClient();

const createMeetingMutation = useMutation({
  mutationFn: async (values: CreateMeetingInput) => {
    const { error } = await supabase.from('meeting').insert({
      id: crypto.randomUUID(),
      board_id: values.boardId,
      title: values.title,
      scheduled_date: values.scheduledDate,
    });
    if (error) throw error;
  },
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.meetings.byBoard(boardId) });
    toast.success('Meeting created');
    onClose();
  },
  onError: (error) => {
    toast.error(`Failed to create meeting: ${error.message}`);
  },
});

// Trigger in JSX:
<Button onClick={() => createMeetingMutation.mutate(formValues)}>Create</Button>
// Or in form submit:
const onSubmit = form.handleSubmit((values) => createMeetingMutation.mutate(values));
```

OPERATION MAPPING (PowerSync SQL → Supabase):

INSERT:
```typescript
// Old: powerSync.execute('INSERT INTO board (id, town_id, name) VALUES (?, ?, ?)', [id, townId, name])
// New:
supabase.from('board').insert({ id, town_id: townId, name })
```

UPDATE:
```typescript
// Old: powerSync.execute('UPDATE board SET name = ? WHERE id = ?', [name, boardId])
// New:
supabase.from('board').update({ name }).eq('id', boardId)
```

DELETE:
```typescript
// Old: powerSync.execute('DELETE FROM board_member WHERE id = ?', [memberId])
// New:
supabase.from('board_member').delete().eq('id', memberId)
```

UPSERT:
```typescript
// Old: powerSync.execute('INSERT OR REPLACE INTO ...', [...])
// New:
supabase.from('table').upsert({ id, ...fields }, { onConflict: 'id' })
```

BOOLEAN VALUES:
- Old: stored as 1/0 integers — `powerSync.execute('UPDATE ... SET archived = 1 WHERE id = ?', [id])`
- New: native booleans — `supabase.from('board').update({ archived: true }).eq('id', id)`

JSONB VALUES:
- Old: `JSON.stringify(value)` before storing — `powerSync.execute('UPDATE ... SET settings = ?', [JSON.stringify(settings)])`
- New: pass the object directly — `supabase.from('town').update({ settings }).eq('id', townId)`

IDs:
- Preserve `crypto.randomUUID()` for new record IDs where used

MEETING-HELPERS.TS:
Read packages/web/src/lib/meeting-helpers.ts. This utility module likely exports async functions that call powerSync.execute(). Since it's not a React component, it cannot use hooks. Two options:
1. If the functions are called from React components: accept the supabase client as a parameter
2. If the functions need to work outside React: import the supabase singleton directly from '@/lib/supabase'

Use option 2 (singleton import) since meeting-helpers.ts is a utility module:
```typescript
import { supabase } from '@/lib/supabase';
import { queryClient } from '@/lib/queryClient';
```

COMMON QUERY INVALIDATION PATTERNS:

After creating a meeting: `queryClient.invalidateQueries({ queryKey: queryKeys.meetings.byBoard(boardId) })`
After updating a board: `queryClient.invalidateQueries({ queryKey: queryKeys.boards.detail(boardId) })`
After updating town settings: `queryClient.invalidateQueries({ queryKey: queryKeys.towns.detail(townId) })`
After adding a member: `queryClient.invalidateQueries({ queryKey: queryKeys.members.byBoard(boardId) })`
After adding an exhibit: `queryClient.invalidateQueries({ queryKey: queryKeys.exhibits.byMeeting(meetingId) })`
After creating a template: `queryClient.invalidateQueries({ queryKey: queryKeys.agendaTemplates.byBoard(boardId) })`

WHAT TO SKIP IN THIS SESSION:
- `packages/web/src/routes/meetings.$meetingId.live.tsx` — this will be migrated in M.09
- `packages/web/src/routes/meetings.$meetingId.minutes.tsx` — was handled in M.04
- Any component that already uses Supabase writes (should not exist, but verify)

HANDLING DIALOG CLOSE AFTER MUTATION:
Many dialogs have an `onClose` or `onOpenChange(false)` call after a successful mutation. Preserve this behavior — call it in the `onSuccess` callback.

LOADING STATE:
The old pattern used `isSubmitting` from the form. The mutation has `isLoading` (v4) or `isPending` (v5):
```typescript
// TanStack Query v5:
<Button disabled={createMeetingMutation.isPending}>Create</Button>
```
Use `isPending` since this project uses TanStack Query v5.

VERIFICATION CHECKLIST:
1. No file (except meetings.$meetingId.live.tsx) imports from @powersync packages
2. No file (except meetings.$meetingId.live.tsx) uses usePowerSync() or powerSync.execute()
3. All mutations use the { mutationFn, onSuccess, onError } pattern
4. All mutations invalidate the relevant queryKeys in onSuccess
5. Boolean values are native booleans (not 0/1)
6. JSONB values are passed as objects (not JSON.stringify)
7. meeting-helpers.ts uses the supabase singleton (not a hook)
8. TypeScript: `pnpm --filter @town-meeting/web tsc --noEmit --skipLibCheck 2>&1 | grep -v "live\.tsx"` — zero errors except in live.tsx
```

## Commit Message

```
M.08: Replace all component powersync.execute() writes with useMutation + Supabase
```
