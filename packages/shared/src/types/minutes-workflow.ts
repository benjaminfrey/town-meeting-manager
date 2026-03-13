// ─── Audio Retention Policy ─────────────────────────────────────────

export const AudioRetentionPolicy = {
  PURGE_ON_APPROVAL: "purge_on_approval",
  RETAIN_30_DAYS: "retain_30_days",
  RETAIN_90_DAYS: "retain_90_days",
  RETAIN_INDEFINITELY: "retain_indefinitely",
} as const;

export type AudioRetentionPolicy =
  (typeof AudioRetentionPolicy)[keyof typeof AudioRetentionPolicy];

export const AUDIO_RETENTION_LABELS: Record<AudioRetentionPolicy, string> = {
  purge_on_approval: "Delete after approval",
  retain_30_days: "Retain 30 days",
  retain_90_days: "Retain 90 days",
  retain_indefinitely: "Retain indefinitely",
};

export const AUDIO_RETENTION_DESCRIPTIONS: Record<AudioRetentionPolicy, string> = {
  purge_on_approval:
    "Audio recordings are deleted immediately after minutes are approved",
  retain_30_days:
    "Audio recordings are kept for 30 days after minutes approval, then deleted",
  retain_90_days:
    "Audio recordings are kept for 90 days after minutes approval, then deleted",
  retain_indefinitely:
    "Audio recordings are kept permanently alongside approved minutes",
};

// Note: AmendmentHistoryEntry is defined in ./minutes.ts
