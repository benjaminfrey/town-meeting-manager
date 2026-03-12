/**
 * Email sender service.
 *
 * Wraps the Postmark ServerClient with:
 * - Template rendering (Handlebars + plain-text fallback)
 * - Message stream routing (transactional vs broadcast)
 * - Batch sending (up to 500 per Postmark batch call)
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Handlebars from "handlebars";
import type * as postmark from "postmark";
import type { NotificationEventType } from "@town-meeting/shared";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EMAIL_TEMPLATES_DIR = path.join(__dirname, "..", "templates", "email");

// ─── Message Stream Routing ───────────────────────────────────────────
// Postmark separates transactional (can't unsubscribe) from broadcast (can)

const BROADCAST_EVENT_TYPES = new Set<NotificationEventType>([
  "meeting_scheduled",
  "meeting_cancelled",
  "agenda_published",
  "minutes_approved",
  "minutes_published",
]);

export function getMessageStream(eventType: NotificationEventType): string {
  return BROADCAST_EVENT_TYPES.has(eventType) ? "broadcast" : "outbound";
}

export function isBroadcastEvent(eventType: NotificationEventType): boolean {
  return BROADCAST_EVENT_TYPES.has(eventType);
}

// ─── Template Cache & Rendering ──────────────────────────────────────

const templateCache = new Map<string, Handlebars.TemplateDelegate>();
let layoutTemplate: Handlebars.TemplateDelegate | null = null;

function getLayoutTemplate(): Handlebars.TemplateDelegate {
  if (layoutTemplate) return layoutTemplate;
  const src = fs.readFileSync(
    path.join(EMAIL_TEMPLATES_DIR, "layout.hbs"),
    "utf-8",
  );
  layoutTemplate = Handlebars.compile(src);
  return layoutTemplate;
}

function getEmailTemplate(name: string): Handlebars.TemplateDelegate {
  const cached = templateCache.get(name);
  if (cached) return cached;
  const src = fs.readFileSync(
    path.join(EMAIL_TEMPLATES_DIR, `${name}.hbs`),
    "utf-8",
  );
  const compiled = Handlebars.compile(src);
  templateCache.set(name, compiled);
  return compiled;
}

function htmlToPlainText(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .trim();
}

export interface RenderedEmail {
  html: string;
  text: string;
  subject: string;
}

export function renderEmailTemplate(
  templateName: string,
  variables: Record<string, unknown>,
): RenderedEmail {
  const contentTemplate = getEmailTemplate(templateName);
  const layout = getLayoutTemplate();

  // Render the content partial
  const contentHtml = contentTemplate(variables);

  // Inject into layout
  const html = layout({ ...variables, content: contentHtml });
  const text = htmlToPlainText(html);

  const subject = (variables.subject as string | undefined) ?? "";
  return { html, text, subject };
}

// ─── Send Options ─────────────────────────────────────────────────────

export interface SendEmailOptions {
  to: string;
  from: string;
  replyTo?: string;
  subject: string;
  htmlBody: string;
  textBody: string;
  tag: string;
  messageStream: string;
  metadata?: Record<string, string>;
}

// ─── EmailSenderService ───────────────────────────────────────────────

export class EmailSenderService {
  constructor(private readonly client: postmark.ServerClient) {}

  async sendEmail(options: SendEmailOptions): Promise<postmark.Models.MessageSendingResponse> {
    return this.client.sendEmail({
      From: options.from,
      To: options.to,
      ReplyTo: options.replyTo,
      Subject: options.subject,
      HtmlBody: options.htmlBody,
      TextBody: options.textBody,
      Tag: options.tag,
      MessageStream: options.messageStream,
      Metadata: options.metadata,
    });
  }

  async sendBatchEmail(
    messages: SendEmailOptions[],
  ): Promise<postmark.Models.MessageSendingResponse[]> {
    const BATCH_SIZE = 500;
    const results: postmark.Models.MessageSendingResponse[] = [];

    for (let i = 0; i < messages.length; i += BATCH_SIZE) {
      const batch = messages.slice(i, i + BATCH_SIZE);
      const postmarkMessages: postmark.Models.Message[] = batch.map((m) => ({
        From: m.from,
        To: m.to,
        ReplyTo: m.replyTo,
        Subject: m.subject,
        HtmlBody: m.htmlBody,
        TextBody: m.textBody,
        Tag: m.tag,
        MessageStream: m.messageStream,
        Metadata: m.metadata,
      }));

      const batchResults = await this.client.sendEmailBatch(postmarkMessages);
      results.push(...batchResults);
    }

    return results;
  }

  renderTemplate(
    templateName: string,
    variables: Record<string, unknown>,
  ): RenderedEmail {
    return renderEmailTemplate(templateName, variables);
  }
}
