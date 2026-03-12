# Town Meeting Manager — Pre-Development Advisory Report

**Date:** March 2026  
**Status:** Pre-development — specification complete, coding not yet begun  
**Purpose:** Identify what needs to be resolved, explored, or decided before the first line of application code is written

---

## Overview

The specification is solid. The product concept is coherent, the market is well-defined, the data model is logically structured, and the six modules have been thought through carefully. What follows is an honest assessment of the open questions and decisions that will meaningfully affect how the product is built — and that are much cheaper to resolve now than after development begins.

These are organized roughly in priority order: things that should be decided first, things that can be deferred slightly, and things that just need a decision (either answer is fine, but pick one).

---

## 1. Decisions That Should Come First

### 1.1 Observe Real Meetings Before Finalizing the Live Meeting Manager UX

This is the single highest-value pre-coding activity. The live meeting manager is the most complex screen in the product and the one most likely to be wrong on the first attempt. Before any wireframes are finalized or any React components are built:

**Go to real Select Board meetings.** Sit with the person who records the minutes. Watch what they actually do during the meeting — what they're tracking, what they're scrambling to keep up with, what they miss, where their attention goes. Ask to see their current notes or Word template afterward.

Specific things to observe:
- How far in advance do they know what's going to happen vs. what comes up unexpectedly?
- How do they handle motions that happen mid-conversation without a clear "now we're making a motion" signal?
- What does executive session entry actually look like in practice?
- How do they deal with members arriving late or leaving early mid-meeting?
- What do they do when a vote is called before anyone writes down the motion text?

Two or three meetings in two or three different towns will reveal more design insight than any amount of requirements writing.

**Minimum:** At least one Select Board meeting and one Planning Board public hearing before finalizing the live meeting manager wireframes.

---

### 1.2 Resolve the User Roles & Permissions Model

This has been deferred and needs to be resolved before any application code is written, because role definitions cascade through every layer of the application — Supabase RLS policies, React route guards, API middleware, and the onboarding wizard.

The current spec identifies these roles: `admin`, `town_clerk`, `staff`, `board_member`, `recording_secretary`. But several questions remain open:

**Who is the `admin` vs. `town_clerk`?**  
In a town with a Town Clerk and a Town Manager, who gets which role? Can a town have two `admin` users? Is `admin` a platform-level role (billing, account management) or a town-level role (full access to all boards)?

**What exactly can a `board_member` do?**  
Can they edit agenda items before a meeting? Can they upload attachments? Can they add comments to agenda items? Can they see draft minutes before approval? The spec says "view agenda and attachments, annotate agenda items" — but "annotate" is vague. Private annotations only, or shared with other board members, or visible to the administrator?

**What is a `recording_secretary` exactly?**  
The spec says a board member can serve as recording secretary. Does that mean they get elevated to a different role for a specific meeting? Or is it a permanent role on a board? A board member who is also the recording secretary needs to be able to type minutes during a meeting — can they do that while also being listed as a voting member? How does the quorum calculation handle this?

**What about multi-board members?**  
A common scenario in small towns: the same person serves on both the Select Board and the Budget Committee. They need board_member access to both boards. Does the system handle this as one account with multiple board assignments, or two separate accounts?

**Recommendation:** Produce a formal roles & permissions matrix before any backend code is written. Rows are roles, columns are actions (create meeting, edit agenda item, record vote, approve minutes, create poll, export records, manage members, manage billing, etc.). Fill in Y/N/conditional for each cell. This matrix becomes the direct specification for RLS policies.

---

### 1.3 Supabase Realtime Proof-of-Concept for the Live Meeting Manager

The live meeting manager relies on Supabase Realtime for synchronization between the administrator's device and board members' devices during a meeting. Supabase Realtime is the primary real-time mechanism for multi-device meeting sync — this is the most technically critical piece of the stack and needs to be validated before the live meeting manager is built.

Specific requirements to validate:

- **Reliability under brief connectivity loss.** Town meeting rooms sometimes have poor WiFi. What happens if the administrator's device loses connectivity for 30 seconds? Does the Realtime subscription reconnect gracefully? Does the ConnectionStatusBar show the correct state during disconnect and reconnect? Does React Query's cache keep the UI functional during the gap?
- **Conflict handling.** If a board member submits a vote at the same moment the administrator advances to the next agenda item, what does each device's UI show? Supabase processes changes in commit order — test that the `postgres_changes` events arrive in the correct sequence.
- **RLS on Realtime channels.** Supabase Realtime + RLS has known quirks — RLS policies on `realtime.messages` work differently than on regular tables. This needs to be tested with the actual multi-tenant data model: verify that a user on Town A cannot receive `postgres_changes` events for Town B's data.

**Recommendation:** Build a minimal Realtime proof-of-concept — one "meeting room" with simulated agenda items, one admin device advancing items, two board member devices receiving updates via `postgres_changes` subscriptions — before the live meeting manager is part of the main development sprint. This is a two-to-three day exercise that validates Supabase Realtime + TanStack Query + RLS working together, and could save weeks of rework.

---

## 2. Conceptual Gaps to Resolve

### 2.1 The Onboarding Wizard Needs a Full UX Specification

The five-stage wizard is well-described in terms of *what it collects*, but not in terms of *how it behaves*. Before development:

- What happens if the user exits mid-wizard? Is progress saved? Do they restart or resume?
- What is the exact branching logic? (e.g., if "role-titled board" is selected, a seat-title table appears — but what if they change from role-titled to at-large after filling it in? Is the data discarded with a warning?)
- What are the exact validation rules per field? (e.g., can member count be 0? Can a board have no quorum rule?)
- What does the completion state look like, and how does it transition to the Town Profile dashboard?

A written UX specification (not wireframes necessarily, but a clear description of states and transitions) for the wizard should be completed before any frontend wizard code is written.

### 2.2 The AI Minutes Draft — Prompt Architecture

The AI-assisted minutes drafting is one of the strongest differentiators in the product, but "send structured meeting data to the Claude API and get back a draft" is a significant oversimplification of what needs to be designed. Before development:

- **What is the exact structure of the data sent to the API?** The prompt engineering matters enormously for output quality. A minutes draft that sounds like AI-generated text will not be adopted by Town Clerks who have been writing minutes for 20 years. The output needs to sound like a human wrote it in the voice of *this town's* minutes style.
- **How are board-specific templates incorporated?** The spec says "templates per board type and minutes style" — but these templates don't exist yet and need to be drafted, probably with input from real Town Clerks.
- **How does the system handle incomplete data?** A motion was recorded without a mover. An executive session occurred but the return timestamp wasn't recorded. The prompt needs to handle these gracefully — flagging them in the draft rather than hallucinating plausible values.
- **What is the review UX?** The administrator reviews and edits the draft. Is this a rich text editor? Does it show the AI-generated text alongside the structured data it was generated from? Can the administrator regenerate a specific section without regenerating the whole document?

**Recommendation:** Before writing a line of AI integration code, draft 3–5 sample minutes documents from real Maine Select Board meetings. Use these as ground truth for what the output should look like. Then design the prompt architecture to produce output that matches.

### 2.3 The Parcel Proximity System Needs a Data Strategy

The property/parcel proximity matching feature (Module 6, Phase 3) requires integrating Maine GeoLibrary parcel data. This sounds straightforward but has real operational considerations:

- **How often does the parcel data update, and how does the platform stay current?** The Maine GeoLibrary publishes annual updates, but parcel boundaries and ownership change continuously. A resident's parcel match could be stale.
- **What coordinate system is the data in, and does PostGIS handle the transform automatically?** Maine parcel data is typically in NAD83 / Maine State Plane. PostGIS can handle this, but it needs to be specified and tested.
- **What is the geocoding strategy for resident address entry?** Free-text address entry needs a geocoding service (Google Maps Geocoding API, Mapbox, or similar) to convert to coordinates before matching against parcel polygons. This is an API cost and an API key management question.
- **Is parcel data loaded per-town or statewide?** Loading all of Maine's parcels into the database is feasible (Maine has ~600,000 parcels), but the indexing strategy matters for query performance on proximity searches.

This can wait for Phase 3, but the data model should include the `geographic_scope` geometry field on `AGENDA_ITEM` from day one (adding PostGIS columns to existing tables later is painful).

### 2.4 The Straw Poll Notification System Has a Provider Decision Pending

The SMS notification system requires a provider decision before development. The main candidates for a TCPA-compliant SMS provider serving small volumes:

- **Twilio** — most complete API, well-documented, but pricing at small volume is not the best
- **Telnyx** — significantly cheaper per-message than Twilio at low volume, comparable API quality
- **Postmark** (email) + **Twilio/Telnyx** (SMS) is probably the right pairing

This matters for development because the SMS integration is deeply tied to the notification event system and opt-in/opt-out flows. Choosing the provider before building the notification infrastructure avoids a costly migration later.

---

## 3. Architecture Decisions That Need to Be Made

### 3.1 Monorepo vs. Separate Repositories

The product has at least three distinct codebases: the web application (React), the mobile app (React Native), and the backend API (Node.js/Fastify). The spec references shared business logic and type definitions.

**Option A — Monorepo (recommended):** Single GitHub repository with packages for `web`, `mobile`, `api`, and `shared`. Tools: Turborepo or pnpm workspaces. Pros: shared TypeScript types across all packages (critical for type-safe API contracts), single CI/CD pipeline, easier to keep things in sync. Cons: slightly more complex initial setup.

**Option B — Separate repositories:** Three repos. Pros: simpler per-project setup. Cons: type definitions drift, more complex dependency management, three CI/CD pipelines to maintain.

For a product with a shared data model across web and mobile, the monorepo approach is strongly recommended. The decision should be made before any code is written because it affects the repository structure, package.json layout, and CI/CD configuration.

### 3.2 Supabase Hosting: Managed vs. Self-Hosted

The spec mentions self-hosted Supabase via Docker Compose. This is technically sound but has operational implications worth making explicit:

**Self-hosted pros:** No per-row pricing, no Supabase cloud pricing as scale grows, full control over data location (relevant for municipal clients who may ask where their data lives), no dependency on Supabase's uptime.

**Self-hosted cons:** You are responsible for database backups, WAL configuration, Supabase version upgrades, and the Realtime service's stability. For a product in early development with paying municipal clients, this is a meaningful operational burden.

**Recommendation for Phase 1:** Start with Supabase Cloud (free tier during development, Pro tier for pilot towns). Migrate to self-hosted when you have 10+ paying towns and the operational capacity to manage it. The application code doesn't change — only the connection strings.

### 3.3 Document Generation Strategy

The spec mentions PDF generation for agenda packets and minutes but doesn't specify the approach. Two viable options:

**Option A — Puppeteer (HTML-to-PDF):** Render the document as HTML/CSS in a headless browser, then capture as PDF. Pros: full CSS control over layout, easy to produce tagged accessible PDFs with the right HTML structure. Cons: Puppeteer is heavy (Chrome), needs careful memory management in a server environment.

**Option B — pdfmake or pdf-lib:** Generate PDFs programmatically without a browser. Pros: lighter, faster, more predictable. Cons: less layout flexibility, harder to make look polished.

**Recommendation:** Puppeteer for agenda packets and minutes (where layout quality matters), pdf-lib for simpler documents like meeting notices (where a clean text output is sufficient). Decide this before Module 2 development begins, because the agenda packet generation is part of the MVP.

---

## 4. Things That Just Need a Decision

These are questions where either answer is workable, but a decision needs to be made so development can proceed consistently.

### 4.1 TypeScript or JavaScript?

Use TypeScript. Non-negotiable recommendation for a multi-package monorepo with a shared data model. The type safety across web, mobile, and API packages is the primary reason to use a monorepo at all. If types aren't shared, use separate repos.

### 4.2 What Is the URL Structure for the Public Portal?

Two options:
- **Subdomain per town:** `nobleboro.townmeetingmanager.com` — clean, town-branded, but requires wildcard SSL certificate and Nginx wildcard routing
- **Path per town:** `townmeetingmanager.com/towns/nobleboro` — simpler infrastructure, but less clean for a town to share with residents

Subdomain is strongly recommended. It gives each town a URL they can legitimately brand as "their" town's portal and publish on official town materials. Wildcard SSL via Let's Encrypt is straightforward. Decide before the public portal is built.

### 4.3 What Is the Minutes Document Format?

The spec says minutes are generated as PDFs. But approved minutes are also a legal record that may need to be edited (via amendment) and re-published. Options:

- **PDF only:** Clean, immutable-looking, widely expected. But editing requires regenerating from the structured JSON source.
- **PDF + DOCX export:** Gives the Town Clerk the option to download a Word doc for their own records while the canonical published record is the PDF.
- **HTML as canonical:** Store and publish minutes as HTML (accessible, searchable), with PDF as a generated export. Most flexible for long-term archival.

**Recommendation:** Store minutes as structured JSON (already in the spec), render to HTML for the public portal (ADA-accessible, searchable), and generate PDF on demand for download and printing. This gives maximum flexibility.

### 4.4 What Email Address Does the Platform Send From?

Notification emails to residents need to come from an address that appears legitimate and trustworthy. Options:
- `notifications@townmeetingmanager.com` — platform-branded
- `notifications@nobleboro.townmeetingmanager.com` — town-branded subdomain
- Custom domain per town (requires SPF/DKIM setup per town) — most legitimate-looking but operationally complex at scale

Subdomain approach is the right balance. Decide before the email system is built.

---

## 5. Recommended Development Sequence

Given the above, here is the recommended sequence of activities before and during early development:

**Immediate (before any code):**
1. Attend 2–3 real Maine municipal meetings
2. Draft the roles & permissions matrix
3. Make the monorepo vs. separate repos decision and initialize the repository structure
4. Make the Supabase Cloud vs. self-hosted decision for Phase 1
5. Draft 3–5 sample minutes documents as AI output ground truth

**Before Phase 1 MVP coding begins:**
6. Complete the onboarding wizard UX specification (states, transitions, validation rules)
7. Select and test the email provider (Resend or Postmark)
8. Build the Supabase Realtime proof-of-concept for live meeting multi-device sync
9. Decide document generation strategy (Puppeteer vs. pdfmake)
10. Initialize the Supabase schema (all Phase 1 tables + PostGIS extension for future use)

**Before Phase 2 coding begins:**
11. Select SMS provider (Telnyx or Twilio)
12. Design the prompt architecture for AI minutes drafting
13. Identify and recruit pilot town partners (before Phase 2 ships, not after)

**Phase 3 preparation (can wait):**
14. Maine GeoLibrary parcel data strategy
15. Geocoding provider selection and cost modeling

---

## 6. The One Thing That Would Derail This Product

Worth naming directly: **the live meeting manager failing during a real meeting would be catastrophic for adoption.**

A town that tries this tool, has it crash or freeze during an actual Select Board meeting, and has to fall back to handwritten notes in front of the public — that town will never use it again, and they will tell every other town clerk they know. The municipal community is small and word travels fast in both directions.

This means:
- The live meeting manager must be resilient to brief network interruptions. When the network drops, the `ConnectionStatusBar` must show a clear warning immediately. Supabase Realtime should reconnect automatically within 10–15 seconds in most cases. Meeting operations during a brief disconnect should show a non-blocking warning; after 30 seconds of failed reconnection, writes should block with an explicit error message rather than silently queuing or silently failing.
- Full offline capability (persistent offline operation with a local write queue) is not required — a complete network outage during a meeting is an edge case in 2026, and graceful degradation (read-only mode with clear status) is the appropriate response.
- The live meeting manager must be the most thoroughly tested part of the application before any pilot deployment.
- Pilot town deployment should begin with the meeting manager in "shadow mode" — the administrator runs the tool alongside their existing process (not instead of it) for 2–3 meetings before trusting it as the record of truth.

This is a resilience requirement, not a full offline requirement.

---

## Summary

| Priority | Item | Estimated Effort |
|----------|------|-----------------|
| 🔴 Do first | Attend real Maine municipal meetings | 1–2 weeks, scheduling dependent |
| 🔴 Do first | Roles & permissions matrix | 1–2 days |
| 🔴 Do first | Monorepo structure decision & repo init | 1 day |
| 🔴 Do first | Supabase Cloud vs. self-hosted decision | Half day |
| 🟡 Before Phase 1 | Onboarding wizard UX spec | 2–3 days |
| 🟡 Before Phase 1 | Supabase Realtime proof-of-concept (live meeting multi-device sync) | 2–3 days |
| 🟡 Before Phase 1 | Sample minutes as AI output ground truth | 1–2 days |
| 🟡 Before Phase 1 | Email provider selection & test | 1 day |
| 🟡 Before Phase 1 | Document generation strategy decision | Half day |
| 🟢 Before Phase 2 | SMS provider selection | Half day |
| 🟢 Before Phase 2 | AI minutes prompt architecture | 3–5 days |
| 🟢 Before Phase 2 | Pilot town recruitment | Ongoing |
| 🔵 Phase 3 prep | Parcel data strategy | 1–2 days |

---

*Town Meeting Manager — Pre-Development Advisory Report*  
*Maine-first · Open core · Built for towns that currently have nothing*
