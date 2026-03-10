/**
 * PowerSync mock provider for unit and component tests.
 *
 * Since PowerSync's useQuery hook depends on WASM internals that can't
 * run in jsdom, we mock at the module level. Components under test that
 * use useQuery will receive data configured via setupQueryMock().
 *
 * Components that use usePowerSync() for writes (execute) get a mock
 * database with vi.fn() stubs.
 */

import React, { type ReactNode } from "react";
import { vi } from "vitest";

// ─── Mock database ──────────────────────────────────────────────────

export interface MockPowerSyncDatabase {
  execute: ReturnType<typeof vi.fn>;
  getAll: ReturnType<typeof vi.fn>;
  getOptional: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  watch: ReturnType<typeof vi.fn>;
  writeTransaction: ReturnType<typeof vi.fn>;
  connected: boolean;
  currentStatus: {
    connected: boolean;
    hasSynced: boolean;
    dataFlowStatus: { uploading: boolean; downloading: boolean };
  };
}

/**
 * Create a mock PowerSync database with vi.fn() stubs.
 * Override specific methods by passing them in the overrides object.
 */
export function createMockPowerSync(
  overrides: Partial<MockPowerSyncDatabase> = {},
): MockPowerSyncDatabase {
  return {
    execute: vi.fn().mockResolvedValue({ rows: { _array: [] }, insertId: undefined, rowsAffected: 0 }),
    getAll: vi.fn().mockResolvedValue([]),
    getOptional: vi.fn().mockResolvedValue(null),
    get: vi.fn().mockResolvedValue(undefined),
    watch: vi.fn().mockImplementation(function* () {
      yield [];
    }),
    writeTransaction: vi.fn().mockImplementation(async (callback: (tx: unknown) => Promise<void>) => {
      const mockTx = {
        execute: vi.fn().mockResolvedValue({ rows: { _array: [] }, insertId: undefined, rowsAffected: 0 }),
        getAll: vi.fn().mockResolvedValue([]),
        getOptional: vi.fn().mockResolvedValue(null),
        get: vi.fn().mockResolvedValue(undefined),
      };
      await callback(mockTx);
    }),
    connected: true,
    currentStatus: {
      connected: true,
      hasSynced: true,
      dataFlowStatus: { uploading: false, downloading: false },
    },
    ...overrides,
  };
}

// ─── Mock provider ──────────────────────────────────────────────────

interface MockPowerSyncProviderProps {
  db?: MockPowerSyncDatabase;
  children: ReactNode;
}

/**
 * Wraps children with a context that makes usePowerSync() return the
 * mock database. Use this when your component calls usePowerSync()
 * for write operations.
 *
 * Note: useQuery is mocked at the module level via vi.mock() — see
 * setupQueryMock() or use mockQueryResult() in individual tests.
 */
export function MockPowerSyncProvider({ db, children }: MockPowerSyncProviderProps) {
  // We mock usePowerSync at the module level, so this provider is a
  // simple passthrough. The actual mock database is set via the module mock.
  return React.createElement(React.Fragment, null, children);
}

// ─── useQuery helpers ───────────────────────────────────────────────

/**
 * Build a return value for a mocked useQuery call.
 */
export function mockQueryResult<T = Record<string, unknown>>(data: T[]) {
  return {
    data,
    isLoading: false,
    isFetching: false,
    error: undefined,
  };
}

/**
 * Build a loading-state return value for a mocked useQuery call.
 */
export function mockQueryLoading() {
  return {
    data: [],
    isLoading: true,
    isFetching: false,
    error: undefined,
  };
}

/**
 * Build an error-state return value for a mocked useQuery call.
 */
export function mockQueryError(error: Error) {
  return {
    data: [],
    isLoading: false,
    isFetching: false,
    error,
  };
}

// ─── Module-level mock setup ────────────────────────────────────────

/**
 * Set up vi.mock for @powersync/react with configurable query results.
 *
 * Usage in test files:
 *
 *   import { vi } from "vitest";
 *   import { createMockPowerSync, mockQueryResult } from "@/test/mocks/powersync-mock";
 *
 *   const mockDb = createMockPowerSync();
 *
 *   vi.mock("@powersync/react", () => ({
 *     useQuery: vi.fn().mockReturnValue(mockQueryResult([{ id: "1", name: "Test" }])),
 *     usePowerSync: vi.fn().mockReturnValue(mockDb),
 *     PowerSyncContext: { Provider: ({ children }: any) => children },
 *   }));
 *
 * For multiple queries returning different data, use mockImplementation
 * with a matcher on the SQL string:
 *
 *   vi.mock("@powersync/react", () => ({
 *     useQuery: vi.fn().mockImplementation((sql: string) => {
 *       if (sql.includes("FROM boards")) return mockQueryResult([board]);
 *       if (sql.includes("FROM towns")) return mockQueryResult([town]);
 *       return mockQueryResult([]);
 *     }),
 *     usePowerSync: vi.fn().mockReturnValue(mockDb),
 *     PowerSyncContext: { Provider: ({ children }: any) => children },
 *   }));
 */
