# Session M.09 — Live Meeting Realtime: Full Migration of meetings.$meetingId.live.tsx

**Phase:** Migration | **Block:** PowerSync → TanStack Query
**Dependencies:** M.08
**Estimated tasks:** 15

---

## Description

Migrate the live meeting page — the most complex file in the app. `meetings.$meetingId.live.tsx` is the real-time multi-panel interface used during active meetings. It had many PowerSync execute calls and relied on PowerSync's reactive streaming for multi-device sync. This session replaces all PowerSync patterns with:

- Supabase for all read queries (via TanStack Query)
- Supabase Realtime (`postgres_changes`) for live multi-device sync
- `useMutation` + Supabase for all writes
- `useRealtimeSubscription` from M.02 for subscription management

Also migrate the associated sub-components:
- `packages/web/src/components/meeting/AgendaItemDetailPanel.tsx`
- `packages/web/src/components/meeting/AttendancePanel.tsx`
- `packages/web/src/components/meeting/MotionPanel.tsx`
- `packages/web/src/components/meeting/MotionCaptureDialog.tsx`
- `packages/web/src/components/meeting/MeetingStartFlow.tsx`
- `packages/web/src/components/meeting/GuestSpeakerEntry.tsx`
- `packages/web/src/components/meeting/RecusalDialog.tsx`
- `packages/web/src/components/meeting/ExitExecutiveSessionDialog.tsx`
- `packages/web/src/components/meeting/VotePanel.tsx`

And wire in:
- `ConnectionStatusBar` (prominent mode) in the live meeting header
- `useQuorumCheck` (already migrated in M.05)

## Tasks

1. Read `packages/web/src/routes/meetings.$meetingId.live.tsx` in full to understand current structure
2. Read the associated component files: AgendaItemDetailPanel, AttendancePanel, MotionPanel, MotionCaptureDialog, MeetingStartFlow, GuestSpeakerEntry, RecusalDialog, ExitExecutiveSessionDialog, VotePanel
3. Identify all query patterns: what data is fetched, what channels are used
4. Identify all write patterns: what execute calls exist, what tables they modify
5. Create the clientLoader for the live meeting route
6. Set up 4 Realtime subscriptions using `useRealtimeSubscription`:
   - `meeting_attendance` filtered by meeting_id
   - `motion` filtered by meeting_id
   - `vote_record` filtered by meeting_id
   - `agenda_item` filtered by meeting_id
7. Migrate all useQuery reads to TanStack Query + Supabase
8. Migrate all powersync.execute() writes to useMutation + Supabase
9. Replace PowerSync subscription channels with Supabase Realtime
10. Wire `ConnectionStatusBar prominent={true}` into the live meeting header
11. Wire `useQuorumCheck` (already migrated in M.05) for quorum display
12. Migrate the live.test.tsx file stubs (actual test migration is M.10 — just fix imports here)
13. Run full TypeScript check: `pnpm --filter @town-meeting/web tsc --noEmit --skipLibCheck` — expect zero errors
14. Verify no `@powersync` imports remain anywhere: `grep -r "@powersync" packages/web/src/ --include="*.ts" --include="*.tsx"` — expect zero matches
15. Build the web package: `pnpm --filter @town-meeting/web build` — must succeed

## Prompt

```
You are completing the final production code migration in the Town Meeting Manager — the live meeting page. This is the most complex file, as it powers the real-time multi-panel interface used during active town meetings.

PROJECT CONTEXT:
- Monorepo root: /Users/ben/Documents/GitHub/town-meeting-manager/
- Live meeting route: packages/web/src/routes/meetings.$meetingId.live.tsx
- Associated components: packages/web/src/components/meeting/
- useRealtimeSubscription: packages/web/src/hooks/useRealtimeSubscription.ts (built in M.02)
- useQuorumCheck: packages/web/src/hooks/useQuorumCheck.ts (migrated in M.05)
- ConnectionStatusBar: packages/web/src/components/ConnectionStatusBar.tsx (built in M.02)
- queryKeys: packages/web/src/lib/queryKeys.ts
- Table names are SINGULAR

STEP 1: READ EVERYTHING FIRST

Before writing any code, read these files in full:
- packages/web/src/routes/meetings.$meetingId.live.tsx
- packages/web/src/components/meeting/AttendancePanel.tsx
- packages/web/src/components/meeting/MotionPanel.tsx
- packages/web/src/components/meeting/MotionCaptureDialog.tsx
- packages/web/src/components/meeting/VotePanel.tsx
- packages/web/src/components/meeting/AgendaItemDetailPanel.tsx
- packages/web/src/components/meeting/MeetingStartFlow.tsx
- packages/web/src/components/meeting/GuestSpeakerEntry.tsx
- packages/web/src/components/meeting/RecusalDialog.tsx
- packages/web/src/components/meeting/ExitExecutiveSessionDialog.tsx

Compile a list of:
- All tables queried (with the exact column selections used)
- All PowerSync execute calls (with the SQL and parameter patterns)
- Any PowerSync watch/subscribe calls (if any — some PowerSync versions had .watch())
- The component prop interfaces (what data flows from parent to child)

STEP 2: LIVE MEETING DATA ARCHITECTURE

The live meeting page needs these data sets:
- `meeting`: basic info (title, scheduled_date, board_id, status)
- `board`: name, quorum_type, quorum_value
- `agenda_items`: all items for the meeting, ordered by display_order (with sections, sub-items)
- `meeting_attendance`: all attendance records for this meeting
- `motions`: all motions for this meeting
- `vote_records`: all votes for this meeting (optionally joined from motions)
- `guest_speakers`: all guest speakers for this meeting
- `executive_sessions`: any executive sessions for this meeting

REALTIME STRATEGY:
Instead of PowerSync's automatic reactive sync, use Supabase Realtime to subscribe to changes in these tables filtered by meeting_id. When a change arrives, invalidate the relevant React Query cache — this triggers a refetch for all components that depend on that data.

```typescript
// In the main live meeting component:
const queryClient = useQueryClient();
const meetingId = params.meetingId!;

// Subscribe to attendance changes
useRealtimeSubscription(
  `live-meeting-${meetingId}-attendance`,
  'meeting_attendance',
  `meeting_id=eq.${meetingId}`,
  () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.attendance.byMeeting(meetingId) });
  }
);

// Subscribe to motion/vote changes
useRealtimeSubscription(
  `live-meeting-${meetingId}-motions`,
  'motion',
  `meeting_id=eq.${meetingId}`,
  () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.motions.byMeeting(meetingId) });
  }
);

// Subscribe to agenda item changes (order changes, status changes)
useRealtimeSubscription(
  `live-meeting-${meetingId}-agenda`,
  'agenda_item',
  `meeting_id=eq.${meetingId}`,
  () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.agendaItems.byMeeting(meetingId) });
  }
);

// Subscribe to vote record changes
useRealtimeSubscription(
  `live-meeting-${meetingId}-votes`,
  'vote_record',
  `meeting_id=eq.${meetingId}`,
  () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.voteRecords.byMeeting(meetingId) });
  }
);
```

STEP 3: CLIENTLOADER

```typescript
import type { LoaderFunctionArgs } from 'react-router';
import { supabase } from '@/lib/supabase';
import { queryClient } from '@/lib/queryClient';
import { queryKeys } from '@/lib/queryKeys';

export async function clientLoader({ params }: LoaderFunctionArgs) {
  const meetingId = params.meetingId!;

  const [meeting, agendaItems, attendance, motions] = await Promise.all([
    queryClient.ensureQueryData({
      queryKey: queryKeys.meetings.detail(meetingId),
      queryFn: async () => {
        const { data, error } = await supabase
          .from('meeting')
          .select('*, board(*)')
          .eq('id', meetingId)
          .single();
        if (error) throw error;
        return data;
      },
    }),
    queryClient.ensureQueryData({
      queryKey: queryKeys.agendaItems.byMeeting(meetingId),
      queryFn: async () => {
        const { data, error } = await supabase
          .from('agenda_item')
          .select('*, exhibit(*)')
          .eq('meeting_id', meetingId)
          .order('display_order');
        if (error) throw error;
        return data ?? [];
      },
    }),
    queryClient.ensureQueryData({
      queryKey: queryKeys.attendance.byMeeting(meetingId),
      queryFn: async () => {
        const { data, error } = await supabase
          .from('meeting_attendance')
          .select('*, board_member(*, person(*))')
          .eq('meeting_id', meetingId);
        if (error) throw error;
        return data ?? [];
      },
    }),
    queryClient.ensureQueryData({
      queryKey: queryKeys.motions.byMeeting(meetingId),
      queryFn: async () => {
        const { data, error } = await supabase
          .from('motion')
          .select('*, vote_record(*)')
          .eq('meeting_id', meetingId)
          .order('created_at');
        if (error) throw error;
        return data ?? [];
      },
    }),
  ]);

  return { meeting, agendaItems, attendance, motions };
}
```

STEP 4: WRITE OPERATIONS

The live meeting has many write operations. For each `powerSync.execute()` call found in step 1, create a useMutation. Here are the expected operations and their Supabase equivalents:

START MEETING:
```typescript
// Old: powerSync.execute('UPDATE meeting SET status = ?, started_at = ? WHERE id = ?', ['in_progress', now, meetingId])
// New:
supabase.from('meeting').update({ status: 'in_progress', started_at: new Date().toISOString() }).eq('id', meetingId)
// Invalidate: queryKeys.meetings.detail(meetingId)
```

RECORD ATTENDANCE:
```typescript
// Old: powerSync.execute('INSERT INTO meeting_attendance (id, meeting_id, board_member_id, status) VALUES (?,?,?,?)', [id, meetingId, memberId, status])
// New:
supabase.from('meeting_attendance').upsert({ id: crypto.randomUUID(), meeting_id: meetingId, board_member_id: memberId, status }, { onConflict: 'meeting_id,board_member_id' })
// Invalidate: queryKeys.attendance.byMeeting(meetingId)
```

UPDATE ATTENDANCE STATUS:
```typescript
// Old: powerSync.execute('UPDATE meeting_attendance SET status = ? WHERE meeting_id = ? AND board_member_id = ?', [status, meetingId, memberId])
// New:
supabase.from('meeting_attendance').update({ status }).eq('meeting_id', meetingId).eq('board_member_id', memberId)
// Invalidate: queryKeys.attendance.byMeeting(meetingId)
```

MOVE AGENDA ITEM (navigation):
```typescript
// Old: powerSync.execute('UPDATE meeting SET current_agenda_item_id = ? WHERE id = ?', [itemId, meetingId])
// New:
supabase.from('meeting').update({ current_agenda_item_id: itemId }).eq('id', meetingId)
// Invalidate: queryKeys.meetings.detail(meetingId)
```

CREATE MOTION:
```typescript
// Old: powerSync.execute('INSERT INTO motion (id, meeting_id, agenda_item_id, text, ...) VALUES (?,?,?,?,...)', [...])
// New:
supabase.from('motion').insert({ id: crypto.randomUUID(), meeting_id: meetingId, agenda_item_id: itemId, text: motionText, ... })
// Invalidate: queryKeys.motions.byMeeting(meetingId)
```

RECORD VOTE:
```typescript
// Old: powerSync.execute('INSERT INTO vote_record (id, motion_id, board_member_id, vote) VALUES (?,?,?,?)', [id, motionId, memberId, vote])
// New:
supabase.from('vote_record').upsert({ id: crypto.randomUUID(), motion_id: motionId, board_member_id: memberId, vote }, { onConflict: 'motion_id,board_member_id' })
// Invalidate: queryKeys.voteRecords.byMotion(motionId)
```

CLOSE VOTE:
```typescript
// Old: powerSync.execute('UPDATE motion SET voting_closed = 1, result = ? WHERE id = ?', [result, motionId])
// New:
supabase.from('motion').update({ voting_closed: true, result }).eq('id', motionId)
// Invalidate: queryKeys.motions.byMeeting(meetingId)
```

RECORD RECUSAL:
```typescript
supabase.from('vote_record').insert({ motion_id: motionId, board_member_id: memberId, vote: 'recused' })
```

ADD GUEST SPEAKER:
```typescript
supabase.from('guest_speaker').insert({ id: crypto.randomUUID(), meeting_id: meetingId, agenda_item_id: itemId, name, topic, ... })
// Invalidate: queryKeys.guestSpeakers.byMeeting(meetingId)
```

END MEETING / ADJOURN:
```typescript
supabase.from('meeting').update({ status: 'adjourned', ended_at: new Date().toISOString() }).eq('id', meetingId)
// Invalidate: queryKeys.meetings.detail(meetingId)
```

EXECUTIVE SESSION:
```typescript
supabase.from('executive_session').insert({ id: crypto.randomUUID(), meeting_id: meetingId, ... })
// Invalidate: queryKeys.executiveSessions.byMeeting(meetingId)
```

EXIT EXECUTIVE SESSION:
```typescript
supabase.from('executive_session').update({ ended_at: now }).eq('id', sessionId)
// Invalidate: queryKeys.executiveSessions.byMeeting(meetingId)
```

ADJUST EXACT SQL MAPPINGS:
The SQL above is a template — read the actual execute() calls in step 1 and adjust the column names, table names, and data shapes to match exactly.

STEP 5: CONNECTION STATUS IN LIVE MEETING

The live meeting header should show connection status prominently. Find the header area in the JSX and add:
```tsx
import { ConnectionStatusBar } from '@/components/ConnectionStatusBar';

// In the top of the live meeting layout:
<ConnectionStatusBar prominent={true} />
```

STEP 6: QUORUM DISPLAY

The live meeting already uses `useQuorumCheck` — this was migrated in M.05. No changes needed to the hook call itself, but verify the import is correct:
```typescript
import { useQuorumCheck } from '@/hooks/useQuorumCheck';
```

STEP 7: FIX LIVE TEST FILE

Read `packages/web/src/routes/meetings.$meetingId.live.test.tsx`. Update any PowerSync imports to Supabase/React Query equivalents. Do not rewrite tests — just fix imports so the file compiles. Full test rewrite is in M.10.

STEP 8: FINAL VERIFICATION

After completing all migrations:

1. Check for remaining PowerSync imports:
```bash
grep -r "@powersync" packages/web/src/ --include="*.ts" --include="*.tsx"
```
Expected: zero matches.

2. Check for remaining powersync.execute calls:
```bash
grep -r "powerSync.execute\|powersync.execute\|usePowerSync\|useDb()" packages/web/src/ --include="*.ts" --include="*.tsx"
```
Expected: zero matches.

3. Full TypeScript check:
```bash
cd /Users/ben/Documents/GitHub/town-meeting-manager && pnpm --filter @town-meeting/web tsc --noEmit --skipLibCheck
```
Expected: zero errors.

4. Build:
```bash
cd /Users/ben/Documents/GitHub/town-meeting-manager && pnpm --filter @town-meeting/web build
```
Expected: successful build.

IMPORTANT NOTES:
- The live meeting page is used by multiple devices simultaneously during a meeting — the Realtime subscriptions must clean up properly (useRealtimeSubscription handles this)
- Optimistic updates are NOT needed — the Realtime subscriptions will update the UI within ~100ms
- The ConnectionStatusBar in prominent mode shows a full-width banner, which is appropriate for the live meeting context where a dropped connection is critical
- Keep the existing three-panel layout, timer logic, and all UI state management unchanged — only replace the data layer
```

## Commit Message

```
M.09: Migrate live meeting page to TanStack Query + Supabase Realtime — PowerSync fully removed
```
