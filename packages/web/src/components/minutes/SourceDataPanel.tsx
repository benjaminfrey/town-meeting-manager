import { useQuery } from "@tanstack/react-query";
import { useSupabase } from "@/hooks/useSupabase";
import { queryKeys } from "@/lib/queryKeys";
import { Badge } from "@/components/ui/badge";
import { Clock } from "lucide-react";
import type {
  MinutesContentJson,
  MinutesContentSection,
} from "@town-meeting/shared/types";

interface SourceDataPanelProps {
  meetingId: string;
  selectedSectionIndex: number;
  contentJson: MinutesContentJson;
}

function formatTime(timestamp: string | null): string {
  if (!timestamp) return "--";
  try {
    return new Date(timestamp).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return timestamp;
  }
}

export function SourceDataPanel({
  meetingId,
  selectedSectionIndex,
  contentJson,
}: SourceDataPanelProps) {
  const supabase = useSupabase();

  const { data: agendaItems = [] } = useQuery({
    queryKey: queryKeys.agendaItems.byMeeting(meetingId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('agenda_item')
        .select('*')
        .eq('meeting_id', meetingId)
        .order('sort_order');
      if (error) throw error;
      return data as Record<string, unknown>[];
    },
    enabled: !!meetingId,
  });

  const { data: motions = [] } = useQuery({
    queryKey: queryKeys.motions.byMeeting(meetingId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('motion')
        .select('*')
        .eq('meeting_id', meetingId);
      if (error) throw error;
      return data as Record<string, unknown>[];
    },
    enabled: !!meetingId,
  });

  const { data: voteRecords = [] } = useQuery({
    queryKey: queryKeys.voteRecords.byMeeting(meetingId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vote_record')
        .select('*')
        .eq('meeting_id', meetingId);
      if (error) throw error;
      return data as Record<string, unknown>[];
    },
    enabled: !!meetingId,
  });

  const { data: transitions = [] } = useQuery({
    queryKey: queryKeys.agendaItemTransitions.byMeeting(meetingId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('agenda_item_transition')
        .select('*')
        .eq('meeting_id', meetingId);
      if (error) throw error;
      return data as Record<string, unknown>[];
    },
    enabled: !!meetingId,
  });

  const { data: guestSpeakers = [] } = useQuery({
    queryKey: queryKeys.guestSpeakers.byMeeting(meetingId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('guest_speaker')
        .select('*')
        .eq('meeting_id', meetingId);
      if (error) throw error;
      return data as Record<string, unknown>[];
    },
    enabled: !!meetingId,
  });

  const section: MinutesContentSection | undefined =
    contentJson.sections[selectedSectionIndex];

  if (!section) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-muted-foreground">
        Select a section to view source data
      </div>
    );
  }

  // Find agenda items that match this section by section_type and sort_order
  const sectionAgendaItems = agendaItems.filter(
    (ai: Record<string, unknown>) =>
      (ai.section_type as string) === section.section_type,
  );

  // Get motions for these agenda items
  const agendaItemIds = new Set(
    sectionAgendaItems.map((ai: Record<string, unknown>) => ai.id as string),
  );
  const sectionMotions = motions.filter((m: Record<string, unknown>) =>
    agendaItemIds.has(m.agenda_item_id as string),
  );

  // Get vote records for these motions
  const motionIds = new Set(
    sectionMotions.map((m: Record<string, unknown>) => m.id as string),
  );
  const sectionVoteRecords = voteRecords.filter(
    (vr: Record<string, unknown>) => motionIds.has(vr.motion_id as string),
  );

  // Get transitions for these agenda items
  const sectionTransitions = transitions.filter(
    (t: Record<string, unknown>) =>
      agendaItemIds.has(t.agenda_item_id as string),
  );

  // Get guest speakers for these agenda items
  const sectionSpeakers = guestSpeakers.filter(
    (gs: Record<string, unknown>) =>
      agendaItemIds.has(gs.agenda_item_id as string),
  );

  return (
    <div className="h-full overflow-y-auto p-4">
      <h3 className="mb-3 text-sm font-semibold text-muted-foreground uppercase tracking-wide">
        Source Data
      </h3>
      <p className="mb-4 text-xs text-muted-foreground">
        Section: {section.title}
      </p>

      {/* Timestamps / Transitions */}
      {sectionTransitions.length > 0 && (
        <div className="mb-4">
          <h4 className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Clock className="h-3.5 w-3.5" />
            Timestamps
          </h4>
          <div className="space-y-1.5">
            {sectionTransitions.map(
              (t: Record<string, unknown>, idx: number) => (
                <div
                  key={idx}
                  className="rounded border border-border bg-muted/50 px-3 py-2 text-xs text-muted-foreground"
                >
                  <span className="font-medium">
                    {(t.transition_type as string) ?? "Transition"}
                  </span>
                  <span className="ml-2">
                    {formatTime(t.started_at as string | null)} &rarr;{" "}
                    {formatTime(t.ended_at as string | null)}
                  </span>
                </div>
              ),
            )}
          </div>
        </div>
      )}

      {/* Motions */}
      {sectionMotions.length > 0 && (
        <div className="mb-4">
          <h4 className="mb-2 text-xs font-medium text-muted-foreground">
            Motions
          </h4>
          <div className="space-y-3">
            {sectionMotions.map((m: Record<string, unknown>, idx: number) => {
              const hasVoteData: boolean = m.yeas != null || m.nays != null;
              const motionVotes = sectionVoteRecords.filter(
                (vr: Record<string, unknown>) =>
                  (vr.motion_id as string) === (m.id as string),
              );
              return (
                <div
                  key={idx}
                  className="rounded border border-border bg-muted/50 px-3 py-2"
                >
                  <p className="mb-1 text-xs text-muted-foreground">
                    {m.motion_text as string}
                  </p>
                  <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    {Boolean(m.moved_by_name) && (
                      <span>Moved: {m.moved_by_name as string}</span>
                    )}
                    {Boolean(m.seconded_by_name) && (
                      <span>| Seconded: {m.seconded_by_name as string}</span>
                    )}
                  </div>
                  {/* Vote summary */}
                  {hasVoteData ? (
                    <div className="mt-1.5 flex items-center gap-2">
                      <Badge
                        variant="outline"
                        className="text-xs text-muted-foreground"
                      >
                        Yeas: {(m.yeas as number) ?? 0}
                      </Badge>
                      <Badge
                        variant="outline"
                        className="text-xs text-muted-foreground"
                      >
                        Nays: {(m.nays as number) ?? 0}
                      </Badge>
                      <Badge
                        variant="outline"
                        className="text-xs text-muted-foreground"
                      >
                        Abstentions: {(m.abstentions as number) ?? 0}
                      </Badge>
                    </div>
                  ) : null}
                  {Boolean(m.status) && (
                    <Badge
                      variant="secondary"
                      className="mt-1.5 text-xs text-muted-foreground"
                    >
                      {m.status as string}
                    </Badge>
                  )}
                  {/* Individual votes */}
                  {motionVotes.length > 0 && (
                    <div className="mt-2 border-t border-border pt-1.5">
                      <p className="mb-1 text-[10px] font-medium text-muted-foreground uppercase">
                        Individual Votes
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {motionVotes.map(
                          (
                            vr: Record<string, unknown>,
                            vIdx: number,
                          ) => (
                            <Badge
                              key={vIdx}
                              variant="outline"
                              className="text-[10px] text-muted-foreground"
                            >
                              {vr.member_name as string}:{" "}
                              {vr.vote as string}
                            </Badge>
                          ),
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Guest Speakers */}
      {sectionSpeakers.length > 0 && (
        <div className="mb-4">
          <h4 className="mb-2 text-xs font-medium text-muted-foreground">
            Guest Speakers
          </h4>
          <div className="space-y-1.5">
            {sectionSpeakers.map(
              (gs: Record<string, unknown>, idx: number) => (
                <div
                  key={idx}
                  className="rounded border border-border bg-muted/50 px-3 py-2 text-xs text-muted-foreground"
                >
                  <span className="font-medium">{gs.name as string}</span>
                  {Boolean(gs.topic) && (
                    <span className="ml-2">- {gs.topic as string}</span>
                  )}
                </div>
              ),
            )}
          </div>
        </div>
      )}

      {/* Operator Notes from Agenda Items */}
      {sectionAgendaItems.some(
        (ai: Record<string, unknown>) => ai.operator_notes,
      ) && (
        <div className="mb-4">
          <h4 className="mb-2 text-xs font-medium text-muted-foreground">
            Operator Notes
          </h4>
          <div className="space-y-1.5">
            {sectionAgendaItems
              .filter((ai: Record<string, unknown>) => ai.operator_notes)
              .map((ai: Record<string, unknown>, idx: number) => (
                <div
                  key={idx}
                  className="rounded border border-border bg-muted/50 px-3 py-2 text-xs italic text-muted-foreground"
                >
                  {ai.operator_notes as string}
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Empty state for section */}
      {sectionMotions.length === 0 &&
        sectionTransitions.length === 0 &&
        sectionSpeakers.length === 0 &&
        !sectionAgendaItems.some(
          (ai: Record<string, unknown>) => ai.operator_notes,
        ) && (
          <p className="text-xs text-muted-foreground italic">
            No source data found for this section.
          </p>
        )}
    </div>
  );
}
