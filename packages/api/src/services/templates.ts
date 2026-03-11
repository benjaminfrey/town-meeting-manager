/**
 * Handlebars template service.
 *
 * Loads and compiles .hbs templates at startup, caches them,
 * and provides render functions for agenda packets.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Handlebars from "handlebars";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = path.join(__dirname, "..", "templates");

// ─── Handlebars Helpers ──────────────────────────────────────────────

Handlebars.registerHelper("sectionNumber", (index: number) => index + 1);

Handlebars.registerHelper("itemLetter", (index: number) =>
  String.fromCharCode(65 + index),
);

Handlebars.registerHelper(
  "itemLabel",
  (sectionIndex: number, itemIndex: number) =>
    `${sectionIndex + 1}${String.fromCharCode(65 + itemIndex)}`,
);

const ROMAN = ["i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x"];
Handlebars.registerHelper(
  "romanNumeral",
  (index: number) => ROMAN[index] ?? `${index + 1}`,
);

Handlebars.registerHelper("formatDate", (dateStr: string) => {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
});

Handlebars.registerHelper("formatDateTime", (dateStr: string) => {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
});

Handlebars.registerHelper("currentDate", () =>
  new Date().toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }),
);

// Block helper: {{#ifPresent value}}...{{/ifPresent}}
Handlebars.registerHelper("ifPresent", function (this: unknown, value: unknown, options: Handlebars.HelperOptions) {
  if (value && String(value).trim()) {
    return options.fn(this);
  }
  return options.inverse(this);
});

// ─── Template Cache ──────────────────────────────────────────────────

const cache = new Map<string, Handlebars.TemplateDelegate>();

function loadTemplate(name: string): Handlebars.TemplateDelegate {
  const cached = cache.get(name);
  if (cached) return cached;

  const filePath = path.join(TEMPLATES_DIR, `${name}.hbs`);
  const source = fs.readFileSync(filePath, "utf-8");
  const compiled = Handlebars.compile(source);
  cache.set(name, compiled);
  return compiled;
}

function loadCss(name: string): string {
  const filePath = path.join(TEMPLATES_DIR, `${name}.css`);
  return fs.readFileSync(filePath, "utf-8");
}

// ─── Render Functions ────────────────────────────────────────────────

export interface AgendaPacketData {
  townName: string;
  boardName: string;
  meetingTitle: string;
  meetingType: string;
  scheduledDate: string;
  scheduledTime: string | null;
  location: string | null;
  sealUrl: string | null;
  sections: AgendaPacketSection[];
}

export interface AgendaPacketSection {
  title: string;
  sectionType: string;
  items: AgendaPacketItem[];
}

export interface AgendaPacketItem {
  title: string;
  description: string | null;
  presenter: string | null;
  estimatedDuration: number | null;
  staffResource: string | null;
  background: string | null;
  recommendation: string | null;
  suggestedMotion: string | null;
  exhibits: AgendaPacketExhibit[];
  subItems: AgendaPacketSubItem[];
}

export interface AgendaPacketSubItem {
  title: string;
  description: string | null;
}

export interface AgendaPacketExhibit {
  title: string;
  fileName: string | null;
  exhibitType: string | null;
}

/**
 * Render the agenda packet HTML with inlined CSS.
 * Computes hasExhibits from section data automatically.
 */
export function renderAgendaPacket(data: AgendaPacketData): string {
  const template = loadTemplate("agenda-packet");
  const css = loadCss("agenda-packet");

  const hasExhibits = data.sections.some((s) =>
    s.items.some((i) => i.exhibits.length > 0),
  );

  return template({ ...data, css, hasExhibits });
}
