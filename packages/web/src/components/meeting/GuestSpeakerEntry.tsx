/**
 * Inline guest speaker entry for public comment sections.
 *
 * Per advisory 1.2: guest speaker entries are part of the meeting
 * record only — not linked to any PERSON record, no account creation.
 */

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useSupabase } from "@/hooks/useSupabase";
import { queryKeys } from "@/lib/queryKeys";
import { Trash2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface GuestSpeaker {
  id: string;
  name: string;
  address: string | null;
  topic: string | null;
  created_at: string;
}

interface GuestSpeakerEntryProps {
  meetingId: string;
  agendaItemId: string;
  townId: string;
  speakers: GuestSpeaker[];
  readOnly?: boolean;
}

export function GuestSpeakerEntry({
  meetingId,
  agendaItemId,
  townId,
  speakers,
  readOnly,
}: GuestSpeakerEntryProps) {
  const supabase = useSupabase();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [topic, setTopic] = useState("");

  const addSpeakerMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("guest_speaker").insert({
        id: crypto.randomUUID(),
        meeting_id: meetingId,
        agenda_item_id: agendaItemId,
        town_id: townId,
        name: name.trim(),
        address: address.trim() || null,
        topic: topic.trim() || null,
        created_at: new Date().toISOString(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.guestSpeakers.byItem(agendaItemId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.guestSpeakers.byMeeting(meetingId) });
      setName("");
      setAddress("");
      setTopic("");
      setShowForm(false);
    },
  });

  const removeSpeakerMutation = useMutation({
    mutationFn: async (speakerId: string) => {
      const { error } = await supabase
        .from("guest_speaker")
        .delete()
        .eq("id", speakerId);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.guestSpeakers.byItem(agendaItemId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.guestSpeakers.byMeeting(meetingId) });
    },
  });

  const handleAdd = () => {
    if (!name.trim()) return;
    addSpeakerMutation.mutate();
  };

  const handleRemove = (speakerId: string) => {
    removeSpeakerMutation.mutate(speakerId);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium text-muted-foreground">
          Public Speakers ({speakers.length})
        </h4>
        {!readOnly && !showForm && (
          <Button variant="ghost" size="sm" onClick={() => setShowForm(true)}>
            <UserPlus className="mr-1 h-3.5 w-3.5" />
            Add Speaker
          </Button>
        )}
      </div>

      {/* Speaker list */}
      {speakers.length > 0 && (
        <ul className="space-y-1">
          {speakers.map((s) => (
            <li key={s.id} className="flex items-center justify-between rounded-md bg-muted/50 px-3 py-1.5 text-sm">
              <div>
                <span className="font-medium">{s.name}</span>
                {s.address && (
                  <span className="ml-2 text-muted-foreground">— {s.address}</span>
                )}
                {s.topic && (
                  <span className="ml-2 text-xs text-muted-foreground">({s.topic})</span>
                )}
              </div>
              {!readOnly && (
                <button
                  onClick={() => handleRemove(s.id)}
                  className="ml-2 text-muted-foreground hover:text-destructive"
                  title="Remove speaker"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Inline add form */}
      {showForm && (
        <div className="rounded-md border bg-muted/30 p-3 space-y-2">
          <Input
            placeholder="Name (required)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
          <div className="flex gap-2">
            <Input
              placeholder="Address (optional)"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
            <Input
              placeholder="Topic (optional)"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
            />
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => handleAdd()} disabled={!name.trim() || addSpeakerMutation.isPending}>
              Add
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowForm(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
