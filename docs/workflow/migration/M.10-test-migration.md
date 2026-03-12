# Session M.10 — Test Migration: Update Test Files

**Phase:** Migration | **Block:** PowerSync → TanStack Query
**Dependencies:** M.09
**Estimated tasks:** 12

---

## Description

Update all test files to remove PowerSync mocks and use TanStack Query + Supabase test utilities. At this point the production code is fully migrated — the tests just need their imports and mock patterns updated to match.

## Test Files

Found in the codebase:

```
packages/web/src/routes/__tests__/login.test.tsx
packages/web/src/routes/__tests__/wizard.test.tsx
packages/web/src/routes/boards.$boardId.templates.$templateId.edit.test.tsx
packages/web/src/routes/meetings.$meetingId.agenda.test.tsx
packages/web/src/routes/meetings.$meetingId.live.test.tsx
packages/web/src/hooks/useQuorumCheck.test.ts
packages/web/src/components/boards/__tests__/MemberRoster.test.tsx
packages/web/src/components/meeting/MotionCaptureDialog.test.tsx
packages/shared/src/permissions/__tests__/permissions.test.ts
packages/shared/src/schemas/__tests__/schemas.test.ts
packages/shared/src/utils/__tests__/utils.test.ts
packages/shared/src/utils/__tests__/sample.test.ts
```

## Tasks

1. Read all test files to understand current mock patterns
2. Create a test utilities file: `packages/web/src/test-utils/index.tsx` — exports a `renderWithProviders` helper wrapping components in QueryClientProvider + AuthProvider
3. Migrate `login.test.tsx` — verify no PowerSync mocks needed (auth-only test)
4. Migrate `wizard.test.tsx` — replace PowerSync mocks with MSW or Supabase client mocks
5. Migrate `boards.$boardId.templates.$templateId.edit.test.tsx` — replace PowerSync mocks with React Query test client
6. Migrate `meetings.$meetingId.agenda.test.tsx` — replace PowerSync mocks
7. Migrate `meetings.$meetingId.live.test.tsx` — replace PowerSync mocks; mock Supabase Realtime
8. Migrate `useQuorumCheck.test.ts` — replace PowerSync reactive query mocks with React Query query mock
9. Migrate `MemberRoster.test.tsx` — replace PowerSync mocks
10. Migrate `MotionCaptureDialog.test.tsx` — replace PowerSync mocks with mutation mock
11. Run all tests: `pnpm --filter @town-meeting/web test` — fix any failures
12. Run shared package tests: `pnpm --filter @town-meeting/shared test` — ensure no regressions

## Prompt

```
You are updating the test files in the Town Meeting Manager to remove PowerSync mocks and use TanStack Query + Supabase test utilities. The production code is fully migrated at this point.

PROJECT CONTEXT:
- Monorepo root: /Users/ben/Documents/GitHub/town-meeting-manager/
- Test framework: Vitest (check vitest.config.ts in packages/web)
- Rendering: @testing-library/react
- Existing test files are in packages/web/src/routes/__tests__/, packages/web/src/hooks/, packages/web/src/components/

STEP 1: READ EXISTING TEST FILES

Read all test files listed above. Look for:
- PowerSync mock patterns: `vi.mock('@powersync/react')`, `vi.mock('@powersync/web')`
- Mock implementations: `useQuery: vi.fn()` returning mock data arrays
- PowerSyncProvider wrappers in test render helpers
- `powerSync.execute` mocks

STEP 2: CREATE TEST UTILITIES

Create packages/web/src/test-utils/index.tsx:

```typescript
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderOptions } from '@testing-library/react';
import type { ReactElement } from 'react';

/**
 * Create a fresh QueryClient for each test (prevents cache bleeding between tests)
 */
export function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,           // Don't retry in tests
        gcTime: Infinity,       // Prevent garbage collection during test
        staleTime: Infinity,    // Treat all data as fresh in tests
      },
      mutations: {
        retry: false,
      },
    },
  });
}

interface TestWrapperOptions extends Omit<RenderOptions, 'wrapper'> {
  queryClient?: QueryClient;
}

/**
 * Render a component wrapped in all required providers for testing.
 * Creates a fresh QueryClient per render unless one is provided.
 */
export function renderWithProviders(
  ui: ReactElement,
  { queryClient, ...options }: TestWrapperOptions = {}
) {
  const client = queryClient ?? createTestQueryClient();

  function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        {children}
      </QueryClientProvider>
    );
  }

  return {
    queryClient: client,
    ...render(ui, { wrapper: Wrapper, ...options }),
  };
}
```

STEP 3: MIGRATION PATTERN FOR TESTS

Old PowerSync test pattern:
```typescript
import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';

// Mock the entire @powersync/react module
vi.mock('@powersync/react', () => ({
  useQuery: vi.fn(() => ({
    data: [{ id: '1', name: 'Test Board', town_id: 'town-1', archived: 0 }],
  })),
  usePowerSync: vi.fn(() => ({
    execute: vi.fn(),
  })),
}));

// Mock PowerSyncProvider
vi.mock('@/providers/PowerSyncProvider', () => ({
  PowerSyncProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

test('renders board list', () => {
  render(<BoardList townId="town-1" />);
  expect(screen.getByText('Test Board')).toBeInTheDocument();
});
```

New TanStack Query test pattern:
```typescript
import { renderWithProviders, createTestQueryClient } from '@/test-utils';
import { screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';

// Mock the Supabase client
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({
        data: [{ id: '1', name: 'Test Board', town_id: 'town-1', archived: false }],
        error: null,
      }),
    })),
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: {
          session: {
            user: {
              id: 'user-1',
              email: 'test@example.com',
              app_metadata: { role: 'admin', town_id: 'town-1' },
            },
          },
        },
        error: null,
      }),
    },
    channel: vi.fn(() => ({
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn().mockReturnValue({ unsubscribe: vi.fn() }),
    })),
    removeChannel: vi.fn(),
  },
}));

test('renders board list', async () => {
  renderWithProviders(<BoardList townId="town-1" />);
  await waitFor(() => {
    expect(screen.getByText('Test Board')).toBeInTheDocument();
  });
});
```

KEY DIFFERENCES IN NEW PATTERN:
1. No PowerSync mocks — mock `@/lib/supabase` instead
2. The Supabase mock uses chained methods that eventually resolve with `{ data, error }`
3. `waitFor` is often needed because React Query fetches asynchronously (even with mocked data)
4. Use `renderWithProviders` instead of plain `render` to provide the QueryClient
5. Boolean values: `archived: false` (not `0`)

STEP 4: FILE-BY-FILE MIGRATION

For each test file:

1. Read the file in full
2. Remove all `vi.mock('@powersync/react')` calls
3. Remove all `vi.mock('@powersync/web')` calls
4. Remove all `vi.mock('@/providers/PowerSyncProvider')` calls
5. Remove all PowerSyncProvider wrapper functions
6. Add `vi.mock('@/lib/supabase', ...)` with the appropriate mock data for that test
7. Replace `render(...)` with `renderWithProviders(...)` (add QueryClient wrapper)
8. Add `await waitFor(...)` where needed for async queries

For `useQuorumCheck.test.ts`:
- The hook uses `useQuery` internally
- Use `@testing-library/react`'s `renderHook` with a QueryClient wrapper
- Mock the Supabase calls to return test attendance and board data
- Verify the calculated output (hasQuorum, presentCount, etc.)

For `MotionCaptureDialog.test.tsx`:
- This test likely mocks `powerSync.execute` for the motion creation write
- Replace with `vi.mock('@/lib/supabase')` and mock `supabase.from('motion').insert()`
- Test that the mutation is called with the right arguments
- Use `mutate` spy or check the mock call count

For `meetings.$meetingId.live.test.tsx`:
- This test likely mocks the Realtime subscription channels
- Add `channel: vi.fn(() => ({ on: vi.fn().mockReturnThis(), subscribe: vi.fn() }))` to the Supabase mock
- Add `removeChannel: vi.fn()` to verify cleanup
- Focus on verifying that the UI renders correctly with initial data

STEP 5: RUN TESTS

```bash
cd /Users/ben/Documents/GitHub/town-meeting-manager && pnpm --filter @town-meeting/web test
```

Fix any failing tests. Common issues:
- `waitFor` timeout: the mock async resolution may be slow — increase timeout if needed with `{ timeout: 5000 }`
- Supabase mock chain: the chainable mock pattern must return `this` for each method except the final one
- QueryClient not provided: components that use `useQuery` need a QueryClientProvider wrapper — use `renderWithProviders`

STEP 6: SHARED PACKAGE TESTS

The shared package tests (permissions.test.ts, schemas.test.ts, utils.test.ts, sample.test.ts) should not be affected by this migration since they test pure logic. Run them to confirm:

```bash
cd /Users/ben/Documents/GitHub/town-meeting-manager && pnpm --filter @town-meeting/shared test
```

If any shared package test references PowerSync types (from the deleted schema.ts), update the import to use the new database types from `./types/database`.

VERIFICATION CHECKLIST:
1. packages/web/src/test-utils/index.tsx exists with renderWithProviders and createTestQueryClient
2. No test file imports from @powersync/react or @powersync/web
3. All test files mock @/lib/supabase instead
4. All test renders use renderWithProviders or provide a QueryClient wrapper
5. `pnpm --filter @town-meeting/web test` passes with 0 failures
6. `pnpm --filter @town-meeting/shared test` passes with 0 failures
```

## Commit Message

```
M.10: Migrate test files from PowerSync mocks to TanStack Query + Supabase mocks
```
