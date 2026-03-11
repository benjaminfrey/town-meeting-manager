import type { MinutesContentJson } from "@town-meeting/shared/types";
import { computeWordDiff, type DiffSegment } from "@/lib/minutes/text-diff";

interface TrackedChangesProps {
  originalContentJson: MinutesContentJson;
  currentContentJson: MinutesContentJson;
  visible: boolean;
}

function DiffDisplay({ segments }: { segments: DiffSegment[] }) {
  return (
    <span>
      {segments.map((seg, i) => {
        if (seg.type === "added") {
          return (
            <span
              key={i}
              className="bg-green-100 text-green-900 px-0.5 rounded"
            >
              {seg.text}
            </span>
          );
        }
        if (seg.type === "removed") {
          return (
            <span
              key={i}
              className="bg-red-100 text-red-900 line-through px-0.5 rounded"
            >
              {seg.text}
            </span>
          );
        }
        return <span key={i}>{seg.text}</span>;
      })}
    </span>
  );
}

function hasDiffChanges(segments: DiffSegment[]): boolean {
  return segments.some((s) => s.type !== "same");
}

export function TrackedChanges({
  originalContentJson,
  currentContentJson,
  visible,
}: TrackedChangesProps) {
  if (!visible) return null;

  const sectionDiffs: Array<{
    sectionIndex: number;
    titleDiff: DiffSegment[] | null;
    items: Array<{
      itemIndex: number;
      titleDiff: DiffSegment[] | null;
      discussionDiff: DiffSegment[] | null;
    }>;
  }> = [];

  const originalSections = originalContentJson.sections;
  const currentSections = currentContentJson.sections;
  const maxSections = Math.max(originalSections.length, currentSections.length);

  let hasAnyChange = false;

  for (let si = 0; si < maxSections; si++) {
    const origSection = originalSections[si];
    const currSection = currentSections[si];

    if (!origSection && !currSection) continue;

    const origTitle = origSection?.title ?? "";
    const currTitle = currSection?.title ?? "";
    const titleDiffSegments = computeWordDiff(origTitle, currTitle);
    const titleChanged = hasDiffChanges(titleDiffSegments);

    const origItems = origSection?.items ?? [];
    const currItems = currSection?.items ?? [];
    const maxItems = Math.max(origItems.length, currItems.length);

    const itemDiffs: Array<{
      itemIndex: number;
      titleDiff: DiffSegment[] | null;
      discussionDiff: DiffSegment[] | null;
    }> = [];

    for (let ii = 0; ii < maxItems; ii++) {
      const origItem = origItems[ii];
      const currItem = currItems[ii];

      if (!origItem && !currItem) continue;

      const origItemTitle = origItem?.title ?? "";
      const currItemTitle = currItem?.title ?? "";
      const itemTitleDiff = computeWordDiff(origItemTitle, currItemTitle);
      const itemTitleChanged = hasDiffChanges(itemTitleDiff);

      const origDiscussion = origItem?.discussion_summary ?? "";
      const currDiscussion = currItem?.discussion_summary ?? "";
      let discussionDiff: DiffSegment[] | null = null;
      let discussionChanged = false;

      if (origDiscussion || currDiscussion) {
        discussionDiff = computeWordDiff(origDiscussion, currDiscussion);
        discussionChanged = hasDiffChanges(discussionDiff);
      }

      if (itemTitleChanged || discussionChanged) {
        hasAnyChange = true;
        itemDiffs.push({
          itemIndex: ii,
          titleDiff: itemTitleChanged ? itemTitleDiff : null,
          discussionDiff: discussionChanged ? discussionDiff : null,
        });
      }
    }

    if (titleChanged || itemDiffs.length > 0) {
      hasAnyChange = true;
      sectionDiffs.push({
        sectionIndex: si,
        titleDiff: titleChanged ? titleDiffSegments : null,
        items: itemDiffs,
      });
    }
  }

  if (!hasAnyChange) {
    return (
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-6 text-center text-sm text-gray-500">
        No changes from the original draft.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {sectionDiffs.map((sd) => {
        const currSection = currentContentJson.sections[sd.sectionIndex];
        const sectionTitle = currSection?.title ?? `Section ${sd.sectionIndex + 1}`;

        return (
          <div
            key={sd.sectionIndex}
            className="rounded-lg border border-gray-200 bg-white"
          >
            <div className="border-b border-gray-100 px-4 py-3">
              <h3 className="text-sm font-semibold text-gray-900">
                {sd.titleDiff ? (
                  <DiffDisplay segments={sd.titleDiff} />
                ) : (
                  sectionTitle
                )}
              </h3>
            </div>

            {sd.items.length > 0 && (
              <div className="divide-y divide-gray-50 px-4 py-2">
                {sd.items.map((item) => {
                  const currItem =
                    currentContentJson.sections[sd.sectionIndex]?.items[
                      item.itemIndex
                    ];
                  const itemTitle =
                    currItem?.title ?? `Item ${item.itemIndex + 1}`;

                  return (
                    <div key={item.itemIndex} className="py-3">
                      <p className="text-sm font-medium text-gray-700 mb-1">
                        {item.titleDiff ? (
                          <DiffDisplay segments={item.titleDiff} />
                        ) : (
                          itemTitle
                        )}
                      </p>
                      {item.discussionDiff && (
                        <p className="text-sm text-gray-600 leading-relaxed">
                          <DiffDisplay segments={item.discussionDiff} />
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
