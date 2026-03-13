/**
 * Feature-area skeleton loaders
 *
 * Each skeleton approximates the shape of its real content so the transition
 * from loading → loaded is smooth and doesn't cause layout shift.
 */

import { Skeleton } from "@/components/ui/skeleton";

// ─── Meeting list / card ──────────────────────────────────────────────

export function MeetingCardSkeleton() {
  return (
    <div className="flex items-center justify-between rounded-lg border bg-card p-4">
      <div className="flex flex-col gap-2 flex-1 min-w-0">
        <Skeleton className="h-4 w-48" />
        <div className="flex items-center gap-2">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-3 w-16" />
        </div>
        <Skeleton className="h-3 w-36" />
      </div>
      <div className="ml-4 flex items-center gap-2 shrink-0">
        <Skeleton className="h-5 w-20 rounded-full" />
        <Skeleton className="h-8 w-24 rounded-md" />
      </div>
    </div>
  );
}

export function MeetingListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <MeetingCardSkeleton key={i} />
      ))}
    </div>
  );
}

// ─── Board member table ───────────────────────────────────────────────

export function BoardMemberRowSkeleton() {
  return (
    <div className="flex items-center gap-4 rounded-md border px-4 py-3">
      <Skeleton className="h-8 w-8 rounded-full shrink-0" />
      <div className="flex-1 space-y-1.5">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-3 w-28" />
      </div>
      <Skeleton className="h-5 w-20 rounded-full" />
      <Skeleton className="h-8 w-8 rounded-md" />
    </div>
  );
}

export function BoardMemberTableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <BoardMemberRowSkeleton key={i} />
      ))}
    </div>
  );
}

// ─── Agenda section ───────────────────────────────────────────────────

export function AgendaItemSkeleton() {
  return (
    <div className="rounded-md border p-4 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 space-y-1.5">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
        </div>
        <Skeleton className="h-5 w-16 rounded-full shrink-0" />
      </div>
    </div>
  );
}

export function AgendaSectionSkeleton({ items = 3 }: { items?: number }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Skeleton className="h-5 w-5 rounded" />
        <Skeleton className="h-5 w-44" />
      </div>
      {Array.from({ length: items }).map((_, i) => (
        <AgendaItemSkeleton key={i} />
      ))}
    </div>
  );
}

// ─── Minutes document ─────────────────────────────────────────────────

export function MinutesSkeleton() {
  return (
    <div className="space-y-6 px-6 py-8 max-w-3xl mx-auto">
      {/* Header */}
      <div className="space-y-2 text-center">
        <Skeleton className="h-7 w-64 mx-auto" />
        <Skeleton className="h-4 w-48 mx-auto" />
        <Skeleton className="h-4 w-40 mx-auto" />
      </div>
      {/* Sections */}
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="space-y-2">
          <Skeleton className="h-5 w-36" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-[90%]" />
          <Skeleton className="h-4 w-[80%]" />
        </div>
      ))}
    </div>
  );
}

// ─── Dashboard stats ──────────────────────────────────────────────────

export function DashboardStatsSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="rounded-lg border bg-card p-4 space-y-2">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-8 w-12" />
          <Skeleton className="h-3 w-36" />
        </div>
      ))}
    </div>
  );
}

export function DashboardChecklistSkeleton() {
  return (
    <div className="rounded-lg border bg-card p-6 space-y-4">
      <Skeleton className="h-5 w-40" />
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="h-4 w-4 rounded" />
          <Skeleton className="h-4 w-56" />
        </div>
      ))}
    </div>
  );
}

// ─── Board list ───────────────────────────────────────────────────────

export function BoardRowSkeleton() {
  return (
    <div className="flex items-center gap-4 rounded-md border px-4 py-3">
      <div className="flex-1 space-y-1.5">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-3 w-32" />
      </div>
      <Skeleton className="h-5 w-16 rounded-full" />
      <Skeleton className="h-4 w-24" />
      <div className="flex gap-1">
        <Skeleton className="h-8 w-8 rounded-md" />
        <Skeleton className="h-8 w-8 rounded-md" />
      </div>
    </div>
  );
}

export function BoardListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <BoardRowSkeleton key={i} />
      ))}
    </div>
  );
}

// ─── Settings / form ─────────────────────────────────────────────────

export function SettingsSectionSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="rounded-lg border bg-card p-6 space-y-4">
      <Skeleton className="h-5 w-40" />
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center justify-between py-2 border-b last:border-0">
          <div className="space-y-1">
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-3 w-52" />
          </div>
          <Skeleton className="h-5 w-24" />
        </div>
      ))}
    </div>
  );
}
