/**
 * Stage 1, Task G1 — what the email templates will and will not emit raw.
 *
 * The task closed `admin-alert.hbs`'s `{{{alertMessage}}}`: a triple-stash fed
 * from a notification event's payload, which until G1 arrived through an
 * unauthenticated endpoint. Rendered into mail from a town's own DKIM-signed
 * domain, that is a phishing platform with municipal letterhead.
 *
 * One triple-stash remains and is correct: `layout.hbs`'s `{{{content}}}`,
 * which receives the rendered output of a trusted `.hbs` partial. Escaping it
 * would emit the email's own markup as visible text.
 *
 * But its safety is POSITIONAL. `renderEmailTemplate` builds the layout's
 * variables as `{ ...variables, content: contentHtml }`, and `variables` is
 * `{ ...payload, … }` where `payload` is caller-supplied. The only thing
 * stopping a payload's own `content` key from reaching that triple-stash is
 * that `content:` is written second. Reversing two object keys — a formatting
 * change, in a file nobody would review as security-sensitive — reopens the
 * hole without touching a template.
 *
 * So this file asserts the behaviour rather than the source: a payload that
 * tries to smuggle HTML through `alertMessage` gets it escaped, and a payload
 * that tries to smuggle it through `content` has it discarded.
 */

import { describe, it, expect } from "vitest";
import { renderEmailTemplate } from "../email-sender.js";

const XSS = '<script>alert("pwned")</script>';
const PHISH = '<a href="https://evil.example/steal">Verify your town account</a>';

describe("email template escaping", () => {
  it("escapes alertMessage instead of emitting it as markup", () => {
    const { html } = renderEmailTemplate("admin-alert", {
      subject: "Alert",
      alertTitle: "Something happened",
      townName: "Newcastle",
      recipientName: "Clerk",
      alertMessage: PHISH,
    });

    // The visible text survives — the alert still says what it said.
    expect(html).toContain("Verify your town account");
    // The anchor does not. This is the assertion the triple-stash failed.
    // Matched as "no live element pointing at evil.example" rather than as an
    // exact string: Handlebars escapes `=` to `&#x3D;` and `"` to `&quot;` as
    // well as the angle brackets, so pinning the exact escaped form would make
    // this test about Handlebars' escaping table rather than about whether a
    // link survives.
    expect(html).not.toMatch(/<a[^>]*evil\.example/);
    expect(html).toContain("&lt;a");
    expect(html).toContain("&lt;/a&gt;");
  });

  it("escapes a script tag smuggled through any admin-alert field", () => {
    const { html } = renderEmailTemplate("admin-alert", {
      subject: "Alert",
      alertTitle: XSS,
      townName: XSS,
      recipientName: XSS,
      alertMessage: XSS,
    });

    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("does NOT let a payload's own `content` key reach layout.hbs's triple-stash", () => {
    // The key-order guarantee, stated as behaviour. `content` is a plausible
    // name for a payload field — a notice body, an alert body — so this is not
    // an exotic collision. If `renderEmailTemplate` is ever rewritten as
    // `{ content: contentHtml, ...variables }`, this fails.
    const { html } = renderEmailTemplate("admin-alert", {
      subject: "Alert",
      alertTitle: "Something happened",
      townName: "Newcastle",
      recipientName: "Clerk",
      alertMessage: "the real message",
      content: PHISH,
    });

    expect(html).not.toMatch(/<a[^>]*evil\.example/);
    // And the layout still rendered the genuine partial, rather than the
    // attacker's value having replaced it.
    expect(html).toContain("the real message");
    expect(html).toContain("Newcastle");
  });

  it("still renders the layout's own markup unescaped — the triple-stash earns its place", () => {
    // The negative control. If `{{{content}}}` were "fixed" to `{{content}}`,
    // every email would arrive as a wall of visible HTML source, and the tests
    // above would all still pass.
    const { html } = renderEmailTemplate("admin-alert", {
      subject: "Alert",
      alertTitle: "Something happened",
      townName: "Newcastle",
      recipientName: "Clerk",
      alertMessage: "plain",
    });

    expect(html).toContain("<h2");
    expect(html).not.toContain("&lt;h2");
  });

  it("has exactly one triple-stash left across the email templates", async () => {
    // A cheap tripwire on the whole directory: a new template that reaches for
    // `{{{ }}}` fails here rather than being noticed in a later audit.
    const fs = await import("node:fs");
    const path = await import("node:path");
    const url = await import("node:url");

    const dir = path.join(
      path.dirname(url.fileURLToPath(import.meta.url)),
      "..",
      "..",
      "templates",
      "email",
    );

    const found: string[] = [];
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".hbs"))) {
      const source = fs.readFileSync(path.join(dir, file), "utf8");
      // Handlebars comments (`{{! … }}`) explain the G1 change and mention the
      // old stash; they are not output, so they must not count.
      const withoutComments = source.replace(/\{\{![\s\S]*?\}\}/g, "");
      for (const match of withoutComments.matchAll(/\{\{\{\s*([\w.]+)\s*\}\}\}/g)) {
        found.push(`${file}:${match[1]}`);
      }
    }

    expect(found).toEqual(["layout.hbs:content"]);
  });
});
