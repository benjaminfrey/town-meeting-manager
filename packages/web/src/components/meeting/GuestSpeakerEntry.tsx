/**
 * Inline guest speaker entry for public comment sections.
 *
 * Per advisory 1.2: guest speaker entries are part of the meeting
 * record only — not linked to any PERSON record, no account creation.
 */

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import { trpc, refusalMessage } from "@/lib/trpc";
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
  /**
   * The board this meeting belongs to — `guestSpeaker.insert`/`delete` are
   * guarded by `requireBoardPermission("M7", boardIdFrom())`, which runs before
   * `.input()`. Conventions item 2's already-named cost; the resolver
   * re-derives the row's real board and refuses a mismatch.
   */
  boardId: string;
  speakers: GuestSpeaker[];
  readOnly?: boolean;
}

export function GuestSpeakerEntry({
  meetingId,
  agendaItemId,
  boardId,
  speakers,
  readOnly,
}: GuestSpeakerEntryProps) {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [topic, setTopic] = useState("");

  /**
   * Wave 5, Task 5 — `guestSpeaker.insert`/`delete` in place of the two raw
   * writes. Both were unauthorized before (`guest_speaker_tenant_isolation` is
   * tenancy-only and M7 had no rule in this codebase at all until this wave's
   * Task 2), so FORBIDDEN is newly reachable on each.
   *
   * The trim-then-null of `address` and `topic` moved into the procedure's own
   * schema, which does it identically; the values are sent raw. `town_id`,
   * `id` and `created_at` are no longer sent — and `created_at` matters here
   * beyond tidiness, because it IS the speaker queue's order, so two devices
   * with skewed clocks used to interleave the list.
   *
   * Neither control sits behind a confirmation dialog, so each refusal renders
   * inline beside the form it belongs to, with `role="alert"` — the two are
   * separate messages because the two writes are separate acts and a clerk
   * refused on a delete should not read "couldn't add a speaker".
   */
  const addSpeakerMutation = useMutation(
    trpc.guestSpeaker.insert.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.guestSpeakers.byItem(agendaItemId),
        });
        void queryClient.invalidateQueries({
          queryKey: queryKeys.guestSpeakers.byMeeting(meetingId),
        });
        // The live screen reads speakers through `trpc.guestSpeaker.byMeeting`
        // as of wave 5, Task 4; the two legacy keys above no longer reach it.
        void queryClient.invalidateQueries(trpc.guestSpeaker.pathFilter());
        setName("");
        setAddress("");
        setTopic("");
        setShowForm(false);
      },
    }),
  );

  const removeSpeakerMutation = useMutation(
    trpc.guestSpeaker.delete.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.guestSpeakers.byItem(agendaItemId),
        });
        void queryClient.invalidateQueries({
          queryKey: queryKeys.guestSpeakers.byMeeting(meetingId),
        });
        // Same as the insert above — its own call site, so deleting either one
        // is caught (conventions item 8's per-file credit bleed).
        void queryClient.invalidateQueries(trpc.guestSpeaker.pathFilter());
      },
    }),
  );

  const handleAdd = () => {
    if (!name.trim()) return;
    addSpeakerMutation.reset();
    addSpeakerMutation.mutate({
      boardId,
      meetingId,
      agendaItemId,
      name: name.trim(),
      address: address || null,
      topic: topic || null,
    });
  };

  const handleRemove = (speakerId: string) => {
    removeSpeakerMutation.reset();
    removeSpeakerMutation.mutate({ boardId, speakerId });
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

      {removeSpeakerMutation.error && (
        <p className="text-xs text-destructive" role="alert">
          {refusalMessage(removeSpeakerMutation.error, "remove a speaker from the queue")}
        </p>
      )}

      {/* Speaker list */}
      {speakers.length > 0 && (
        <ul className="space-y-1">
          {speakers.map((s) => (
            <li
              key={s.id}
              className="flex items-center justify-between rounded-md bg-muted/50 px-3 py-1.5 text-sm"
            >
              <div>
                <span className="font-medium">{s.name}</span>
                {s.address && <span className="ml-2 text-muted-foreground">— {s.address}</span>}
                {s.topic && <span className="ml-2 text-xs text-muted-foreground">({s.topic})</span>}
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
          {addSpeakerMutation.error && (
            <p className="text-xs text-destructive" role="alert">
              {refusalMessage(addSpeakerMutation.error, "add a speaker to the queue")}
            </p>
          )}
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => handleAdd()}
              disabled={!name.trim() || addSpeakerMutation.isPending}
            >
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
