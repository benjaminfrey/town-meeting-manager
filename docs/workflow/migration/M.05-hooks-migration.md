# Session M.05 — Hooks Migration: Replace PowerSync Hooks with React Query Equivalents

**Phase:** Migration | **Block:** PowerSync → TanStack Query
**Dependencies:** M.02
**Estimated tasks:** 8

---

## Description

Migrate the hook files that directly use PowerSync. Delete `usePowerSync.ts` and `useDb.ts`. Rewrite `useCurrentUser.ts` and `useQuorumCheck.ts` to use TanStack Query with Supabase. Audit `useVoteCalculation.ts`, `useExhibitUpload.ts`, and `useMeetingTimer.ts` for any PowerSync references and fix them.

## Tasks

1. Delete `packages/web/src/hooks/usePowerSync.ts`
2. Delete `packages/web/src/hooks/useDb.ts`
3. Rewrite `packages/web/src/hooks/useCurrentUser.ts` — replace PowerSync SQL query with `useQuery` from TanStack Query fetching from `user_account` and `person` tables via Supabase; return the same shape as before
4. Rewrite `packages/web/src/hooks/useQuorumCheck.ts` — replace `useQuery` from `@powersync/react` with `useQuery` from `@tanstack/react-query`; fetch `meeting_attendance` and board `member_count` via Supabase; return `{ hasQuorum, presentCount, quorumNeeded, isLoading }`
5. Audit `packages/web/src/hooks/useVoteCalculation.ts` — if it references PowerSync, replace with Supabase
6. Audit `packages/web/src/hooks/useExhibitUpload.ts` — if it references PowerSync writes, replace with Supabase Storage + useMutation
7. Audit `packages/web/src/hooks/useMeetingTimer.ts` — verify it does not reference PowerSync (it should only use setInterval/requestAnimationFrame)
8. Run `pnpm --filter @town-meeting/web tsc --noEmit --skipLibCheck 2>&1 | grep "src/hooks/"` — no errors should originate from hook files

## Prompt

```
You are migrating the hook files in the Town Meeting Manager from PowerSync to TanStack Query + Supabase. These hooks are used by many components, so getting them right is critical for the subsequent component migration sessions.

PROJECT CONTEXT:
- Monorepo root: /Users/ben/Documents/GitHub/town-meeting-manager/
- Hooks directory: packages/web/src/hooks/
- useSupabase() hook: packages/web/src/hooks/useSupabase.ts — returns the Supabase client
- queryKeys: packages/web/src/lib/queryKeys.ts
- TanStack Query v5 — useQuery API: `useQuery({ queryKey: [...], queryFn: async () => ... })`
- Table names are SINGULAR: `user_account`, `person`, `meeting_attendance`, `board`, `board_member`

TASK 1 & 2: Delete dead hook files

```bash
rm packages/web/src/hooks/usePowerSync.ts
rm packages/web/src/hooks/useDb.ts
```

These hooks were wrappers around the PowerSync instance and Kysely driver respectively. They have no equivalent — components will use useSupabase() and useQueryClient() directly.

TASK 3: Rewrite packages/web/src/hooks/useCurrentUser.ts

First, read the current file to understand what shape it returns. The hook provides identity information for the authenticated user throughout the app.

The new implementation uses Supabase auth for the session and TanStack Query for the database records:

```typescript
import { useQuery } from '@tanstack/react-query';
import { useSupabase } from '@/hooks/useSupabase';
import { queryKeys } from '@/lib/queryKeys';

// Match whatever shape the existing hook returns — read the current file first
export interface CurrentUser {
  id: string;           // user_account.id
  personId: string;     // person.id
  email: string;
  role: string;         // app_metadata.role from JWT
  townId: string;       // app_metadata.town_id from JWT
  name: string;         // person.first_name + person.last_name
  firstName: string;
  lastName: string;
  isLoading: boolean;
  isAuthenticated: boolean;
}

export function useCurrentUser() {
  const supabase = useSupabase();

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.currentUser,
    queryFn: async () => {
      // Get auth session
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !session) return null;

      const userId = session.user.id;
      // Role comes from JWT app_metadata (NOT session.user.role — that is always "authenticated")
      // See MEMORY.md: the JWT role field bug — use app_metadata.role
      const role = session.user.app_metadata?.role as string;
      const townId = session.user.app_metadata?.town_id as string;

      // Fetch user_account and linked person
      const { data: userAccount, error: userError } = await supabase
        .from('user_account')
        .select('*, person(*)')
        .eq('auth_user_id', userId)
        .single();

      if (userError || !userAccount) return null;

      const person = (userAccount as any).person;

      return {
        id: userAccount.id,
        personId: person?.id ?? '',
        email: session.user.email ?? '',
        role,
        townId,
        name: person ? `${person.first_name} ${person.last_name}`.trim() : '',
        firstName: person?.first_name ?? '',
        lastName: person?.last_name ?? '',
        isLoading: false,
        isAuthenticated: true,
      };
    },
    staleTime: 1000 * 60 * 5, // 5 minutes — user identity doesn't change often
  });

  if (isLoading) {
    return {
      id: '',
      personId: '',
      email: '',
      role: '',
      townId: '',
      name: '',
      firstName: '',
      lastName: '',
      isLoading: true,
      isAuthenticated: false,
    } satisfies CurrentUser;
  }

  if (!data) {
    return {
      id: '',
      personId: '',
      email: '',
      role: '',
      townId: '',
      name: '',
      firstName: '',
      lastName: '',
      isLoading: false,
      isAuthenticated: false,
    } satisfies CurrentUser;
  }

  return data satisfies CurrentUser;
}
```

IMPORTANT: Read the existing useCurrentUser.ts before writing the new version. The `CurrentUser` interface above is a template — match the exact shape that the existing hook returns (it may have additional fields like `boardMemberId`, `permissions`, `isAdmin`, etc.). Preserve all existing fields.

The key changes from the PowerSync version:
- Remove `useQuery` from `@powersync/react` — replace with `useQuery` from `@tanstack/react-query`
- Remove raw SQL like `SELECT * FROM user_account WHERE auth_user_id = ?` — replace with `supabase.from('user_account').select('*, person(*)').eq('auth_user_id', userId).single()`
- The JWT role bug is documented in MEMORY.md: `payload.role` is always "authenticated" — use `app_metadata.role` for the actual app role

TASK 4: Rewrite packages/web/src/hooks/useQuorumCheck.ts

First, read the current file to understand what it queries.

```typescript
import { useQuery } from '@tanstack/react-query';
import { useSupabase } from '@/hooks/useSupabase';
import { queryKeys } from '@/lib/queryKeys';

interface QuorumCheckResult {
  hasQuorum: boolean;
  presentCount: number;
  quorumNeeded: number;
  totalSeated: number;
  isLoading: boolean;
}

export function useQuorumCheck(meetingId: string): QuorumCheckResult {
  const supabase = useSupabase();

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.attendance.byMeeting(meetingId),
    queryFn: async () => {
      // Get meeting to find board_id
      const { data: meeting } = await supabase
        .from('meeting')
        .select('board_id, board(member_count)')
        .eq('id', meetingId)
        .single();

      if (!meeting) throw new Error('Meeting not found');

      // Get attendance records
      const { data: attendance } = await supabase
        .from('meeting_attendance')
        .select('status')
        .eq('meeting_id', meetingId);

      const presentCount = (attendance ?? []).filter(
        (a) => a.status === 'present' || a.status === 'late_arrival'
      ).length;

      // board.member_count is the number of seated members (active board members)
      const board = (meeting as any).board;
      const totalSeated = board?.member_count ?? 0;
      const quorumNeeded = Math.floor(totalSeated / 2) + 1;
      const hasQuorum = presentCount >= quorumNeeded;

      return { hasQuorum, presentCount, quorumNeeded, totalSeated };
    },
    enabled: !!meetingId,
    // In the live meeting context this hook is used alongside Realtime subscriptions.
    // Add a fallback polling interval in case Realtime is slow to deliver updates.
    refetchInterval: 10000, // 10 second fallback poll
  });

  if (isLoading || !data) {
    return { hasQuorum: false, presentCount: 0, quorumNeeded: 0, totalSeated: 0, isLoading: true };
  }

  return { ...data, isLoading: false };
}
```

IMPORTANT: If the board table doesn't have a `member_count` column, fetch the count directly:
```typescript
const { count: totalSeated } = await supabase
  .from('board_member')
  .select('*', { count: 'exact', head: true })
  .eq('board_id', meeting.board_id)
  .eq('status', 'active');
```
Adjust based on the actual schema revealed by packages/shared/src/types/database.ts.

TASK 5: Audit and fix useVoteCalculation.ts

Read packages/web/src/hooks/useVoteCalculation.ts (if it exists).
- If it uses `useQuery` from `@powersync/react`: replace with `useQuery` from `@tanstack/react-query` and fetch via Supabase
- If it uses `usePowerSync()` or `useDb()`: replace with `useSupabase()` and direct Supabase queries
- If it only does calculation logic with no data fetching, no changes needed

TASK 6: Audit and fix useExhibitUpload.ts

Read packages/web/src/hooks/useExhibitUpload.ts (if it exists).
- If it uses `powerSync.execute()` for writes: replace with `useMutation` + `supabase.from('exhibit').insert(...)`
- File uploads likely already use Supabase Storage — verify that path is unchanged
- The mutation pattern:
  ```typescript
  const { mutateAsync: saveExhibit } = useMutation({
    mutationFn: async (exhibit: ExhibitInsert) => {
      const { error } = await supabase.from('exhibit').insert(exhibit);
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.exhibits.byMeeting(vars.meeting_id) });
    },
  });
  ```

TASK 7: Audit useMeetingTimer.ts

Read packages/web/src/hooks/useMeetingTimer.ts (if it exists).
- This hook should only reference `started_at` timestamps and use setInterval/requestAnimationFrame for counting
- It should NOT reference PowerSync or Supabase directly — it receives timestamps as props
- If it does reference PowerSync, extract the data fetching to a separate query and pass the timestamps as parameters
- No changes needed if it's already pure computation

TASK 8: Verify hooks compile

Run:
```bash
cd /Users/ben/Documents/GitHub/town-meeting-manager && pnpm --filter @town-meeting/web tsc --noEmit --skipLibCheck 2>&1 | grep "src/hooks/"
```

Fix any TypeScript errors that appear in hook files. Errors in other files (routes, components) that import from the old hooks are acceptable and will be fixed in later sessions.

COMMON ISSUES TO WATCH FOR:
1. The Supabase select() with a relation (e.g., `select('*, person(*)')`) returns a nested object — TypeScript may infer it as an array or scalar depending on the cardinality. Use type assertions if needed: `(userAccount as any).person`
2. TanStack Query v5 has a different API from v4 — use the object form: `useQuery({ queryKey: [...], queryFn: ... })`
3. The `enabled` option prevents the query from running when the parameter is falsy — always add `enabled: !!meetingId` when the param might be empty

VERIFICATION CHECKLIST:
1. packages/web/src/hooks/usePowerSync.ts has been deleted
2. packages/web/src/hooks/useDb.ts has been deleted
3. useCurrentUser.ts imports useQuery from @tanstack/react-query (not @powersync/react)
4. useCurrentUser.ts uses supabase.from('user_account') not raw SQL
5. useCurrentUser.ts correctly reads role from app_metadata.role (JWT bug fix from MEMORY.md)
6. useQuorumCheck.ts imports useQuery from @tanstack/react-query
7. useQuorumCheck.ts fetches meeting_attendance via supabase.from('meeting_attendance')
8. useQuorumCheck.ts returns { hasQuorum, presentCount, quorumNeeded, totalSeated, isLoading }
9. No hook file imports from @powersync packages
10. TypeScript check shows 0 errors in src/hooks/ files
```

## Commit Message

```
M.05: Migrate PowerSync hooks to TanStack Query + Supabase
```
