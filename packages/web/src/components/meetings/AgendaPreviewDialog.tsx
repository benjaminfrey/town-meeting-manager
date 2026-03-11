/**
 * AgendaPreviewDialog — full-width print-friendly agenda preview.
 *
 * Section numbering: sections = 1, 2, 3...
 * Items = A, B, C...
 * Sub-items = i, ii, iii...
 */

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface AgendaPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  meetingTitle: string;
  boardName: string;
  townName: string;
  scheduledDate: string;
  scheduledTime: string;
  location: string;
  sections: (Record<string, unknown> & {
    children: Record<string, unknown>[];
  })[];
  allExhibits: Record<string, unknown>[];
}

const ROMAN = ["i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x"];

export function AgendaPreviewDialog({
  open,
  onOpenChange,
  meetingTitle,
  boardName,
  townName,
  scheduledDate,
  scheduledTime,
  location,
  sections,
  allExhibits,
}: AgendaPreviewDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="sr-only">Agenda Preview</DialogTitle>
        </DialogHeader>

        {/* Print-friendly header */}
        <div className="text-center space-y-1 border-b pb-4">
          <p className="text-sm text-muted-foreground uppercase tracking-wider">
            {townName}
          </p>
          <h2 className="text-xl font-bold">{boardName}</h2>
          <h3 className="text-lg font-semibold">{meetingTitle}</h3>
          <p className="text-sm text-muted-foreground">
            {scheduledDate}
            {scheduledTime ? ` at ${scheduledTime}` : ""}
          </p>
          {location && (
            <p className="text-sm text-muted-foreground">{location}</p>
          )}
        </div>

        {/* Agenda content */}
        <div className="space-y-6 py-4">
          {sections.map((section, sectionIdx) => {
            const sectionNum = sectionIdx + 1;
            const sectionTitle = String(section.title ?? "");

            return (
              <div key={String(section.id)}>
                <h4 className="font-bold text-sm uppercase tracking-wide border-b pb-1 mb-2">
                  {sectionNum}. {sectionTitle}
                </h4>

                {section.children.length === 0 && (
                  <p className="text-sm text-muted-foreground italic ml-6">
                    No items
                  </p>
                )}

                {section.children.map((item, itemIdx) => {
                  const letter = String.fromCharCode(65 + itemIdx);
                  const label = `${sectionNum}${letter}`;
                  const itemTitle = String(item.title ?? "");
                  const presenter = (item.presenter as string) || null;
                  const duration = item.estimated_duration
                    ? Number(item.estimated_duration)
                    : null;
                  const description = (item.description as string) || null;
                  const background = (item.background as string) || null;
                  const recommendation = (item.recommendation as string) || null;
                  const suggestedMotion = (item.suggested_motion as string) || null;
                  const itemExhibits = allExhibits.filter(
                    (e) => e.agenda_item_id === item.id,
                  );

                  return (
                    <div key={String(item.id)} className="ml-6 mb-3">
                      <div className="flex items-baseline gap-2">
                        <span className="font-mono text-xs text-muted-foreground w-8 shrink-0">
                          {label}.
                        </span>
                        <div className="flex-1">
                          <span className="text-sm font-medium">{itemTitle}</span>
                          {presenter && (
                            <span className="text-xs text-muted-foreground ml-2">
                              ({presenter})
                            </span>
                          )}
                          {duration != null && duration > 0 && (
                            <span className="text-xs text-muted-foreground ml-2">
                              [{duration} min]
                            </span>
                          )}
                        </div>
                      </div>

                      {description && (
                        <p className="text-sm text-muted-foreground ml-8 mt-1">
                          {description}
                        </p>
                      )}

                      {background && (
                        <div className="ml-8 mt-1 text-sm">
                          <span className="font-medium">Background: </span>
                          {background}
                        </div>
                      )}

                      {recommendation && (
                        <div className="ml-8 mt-1 text-sm">
                          <span className="font-medium">Recommendation: </span>
                          {recommendation}
                        </div>
                      )}

                      {suggestedMotion && (
                        <div className="ml-8 mt-1 text-sm">
                          <span className="font-medium">Suggested Motion: </span>
                          <span className="italic">{suggestedMotion}</span>
                        </div>
                      )}

                      {itemExhibits.length > 0 && (
                        <div className="ml-8 mt-1 text-xs text-muted-foreground">
                          Exhibits:{" "}
                          {itemExhibits.map((e, i) => (
                            <span key={String(e.id)}>
                              {i > 0 ? ", " : ""}
                              {String(e.title ?? `Exhibit ${i + 1}`)}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
