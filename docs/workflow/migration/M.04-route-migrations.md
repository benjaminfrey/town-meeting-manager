# Session M.04 — Route clientLoader Migrations: Replace PowerSync Kysely with Supabase

**Phase:** Migration | **Block:** PowerSync → TanStack Query
**Dependencies:** M.02, M.03
**Estimated tasks:** 13

---

## Description

Migrate all 11 route files from PowerSync Kysely queries to Supabase client calls in `clientLoader`. After this session, all route-level data loading works with Supabase — including JOINs that were impossible with PowerSync. Components within these routes that still use PowerSync patterns are left for M.07 and M.08.

## Tasks

1. Establish the clientLoader pattern: import the supabase singleton from `@/lib/supabase` (not a hook — hooks cannot be used in clientLoader); import queryClient from `@/lib/queryClient`; use `queryClient.ensureQueryData()` to prefetch and cache
2. Migrate `packages/web/src/routes/dashboard.tsx` — clientLoader fetches town, boards, and recent meetings via Supabase
3. Migrate `packages/web/src/routes/boards.tsx` — clientLoader fetches all boards for the current town
4. Migrate `packages/web/src/routes/boards.$boardId.tsx` — clientLoader fetches board + board_members + persons using a JOIN
5. Migrate `packages/web/src/routes/boards.$boardId.meetings.tsx` — clientLoader fetches meetings for the board
6. Migrate `packages/web/src/routes/boards.$boardId.templates.tsx` — clientLoader fetches agenda_templates; migrate the 4 `powersync.execute()` write calls to Supabase mutations
7. Migrate `packages/web/src/routes/boards.$boardId.templates.$templateId.edit.tsx` — clientLoader + 1 write call
8. Migrate `packages/web/src/routes/meetings.$meetingId.tsx` — clientLoader fetches meeting + board + agenda_items
9. Migrate `packages/web/src/routes/meetings.$meetingId.agenda.tsx` — clientLoader fetches meeting + agenda_items + exhibits; migrate 2 execute() write calls
10. Migrate `packages/web/src/routes/meetings.$meetingId.review.tsx` — clientLoader fetches meeting + attendance + motions + vote_records using JOINs
11. Migrate `packages/web/src/routes/meetings.$meetingId.minutes.tsx` — clientLoader + migrate all 9 execute() calls to direct Supabase calls
12. Check for any remaining `settings.tsx` or other route files with clientLoader patterns and migrate them
13. Verify: run `pnpm --filter @town-meeting/web tsc --noEmit --skipLibCheck` and confirm no TypeScript errors originate from route files

## Prompt

```
You are migrating all route-level data loading in the Town Meeting Manager from PowerSync Kysely queries to Supabase client calls. After this session, all 11 route files load data via Supabase with full JOIN support.

PROJECT CONTEXT:
- Monorepo root: /Users/ben/Documents/GitHub/town-meeting-manager/
- Web package: packages/web/
- Framework: React Router v7 Framework Mode — routes use `clientLoader` for data fetching, `useLoaderData()` in components
- Supabase client singleton: packages/web/src/lib/supabase.ts (import as `import { supabase } from '@/lib/supabase'`)
- QueryClient singleton: packages/web/src/lib/queryClient.ts (import as `import { queryClient } from '@/lib/queryClient'`)
- Query keys: packages/web/src/lib/queryKeys.ts (import as `import { queryKeys } from '@/lib/queryKeys'`)
- ALL Supabase table names are SINGULAR: `town`, `board`, `meeting`, `agenda_item`, `motion`, `vote_record`, `meeting_attendance`, `minutes_document`, `board_member`, `person`, `user_account`, `exhibit`, `guest_speaker`, `agenda_template`, `executive_session`, `future_item_queue`, `agenda_item_transition`

CRITICAL RULES FOR ROUTE MIGRATIONS:
1. The Supabase client must be imported as a SINGLETON (not a hook) in route files: `import { supabase } from '@/lib/supabase'`
2. Hooks (useSupabase, useQuery, useMutation) cannot be called in clientLoader — clientLoader runs outside React
3. For prefetching, use: `await queryClient.ensureQueryData({ queryKey: ..., queryFn: ... })`
4. The component accesses prefetched data via `useLoaderData()` AND optionally hooks into React Query for live updates
5. For writes in route action handlers (not clientLoader), use direct supabase calls and then call `queryClient.invalidateQueries()`
6. JOINs are now available: `supabase.from('meeting').select('*, board(*), agenda_item(*)')` works correctly

CLIENTLOADER PATTERN:
```tsx
import type { LoaderFunctionArgs } from 'react-router';
import { supabase } from '@/lib/supabase';
import { queryClient } from '@/lib/queryClient';
import { queryKeys } from '@/lib/queryKeys';

export async function clientLoader({ params }: LoaderFunctionArgs) {
  const meetingId = params.meetingId!;

  const meeting = await queryClient.ensureQueryData({
    queryKey: queryKeys.meetings.detail(meetingId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('meeting')
        .select('*, board(*), agenda_item(*)')
        .eq('id', meetingId)
        .single();
      if (error) throw error;
      return data;
    },
  });

  return { meeting };
}

// In the component:
export default function MeetingPage() {
  const { meeting } = useLoaderData<typeof clientLoader>();
  // For live reactivity, also hook into React Query:
  const { data: liveData } = useQuery({
    queryKey: queryKeys.meetings.detail(meeting.id),
    queryFn: async () => { ... }, // same queryFn
    initialData: meeting, // pre-populated from clientLoader
  });
}
```

MUTATION PATTERN FOR ROUTES WITH WRITES:
```tsx
const saveMutation = useMutation({
  mutationFn: async (data: UpdateData) => {
    const { error } = await supabase
      .from('meeting')
      .update(data)
      .eq('id', meetingId);
    if (error) throw error;
  },
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.meetings.detail(meetingId) });
    toast.success('Saved');
  },
  onError: (error) => {
    toast.error(`Failed to save: ${error.message}`);
  },
});
```

TASK-BY-TASK INSTRUCTIONS:

Read each route file in full before modifying it. The files are located in packages/web/src/routes/.

TASK 2: dashboard.tsx
- clientLoader needs: current town (from auth context or user_account.town_id), boards for that town, recent meetings
- Since town_id comes from auth (JWT claims), the clientLoader may need to get it from the session:
  ```tsx
  const { data: { session } } = await supabase.auth.getSession();
  const townId = session?.user?.app_metadata?.town_id;
  ```
- Fetch boards: `supabase.from('board').select('*').eq('town_id', townId).order('name')`
- Fetch recent meetings: `supabase.from('meeting').select('*, board(name)').eq('town_id', townId).order('scheduled_date', { ascending: false }).limit(5)`

TASK 3: boards.tsx
- clientLoader fetches all boards for town
- `supabase.from('board').select('*').eq('town_id', townId).eq('archived', false).order('name')`

TASK 4: boards.$boardId.tsx
- clientLoader fetches board with board_members and persons
- `supabase.from('board').select('*, board_member(*, person(*))').eq('id', boardId).single()`
- The JOIN eliminates the need to merge in JS that was required with PowerSync

TASK 5: boards.$boardId.meetings.tsx
- clientLoader fetches meetings for this board, ordered by date descending
- `supabase.from('meeting').select('*').eq('board_id', boardId).order('scheduled_date', { ascending: false })`

TASK 6: boards.$boardId.templates.tsx
- clientLoader: `supabase.from('agenda_template').select('*, agenda_template_item(*)').eq('board_id', boardId)`
- Also migrate the 4 execute() calls. Read the file to find them — they are likely for: create template, update template, delete template, reorder template items. Replace each with a useMutation calling supabase.from('agenda_template').insert/update/delete. Call queryClient.invalidateQueries({ queryKey: queryKeys.agendaTemplates.byBoard(boardId) }) in onSuccess.

TASK 7: boards.$boardId.templates.$templateId.edit.tsx
- clientLoader: `supabase.from('agenda_template').select('*, agenda_template_item(*)').eq('id', templateId).single()`
- Read the file to find the 1 execute() call and replace with useMutation

TASK 8: meetings.$meetingId.tsx
- clientLoader: `supabase.from('meeting').select('*, board(*), agenda_item(*, exhibit(*))').eq('id', meetingId).single()`

TASK 9: meetings.$meetingId.agenda.tsx
- clientLoader: `supabase.from('meeting').select('*, agenda_item(*, exhibit(*))').eq('id', meetingId).single()`
- Read the file to find the 2 execute() calls — likely for reordering agenda items or updating item properties. Replace with useMutation.

TASK 10: meetings.$meetingId.review.tsx
- This route benefits most from JOINs. Read the file first to understand what it displays.
- clientLoader: `supabase.from('meeting').select('*, board(*), agenda_item(*), meeting_attendance(*, board_member(*, person(*))), motion(*, vote_record(*))').eq('id', meetingId).single()`
- Adjust the select string based on what the review page actually needs.

TASK 11: meetings.$meetingId.minutes.tsx
- Read the file in full — it has 9 execute() calls
- clientLoader: fetch meeting with agenda items, motions, attendance, and minutes_document
- For each of the 9 execute() calls: identify what it does (create draft, update content, mark reviewed, approve, etc.) and replace with useMutation calling the appropriate supabase table operation
- Call queryClient.invalidateQueries({ queryKey: queryKeys.minutes.byMeeting(meetingId) }) in each mutation's onSuccess

TASK 12: Check for other routes
List all route files:
```bash
ls packages/web/src/routes/
```
Read any route files not covered above that have clientLoader functions with PowerSync/Kysely patterns and migrate them using the same pattern.

HANDLING ERRORS FROM SUPABASE:
Always check for errors and throw them so React Router can handle them:
```tsx
const { data, error } = await supabase.from('meeting').select('*').eq('id', id).single();
if (error) throw new Response(error.message, { status: 404 });
return data;
```

HANDLING MISSING AUTH IN CLIENTLOADER:
If the clientLoader needs the current user's town_id but auth isn't available yet:
```tsx
const { data: { session } } = await supabase.auth.getSession();
if (!session) throw new Response('Unauthorized', { status: 401 });
const townId = session.user.app_metadata?.town_id as string;
```

WHAT NOT TO CHANGE IN THIS SESSION:
- Do NOT migrate useQuery calls inside component bodies — those are M.07
- Do NOT migrate powersync.execute() calls in sub-components imported by routes — those are M.07/M.08
- ONLY migrate the clientLoader function and any powersync.execute() calls directly in the route file's component body
- Leave all existing JSX, UI logic, and component structure unchanged

VERIFICATION CHECKLIST:
1. All 11 route files have clientLoader functions using `supabase.from(...)` (no Kysely or PowerSync)
2. No route file imports from @powersync/kysely-driver or uses getPowerSyncDb()
3. Write calls (execute → useMutation) are migrated in routes 6, 7, 9, 11
4. Each mutation calls queryClient.invalidateQueries() in onSuccess
5. Each mutation handles errors with toast.error() or similar
6. TypeScript check shows no errors originating in route files: `pnpm --filter @town-meeting/web tsc --noEmit --skipLibCheck 2>&1 | grep "routes/"`
```

## Commit Message

```
M.04: Migrate all route clientLoaders from PowerSync Kysely to Supabase
```
