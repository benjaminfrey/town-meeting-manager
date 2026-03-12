// TEMPORARY MIGRATION SHIM — DELETE IN SESSION M.11
// This file exists to prevent import errors in components that still import
// SyncStatusBar during the migration. All callers will be updated to import
// ConnectionStatusBar directly before M.11 deletes this file.
export { ConnectionStatusBar as SyncStatusBar } from './ConnectionStatusBar';
