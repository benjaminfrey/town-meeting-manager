/**
 * Notification Preferences Page — /settings/notifications
 *
 * Allows users to manage which email notifications they receive.
 * Preferences are stored in subscriber_notification_preference table.
 * Default (no row) = enabled.
 */

import { useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { Route } from "./+types/settings.notifications";
import { RouteErrorBoundary } from "@/components/RouteErrorBoundary";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useSupabase } from "@/hooks/useSupabase";
import { queryKeys } from "@/lib/queryKeys";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

// ─── Route loader ─────────────────────────────────────────────────

export async function clientLoader() {
  return {};
}

// ─── Notification categories ──────────────────────────────────────

interface NotificationSetting {
  eventType: string;
  label: string;
  description: string;
  category: string;
}

const NOTIFICATION_SETTINGS: NotificationSetting[] = [
  // Meeting notices
  {
    eventType: "meeting_scheduled",
    label: "Meeting scheduled",
    description: "When a new meeting is added to your board's calendar",
    category: "Meetings",
  },
  {
    eventType: "meeting_cancelled",
    label: "Meeting cancelled",
    description: "When a scheduled meeting is cancelled",
    category: "Meetings",
  },
  // Agenda
  {
    eventType: "agenda_published",
    label: "Agenda published",
    description: "When the agenda for an upcoming meeting is finalized and posted",
    category: "Meetings",
  },
  // Minutes
  {
    eventType: "minutes_review",
    label: "Minutes ready for review",
    description: "When draft minutes are submitted to the board for approval",
    category: "Minutes",
  },
  {
    eventType: "minutes_approved",
    label: "Minutes approved",
    description: "When minutes are officially approved by the board",
    category: "Minutes",
  },
  {
    eventType: "minutes_published",
    label: "Minutes published",
    description: "When approved minutes are published to the public portal",
    category: "Minutes",
  },
  // Admin
  {
    eventType: "admin_alert",
    label: "Admin alerts",
    description: "Important system notifications requiring administrator attention",
    category: "Administration",
  },
];

// ─── Component ────────────────────────────────────────────────────

export default function NotificationPreferencesPage() {
  const currentUser = useCurrentUser();
  const supabase = useSupabase();
  const queryClient = useQueryClient();

  // Fetch existing preferences
  const { data: prefs = [] } = useQuery({
    queryKey: queryKeys.notificationPreferences.mine,
    queryFn: async () => {
      if (!currentUser?.id) return [];
      const { data, error } = await supabase
        .from("subscriber_notification_preference")
        .select("event_type, channel, enabled")
        .eq("subscriber_id", currentUser.id);
      if (error) throw error;
      return data as Array<{ event_type: string; channel: string; enabled: boolean }>;
    },
    enabled: !!currentUser?.id,
  });

  // Build a lookup map: eventType → enabled
  const prefMap = new Map<string, boolean>();
  for (const pref of prefs) {
    if (pref.channel === "email") {
      prefMap.set(pref.event_type, pref.enabled);
    }
  }

  // Default is enabled (opt-out model)
  const isEnabled = (eventType: string) => prefMap.get(eventType) ?? true;

  // Mutation: toggle a preference
  const toggleMutation = useMutation({
    mutationFn: async ({ eventType, enabled }: { eventType: string; enabled: boolean }) => {
      if (!currentUser?.id) throw new Error("Not authenticated");
      const { error } = await supabase
        .from("subscriber_notification_preference")
        .upsert(
          {
            subscriber_id: currentUser.id,
            event_type: eventType,
            channel: "email",
            enabled,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "subscriber_id,event_type,channel" },
        );
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.notificationPreferences.mine });
    },
    onError: () => {
      toast.error("Failed to update notification preference");
    },
  });

  const handleToggle = useCallback(
    (eventType: string, enabled: boolean) => {
      toggleMutation.mutate({ eventType, enabled });
    },
    [toggleMutation],
  );

  // Group settings by category
  const categories = [...new Set(NOTIFICATION_SETTINGS.map((s) => s.category))];

  return (
    <div className="p-6 max-w-2xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Notification Preferences</h1>
        <p className="mt-1 text-muted-foreground">
          Choose which emails you'd like to receive. You can unsubscribe at any time.
        </p>
      </div>

      <div className="space-y-6">
        {categories.map((category, catIdx) => {
          const items = NOTIFICATION_SETTINGS.filter((s) => s.category === category);
          return (
            <Card key={category}>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">{category}</CardTitle>
                <CardDescription className="text-sm">
                  Email notifications for {category.toLowerCase()} events
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-0">
                {items.map((setting, idx) => (
                  <div key={setting.eventType}>
                    {idx > 0 && <hr className="my-3 border-border" />}
                    <div className="flex items-start justify-between gap-4 py-1">
                      <div className="space-y-0.5">
                        <Label
                          htmlFor={`pref-${setting.eventType}`}
                          className="text-sm font-medium leading-none cursor-pointer"
                        >
                          {setting.label}
                        </Label>
                        <p className="text-xs text-muted-foreground">
                          {setting.description}
                        </p>
                      </div>
                      <Switch
                        id={`pref-${setting.eventType}`}
                        checked={isEnabled(setting.eventType)}
                        onCheckedChange={(checked) =>
                          handleToggle(setting.eventType, checked)
                        }
                        disabled={toggleMutation.isPending}
                        aria-label={`Toggle ${setting.label} notifications`}
                      />
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          );
        })}

        {/* Info footer */}
        <p className="text-xs text-muted-foreground">
          Account setup and password reset emails are always sent regardless of these settings.
          For broadcast emails, you can also use the unsubscribe link at the bottom of any email.
        </p>
      </div>
    </div>
  );
}

export { RouteErrorBoundary as ErrorBoundary };
