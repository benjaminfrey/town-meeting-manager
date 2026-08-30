/**
 * Notification Preferences Page — /settings/notifications
 *
 * Allows users to manage which email notifications they receive.
 * Preferences are stored in `subscriber_notification_preference`, a
 * PERSON's own preferences — not `town_notification_config` (the town's
 * SMTP/Twilio credentials, a different table with its own admin-only router,
 * `townNotificationConfig`). See `notification-preference.ts`'s own doc
 * comment for why that distinction matters and how this task's brief
 * conflated the two.
 * Default (no row) = enabled.
 *
 * Stage 1, Phase E, wave 1, Task 4 — moved onto `notificationPreference.mine`
 * / `.setMine` from a direct Supabase read/write. Neither procedure carries
 * an `assertCan*` guard: both are scoped to the caller's own person by
 * construction (there is no `personId` input to substitute), which is a
 * self-service action, not one of `rules.ts`'s admin gates.
 */

import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Bell, BellOff, Smartphone } from "lucide-react";
import type { Route } from "./+types/settings.notifications";
import { RouteErrorBoundary } from "@/components/RouteErrorBoundary";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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

  // Fetch existing preferences. Subscribers are PERSON records, not
  // user_account records (see supabase/migrations/20260827000001_canonicalize_notifications.sql) —
  // `notificationPreference.mine` resolves the caller's `personId` through
  // the tenant-bridged session server-side, so there is no id for this
  // screen to pass at all.
  const {
    data: prefs = [],
    isLoading: isPrefsLoading,
    isError: isPrefsError,
  } = useQuery({
    ...trpc.notificationPreference.mine.queryOptions(),
    enabled: !!currentUser?.personId,
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
  const queryClient = useQueryClient();
  const toggleMutation = useMutation(
    trpc.notificationPreference.setMine.mutationOptions({
      onSuccess: () => {
        // This screen was the ONLY reader of the legacy
        // `queryKeys.notificationPreferences.mine` key (grep confirms), so —
        // unlike most writes in this phase — there is no legacy line to keep
        // alongside `trpc.notificationPreference.pathFilter()` (conventions
        // item 7).
        void queryClient.invalidateQueries(trpc.notificationPreference.pathFilter());
      },
      onError: () => {
        toast.error("Failed to update notification preference");
      },
    }),
  );

  const handleToggle = useCallback(
    (eventType: string, enabled: boolean) => {
      toggleMutation.mutate({ event_type: eventType, channel: "email", enabled });
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
          Manage how you receive notifications — email and push.
        </p>
      </div>

      <div className="space-y-6">
        {/* Push Notifications */}
        <PushNotificationCard />

        {/* Email preferences: loading/error states are their own, distinct
            from the Push card above, which does not depend on this read
            (conventions item 5 — a screen that renders nothing and says
            nothing for a failed read is the failure mode this migration
            exists to end). */}
        {isPrefsError ? (
          <div
            role="alert"
            aria-live="assertive"
            className="flex items-start gap-2 rounded-lg border border-destructive/50 bg-destructive/5 p-4 text-sm text-destructive"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              Something went wrong loading your email notification preferences. Try reloading the
              page.
            </span>
          </div>
        ) : isPrefsLoading ? (
          <p className="text-sm text-muted-foreground">Loading your email preferences...</p>
        ) : (
          categories.map((category, catIdx) => {
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
                          <p className="text-xs text-muted-foreground">{setting.description}</p>
                        </div>
                        <Switch
                          id={`pref-${setting.eventType}`}
                          checked={isEnabled(setting.eventType)}
                          onCheckedChange={(checked) => handleToggle(setting.eventType, checked)}
                          disabled={toggleMutation.isPending}
                          aria-label={`Toggle ${setting.label} notifications`}
                        />
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            );
          })
        )}

        {/* Info footer */}
        <p className="text-xs text-muted-foreground">
          Account setup and password reset emails are always sent regardless of these settings. For
          broadcast emails, you can also use the unsubscribe link at the bottom of any email.
        </p>
      </div>
    </div>
  );
}

// ─── Push Notification Card ──────────────────────────────────────

function PushNotificationCard() {
  const { isSupported, permission, isSubscribed, subscribe, unsubscribe, isLoading } =
    usePushNotifications();

  const handleTogglePush = async (enabled: boolean) => {
    try {
      if (enabled) {
        await subscribe();
        toast.success("Push notifications enabled");
      } else {
        await unsubscribe();
        toast.success("Push notifications disabled");
      }
    } catch {
      toast.error("Failed to update push notification settings");
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Smartphone className="h-4 w-4" />
          Push Notifications
        </CardTitle>
        <CardDescription className="text-sm">
          Receive real-time alerts on this device
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!isSupported ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <BellOff className="h-4 w-4" />
            Push notifications are not supported in this browser.
          </div>
        ) : permission === "denied" ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <BellOff className="h-4 w-4" />
            Notifications are blocked. Please update your browser settings to allow notifications
            for this site.
          </div>
        ) : (
          <div className="flex items-start justify-between gap-4 py-1">
            <div className="space-y-0.5">
              <Label
                htmlFor="push-toggle"
                className="text-sm font-medium leading-none cursor-pointer"
              >
                {isSubscribed ? "Enabled" : "Disabled"}
              </Label>
              <p className="text-xs text-muted-foreground">
                {isSubscribed
                  ? "You'll receive push alerts for meetings, agendas, and minutes on this device."
                  : "Enable push notifications to get real-time alerts on this device."}
              </p>
            </div>
            <Switch
              id="push-toggle"
              checked={isSubscribed}
              onCheckedChange={handleTogglePush}
              disabled={isLoading}
              aria-label="Toggle push notifications"
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export { RouteErrorBoundary as ErrorBoundary };
