export type NoticeBlockType =
  | "letterhead"
  | "meeting_details"
  | "agenda_summary"
  | "rich_text"
  | "statutory_footer"
  | "signature_block"
  | "spacer";

export interface NoticeTemplateBlock {
  id: string;
  type: NoticeBlockType;
  order: number;
  config: Record<string, unknown>;
}

/** Block-specific config shapes for type safety in the editor */
export interface LetterheadConfig {
  logoPosition: "left" | "center" | "right";
  showSeal: boolean;
  fontSize: "sm" | "md" | "lg";
}

export interface MeetingDetailsConfig {
  dateLabel: string;
  timeLabel: string;
  locationLabel: string;
  showVirtualLink: boolean;
}

export interface AgendaSummaryConfig {
  includeSubItems: boolean;
  maxItems: number; // 0 = all
}

export interface RichTextConfig {
  content: string; // HTML string from Tiptap
}

export interface StatutoryFooterConfig {
  statuteCitation: string;
}

export interface SignatureBlockConfig {
  name: string;
}

export interface SpacerConfig {
  height: "sm" | "md" | "lg";
}

export const NOTICE_BLOCK_LABELS: Record<NoticeBlockType, string> = {
  letterhead: "Letterhead",
  meeting_details: "Meeting Details",
  agenda_summary: "Agenda Summary",
  rich_text: "Rich Text",
  statutory_footer: "Statutory Footer",
  signature_block: "Signature Block",
  spacer: "Spacer",
};

/** Block types that can only appear once in a template */
export const SINGLETON_BLOCK_TYPES: NoticeBlockType[] = [
  "letterhead",
  "meeting_details",
  "agenda_summary",
  "statutory_footer",
  "signature_block",
];
