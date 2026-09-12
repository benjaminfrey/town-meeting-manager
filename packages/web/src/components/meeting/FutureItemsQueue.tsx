/**
 * Future Items Queue — displays items queued for the next meeting.
 *
 * Per advisory Q3, this implements a persistent per-board queue where:
 * - Tabled items are added with source "tabled"
 * - Deferred (not reached) items are added with source "deferred"
 * - Future agenda items are added with source "future_queue"
 *
 * Items persist until placed on a future agenda or dismissed.
 * This component is read-only in the PostMeetingReview context.
 */

import { Clock, Pause, ArrowRight, ListTodo } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { RouterOutputs } from "@/lib/trpc";

/**
 * The procedure's own row, not a hand-written interface that happens to
 * match — conventions item 10. `routes/meetings.$meetingId.review.tsx` is
 * the only caller and now passes `trpc.futureItem.byMeeting`'s rows
 * straight through, so a column dropped from that procedure is a compile
 * error here rather than an `undefined` badge.
 *
 * `source` is "tabled" | "deferred" | "future_queue" and `status` is
 * "pending" | "placed" | "dismissed" — both plain `text` columns with no
 * database constraint (see `future_item_queue` in `0000_baseline.sql`),
 * which is why the procedure declares them `string` and `SOURCE_CONFIG`
 * below carries a fallback.
 */
type FutureQueueItem = RouterOutputs["futureItem"]["byMeeting"][number];

interface FutureItemsQueueProps {
  items: readonly FutureQueueItem[];
}

const SOURCE_CONFIG: Record<
  string,
  { label: string; icon: React.ReactNode; variant: "default" | "secondary" | "outline" }
> = {
  tabled: {
    label: "Tabled",
    icon: <Pause className="h-3 w-3" />,
    variant: "secondary",
  },
  deferred: {
    label: "Deferred",
    icon: <Clock className="h-3 w-3" />,
    variant: "outline",
  },
  future_queue: {
    label: "Future Item",
    icon: <ArrowRight className="h-3 w-3" />,
    variant: "default",
  },
};

export function FutureItemsQueue({ items }: FutureItemsQueueProps) {
  const pendingItems = items.filter((i) => i.status === "pending");

  if (pendingItems.length === 0) {
    return (
      <div className="rounded-md border border-dashed px-4 py-6 text-center">
        <ListTodo className="mx-auto mb-2 h-6 w-6 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">No items queued for the next meeting.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {pendingItems.map((item) => {
        const config = (SOURCE_CONFIG[item.source] ?? SOURCE_CONFIG.future_queue)!;
        return (
          <div key={item.id} className="flex items-start gap-3 rounded-md border px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{item.title}</span>
                <Badge variant={config.variant} className="gap-1 text-xs">
                  {config.icon}
                  {config.label}
                </Badge>
              </div>
              {item.description && (
                <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
                  {item.description}
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
