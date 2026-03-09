# Advisory 4 — Simple Decisions

**Advisory Item:** Things That Just Need a Decision
**Date:** March 2026
**Status:** Resolved — all four decisions made

---

## 4.1 TypeScript or JavaScript?

**Decision: TypeScript.** Non-negotiable for a multi-package monorepo with a shared data model. Type safety across `web`, `mobile`, `api`, and `shared` packages is the primary reason for the monorepo structure.

## 4.2 What Is the URL Structure for the Public Portal?

**Decision: Subdomain per town.** Each town gets `townname.townmeetingmanager.com` (e.g., `nobleboro.townmeetingmanager.com`). Wildcard SSL via Let's Encrypt + Nginx wildcard routing. Towns can publish this URL on official town materials as "their" portal.

## 4.3 What Is the Minutes Document Format?

**Decision: Structured JSON → HTML → PDF.** Minutes are stored as structured JSON (the canonical source). Rendered to HTML for the public portal (ADA-accessible, full-text searchable). PDF generated on demand via Puppeteer (per advisory 3.3) for download and printing. Amendments modify the JSON source and regenerate HTML/PDF.

## 4.4 What Email Address Does the Platform Send From?

**Decision: Town-branded subdomain.** Notifications send from `notifications@townname.townmeetingmanager.com` (e.g., `notifications@nobleboro.townmeetingmanager.com`). This appears trustworthy to recipients and is operationally simple — a single wildcard SPF/DKIM configuration covers all towns without per-town DNS setup. Postmark (per advisory 2.4) supports sender signatures on subdomains.
