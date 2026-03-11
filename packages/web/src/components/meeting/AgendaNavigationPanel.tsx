/**
 * Agenda navigation panel for the live meeting left sidebar.
 *
 * Shows the agenda structure (sections → items → sub-items) as a
 * scrollable tree. The current item is highlighted and auto-scrolled
 * into view. Clicking an item navigates to it.
 *
 * Supports collapsed mode: shows only status icons in a narrow strip.
 */

import { useEffect, useRef } from "react";
import {
  Circle,
  CircleDot,
  CheckCircle2,
  PauseCircle,
  ArrowRightCircle,
  Gavel,
  Lock,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface AgendaSection {
  id: string;
  title: string;
  sectionType: string;
  sortOrder: number;
  status: string;
  items: AgendaItem[];
}

interface AgendaItem {
  id: string;
  title: string;
  sortOrder: number;
  status: string;
  estimatedDuration: number | null;
  hasMotions: boolean;
  subItems: { id: string; title: string; sortOrder: number }[];
}

interface AgendaNavigationPanelProps {
  sections: AgendaSection[];
  currentItemId: string | null;
  onNavigate: (itemId: string) => void;
  readOnly?: boolean;
  collapsed: boolean;
  onToggleCollapse: () => void;
  /** ID of the item currently in executive session (shows Lock icon) */
  execSessionItemId?: string | null;
}

const STATUS_ICONS: Record<string, React.ReactNode> = {
  pending: <Circle className="h-3.5 w-3.5 text-muted-foreground" />,
  active: <CircleDot className="h-3.5 w-3.5 text-primary" />,
  completed: <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />,
  tabled: <PauseCircle className="h-3.5 w-3.5 text-amber-500" />,
  deferred: <ArrowRightCircle className="h-3.5 w-3.5 text-muted-foreground" />,
};

export function AgendaNavigationPanel({
  sections,
  currentItemId,
  onNavigate,
  readOnly,
  collapsed,
  onToggleCollapse,
  execSessionItemId,
}: AgendaNavigationPanelProps) {
  const currentRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (currentRef.current) {
      currentRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [currentItemId]);

  // ─── Collapsed view: narrow strip with status icons ─────────────
  if (collapsed) {
    return (
      <div className="flex h-full w-10 flex-col border-r bg-card">
        <div className="flex items-center justify-center border-b py-3">
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onToggleCollapse} title="Expand agenda">
            <PanelLeftOpen className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto py-1">
          {sections.map((section) =>
            section.items.map((item) => {
              const isCurrent = item.id === currentItemId;
              return (
                <button
                  key={item.id}
                  ref={isCurrent ? currentRef : undefined}
                  onClick={() => onNavigate(item.id)}
                  disabled={readOnly}
                  title={item.title}
                  className={cn(
                    "flex w-full items-center justify-center py-1.5 transition-colors",
                    isCurrent
                      ? "border-l-2 border-primary bg-primary/10"
                      : "hover:bg-muted",
                    readOnly && !isCurrent && "cursor-default",
                  )}
                >
                  {STATUS_ICONS[item.status] ?? STATUS_ICONS.pending}
                </button>
              );
            }),
          )}
        </div>
      </div>
    );
  }

  // ─── Expanded view ──────────────────────────────────────────────
  return (
    <div className="flex h-full w-64 flex-col border-r bg-card">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h2 className="text-sm font-semibold">Agenda</h2>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onToggleCollapse} title="Collapse agenda">
          <PanelLeftClose className="h-4 w-4" />
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {sections.map((section, sectionIdx) => (
          <div key={section.id} className="mb-1">
            {/* Section header */}
            <div className="px-3 py-1.5">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {sectionIdx + 1}. {section.title}
              </span>
            </div>

            {/* Items */}
            {section.items.map((item, itemIdx) => {
              const isCurrent = item.id === currentItemId;
              const letter = String.fromCharCode(65 + itemIdx);

              return (
                <div key={item.id}>
                  <button
                    ref={isCurrent ? currentRef : undefined}
                    onClick={() => onNavigate(item.id)}
                    disabled={readOnly}
                    className={cn(
                      "flex w-full items-center gap-2 px-4 py-1.5 text-left text-sm transition-colors",
                      isCurrent
                        ? "border-l-2 border-primary bg-primary/10 font-medium"
                        : "hover:bg-muted",
                      readOnly && !isCurrent && "cursor-default",
                    )}
                  >
                    {STATUS_ICONS[item.status] ?? STATUS_ICONS.pending}
                    <span className="min-w-0 flex-1 truncate">
                      {letter}. {item.title}
                    </span>
                    {execSessionItemId === item.id && (
                      <Lock className="h-3 w-3 flex-shrink-0 text-red-500" />
                    )}
                    {item.hasMotions && (
                      <Gavel className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
                    )}
                  </button>

                  {/* Sub-items */}
                  {item.subItems.map((sub, subIdx) => (
                    <div
                      key={sub.id}
                      className="flex items-center gap-2 py-1 pl-10 pr-4 text-xs text-muted-foreground"
                    >
                      <span>{toRoman(subIdx + 1)}.</span>
                      <span className="truncate">{sub.title}</span>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function toRoman(n: number): string {
  const numerals = ["i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x"];
  return numerals[n - 1] ?? String(n);
}
