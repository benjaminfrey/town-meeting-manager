/**
 * MinutesWorkflowEditor — board-level minutes approval workflow settings.
 *
 * Shows board-specific settings (consent agenda, second required, R4 default)
 * and optional overrides for town-level defaults (audio retention, auto-publish).
 *
 * @see docs/advisory-resolutions/3.5-minutes-approval-workflow-config.md §6.2
 */

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Save, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { queryKeys } from "@/lib/queryKeys";
import {
  AUDIO_RETENTION_LABELS,
  type AudioRetentionPolicy,
} from "@town-meeting/shared";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

// ─── Types ──────────────────────────────────────────────────────────

interface MinutesWorkflowEditorProps {
  boardId: string;
  initialValues: {
    minutes_consent_agenda: boolean;
    minutes_requires_second: boolean;
    r4_board_member_default: boolean;
    audio_retention_policy_override: string | null;
    auto_publish_on_approval_override: boolean | null;
  };
  townDefaults: {
    audio_retention_policy: string;
    auto_publish_on_approval: boolean;
  };
}

const RETENTION_OPTIONS: { value: string; label: string }[] = [
  { value: "purge_on_approval", label: "Delete after approval" },
  { value: "retain_30_days", label: "Retain 30 days" },
  { value: "retain_90_days", label: "Retain 90 days" },
  { value: "retain_indefinitely", label: "Retain indefinitely" },
];

// ─── Component ──────────────────────────────────────────────────────

export function MinutesWorkflowEditor({
  boardId,
  initialValues,
  townDefaults,
}: MinutesWorkflowEditorProps) {
  const queryClient = useQueryClient();

  // Board-only settings
  const [consentAgenda, setConsentAgenda] = useState(
    initialValues.minutes_consent_agenda
  );
  const [requiresSecond, setRequiresSecond] = useState(
    initialValues.minutes_requires_second
  );
  const [r4Default, setR4Default] = useState(
    initialValues.r4_board_member_default
  );

  // Override settings
  const [overrideRetention, setOverrideRetention] = useState(
    initialValues.audio_retention_policy_override !== null
  );
  const [retentionValue, setRetentionValue] = useState(
    initialValues.audio_retention_policy_override ?? townDefaults.audio_retention_policy
  );

  const [overrideAutoPublish, setOverrideAutoPublish] = useState(
    initialValues.auto_publish_on_approval_override !== null
  );
  const [autoPublishValue, setAutoPublishValue] = useState(
    initialValues.auto_publish_on_approval_override ?? townDefaults.auto_publish_on_approval
  );

  const [dirty, setDirty] = useState(false);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("board")
        .update({
          minutes_consent_agenda: consentAgenda,
          minutes_requires_second: requiresSecond,
          r4_board_member_default: r4Default,
          audio_retention_policy_override: overrideRetention
            ? retentionValue
            : null,
          auto_publish_on_approval_override: overrideAutoPublish
            ? autoPublishValue
            : null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", boardId);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.boards.detail(boardId),
      });
      setDirty(false);
    },
  });

  const markDirty = () => setDirty(true);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Minutes Workflow</CardTitle>
        <CardDescription>
          Board-level minutes approval settings. Overrides apply only to this
          board.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* ─── Board-Specific Settings ─────────────────────────── */}
        <div className="space-y-4">
          <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Approval Rules
          </h4>

          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm font-medium">
                Allow consent agenda approval
              </Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Minutes can be approved as part of the consent agenda without a
                separate motion
              </p>
            </div>
            <Switch
              checked={consentAgenda}
              onCheckedChange={(v) => {
                setConsentAgenda(v);
                markDirty();
              }}
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm font-medium">
                Require second for approval motion
              </Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                A motion to approve minutes must be seconded before voting
              </p>
            </div>
            <Switch
              checked={requiresSecond}
              onCheckedChange={(v) => {
                setRequiresSecond(v);
                markDirty();
              }}
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm font-medium">
                Board members can view drafts
              </Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                New board members get the R4 (View Draft Minutes) permission by
                default
              </p>
            </div>
            <Switch
              checked={r4Default}
              onCheckedChange={(v) => {
                setR4Default(v);
                markDirty();
              }}
            />
          </div>
        </div>

        {/* ─── Town Override Settings ──────────────────────────── */}
        <div className="space-y-4 border-t pt-4">
          <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Town Default Overrides
          </h4>

          {/* Audio retention override */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-sm font-medium">
                  Audio retention policy
                </Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Town default:{" "}
                  {AUDIO_RETENTION_LABELS[townDefaults.audio_retention_policy as AudioRetentionPolicy] ??
                    townDefaults.audio_retention_policy}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  {overrideRetention ? "Override" : "Inherit"}
                </span>
                <Switch
                  checked={overrideRetention}
                  onCheckedChange={(v) => {
                    setOverrideRetention(v);
                    if (!v) {
                      setRetentionValue(townDefaults.audio_retention_policy);
                    }
                    markDirty();
                  }}
                />
              </div>
            </div>
            {overrideRetention && (
              <select
                value={retentionValue}
                onChange={(e) => {
                  setRetentionValue(e.target.value);
                  markDirty();
                }}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                {RETENTION_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Auto-publish override */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-sm font-medium">
                  Auto-publish on approval
                </Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Town default:{" "}
                  {townDefaults.auto_publish_on_approval ? "Enabled" : "Disabled"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  {overrideAutoPublish ? "Override" : "Inherit"}
                </span>
                <Switch
                  checked={overrideAutoPublish}
                  onCheckedChange={(v) => {
                    setOverrideAutoPublish(v);
                    if (!v) {
                      setAutoPublishValue(townDefaults.auto_publish_on_approval);
                    }
                    markDirty();
                  }}
                />
              </div>
            </div>
            {overrideAutoPublish && (
              <div className="flex items-center justify-between rounded-md border px-3 py-2">
                <span className="text-sm">
                  Publish minutes automatically when approved
                </span>
                <Switch
                  checked={!!autoPublishValue}
                  onCheckedChange={(v) => {
                    setAutoPublishValue(v);
                    markDirty();
                  }}
                />
              </div>
            )}
          </div>
        </div>

        {/* ─── Save ──────────────────────────────────────────── */}
        <div className="flex items-center gap-3 border-t pt-4">
          <Button
            size="sm"
            onClick={() => saveMutation.mutate()}
            disabled={!dirty || saveMutation.isPending}
          >
            {saveMutation.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-2 h-4 w-4" />
            )}
            Save
          </Button>
          {saveMutation.isSuccess && (
            <span className="text-sm text-green-600">Saved</span>
          )}
          {saveMutation.isError && (
            <span className="text-sm text-red-600">Error saving</span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
