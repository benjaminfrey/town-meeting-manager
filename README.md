# Town Meeting Manager

Meeting lifecycle management for New England's Select Board / Town Meeting form of government.

**Status:** Pre-development complete — architecture resolved, [development workflow](docs/workflow/README.md) ready for implementation
**Geography:** Maine-first, expandable to NH, VT, MA, CT, RI
**Target:** Towns of 1,000–5,000 population
**Model:** Open core SaaS — $600–$1,200/year flat annual subscription

---

## What This Is

Town Meeting Manager is a purpose-built civic platform that covers the full meeting lifecycle for small New England towns: agenda drafting, meeting notice compliance, live meeting management, AI-assisted minutes drafting, public records archiving, and resident civic engagement — all tuned to the Select Board / Town Meeting form of government and Maine open meetings law.

The application is **offline-first** — the live meeting manager works without network connectivity, critical for rural Maine town halls with unreliable WiFi. Data syncs automatically when connectivity is restored.

It serves four internal roles and one public audience:

| Role | Description |
|------|-------------|
| **sys_admin** | System-level administrator (self-hosted deployments only) |
| **admin** | Town administrator — full control, manages users, settings, boards |
| **staff** | Configurable per-board permissions via admin-controlled matrix |
| **board_member** | Agenda review, voting, draft minutes review |
| **Public** | No-login portal with searchable agendas, minutes, and meeting calendar |

> **Recording secretary** is not a role — it is a cross-cutting capability assignable per meeting to any admin, staff, or board member.

---

## Project Structure

```
town-meeting-manager/
├── README.md
├── docs/
│   ├── town_meeting_manager_plan.docx       # Original project plan & specification
│   ├── advisory-resolutions/                # 11 resolved architectural decisions
│   │   ├── 1.2-roles-permissions.md         #   PERSON entity, 4 roles, permissions matrix
│   │   ├── 1.3-tech-stack-evaluation.md     #   Offline-first stack (PowerSync + Supabase)
│   │   ├── 1.3a-frontend-architecture.md    #   React Router v7, shadcn/ui, Kysely, testing
│   │   ├── 2.1-onboarding-wizard-ux-spec.md #   5-stage wizard, field specs, completion flow
│   │   ├── 2.2-ai-minutes-architecture.md   #   Minutes pipeline, Claude API, review UX
│   │   ├── 2.3-parcel-data-architecture.md  #   Maine GeoLibrary, PostGIS, parcel/E911 data
│   │   ├── 2.4-notification-providers.md    #   Postmark (email) + Twilio (SMS)
│   │   ├── 3.1-monorepo-structure.md        #   pnpm workspaces + Turborepo
│   │   ├── 3.2-supabase-hosting.md          #   Self-hosted Docker Compose
│   │   ├── 3.3-document-generation.md       #   Puppeteer + pdf-lib
│   │   └── 4-simple-decisions.md            #   TypeScript, subdomains, JSON→HTML→PDF
│   └── workflow/                            # 56-session development workflow
│       ├── README.md                        #   Master index with dependency graph
│       ├── phase-1-mvp/                     #   37 sessions — core platform
│       ├── phase-2-differentiation/         #   11 sessions — AI, audio, civic engagement
│       └── phase-3-scale/                   #   8 sessions — parcels, proximity, consortiums
├── diagrams/
│   ├── feature_map.svg                      # Six-module feature map with audiences
│   └── data_model.svg                       # Entity-relationship diagram (20+ entities)
└── packages/                                # (created in session 01.01)
    ├── web/                                 #   React + Tailwind CSS v4 (web application)
    ├── mobile/                              #   React Native + Expo (Phase 2)
    ├── api/                                 #   Node.js / Fastify (backend API)
    └── shared/                              #   Shared types, Zod schemas, constants
```

---

## Specification & Architecture Documents

| Document | Location | Description |
|----------|----------|-------------|
| Project Plan | `docs/town_meeting_manager_plan.docx` | Original 12-section specification |
| Advisory Resolutions | `docs/advisory-resolutions/` | 11 resolved architectural decisions made during pre-development |
| Development Workflow | `docs/workflow/` | 56 build sessions with task lists and Claude AI prompts |
| Feature Map | `diagrams/feature_map.svg` | Six-module visual feature map |
| Data Model | `diagrams/data_model.svg` | Full entity-relationship diagram with PERSON entity architecture |

---

## Six Product Modules

| # | Module | Phase | Key Features |
|---|--------|-------|-------------|
| 1 | Onboarding & Configuration | 1 | 5-stage setup wizard, PERSON entity management, per-board permissions matrix |
| 2 | Agenda Building | 1 | Templates, drag-and-drop ordering, notice compliance, agenda packet PDF generation |
| 3 | Live Meeting Manager | 1 | Offline-first, roll call, motion/vote capture, executive session, adjournment |
| 4 | Minutes & Records | 1–2 | AI-drafted minutes (Claude API), structured JSON → HTML → PDF pipeline, approval workflow |
| 5 | Annual Town Meeting | 2 | Warrant article drafting, fiscal impact, floor amendments, multiple vote methods |
| 6 | Civic Engagement | 2–3 | Email/SMS notifications, resident straw polls, parcel proximity matching, public portal |

---

## Tech Stack

| Layer | Technology | Notes |
|-------|------------|-------|
| **Language** | TypeScript | Across all packages — shared types via monorepo |
| **Frontend (Web)** | React 19 + React Router v7 | Framework mode with clientLoader/clientAction pattern |
| **Styling** | Tailwind CSS v4 + shadcn/ui | CSS-first config (Rust engine), Radix UI primitives |
| **Offline Sync** | PowerSync | SQLite on client, bidirectional sync, offline writes |
| **Client ORM** | Kysely | Type-safe SQL via @powersync/kysely-driver |
| **Forms** | React Hook Form + Zod | Shared validation schemas in `packages/shared` |
| **Database** | PostgreSQL + PostGIS | Self-hosted via Supabase Docker Compose |
| **Auth** | Supabase Auth (GoTrue) | Magic links (Phase 1), email/password + MFA (later) |
| **API** | Supabase (PostgREST) + Fastify | PostgREST for CRUD, Fastify for custom endpoints |
| **AI** | Anthropic Claude API | Minutes drafting, prompt templates per minutes style |
| **PDF Generation** | Puppeteer + pdf-lib | Puppeteer for complex layouts, pdf-lib for simple docs |
| **Email** | Postmark | Transactional + broadcast message streams |
| **SMS** | Twilio | TCPA-compliant, 10DLC registration (Phase 2) |
| **Mobile** | React Native + Expo | Phase 2 — audio recording, offline meetings |
| **PWA** | Vite PWA plugin | Phase 1 mobile strategy before React Native |
| **Testing** | Vitest + React Testing Library + Playwright | Unit/component + E2E |
| **Monorepo** | pnpm workspaces + Turborepo | 4 packages: web, mobile, api, shared |
| **Infrastructure** | Docker Compose + Nginx | Self-hosted Supabase stack |
| **Source Control** | GitHub | Monorepo with conventional commits |

---

## Data Model

The data model is built on the **PERSON entity architecture** — a unified identity anchor that cleanly separates app roles from government titles:

```
PERSON (identity anchor)
├── user_account (0..1) — app login, role (sys_admin/admin/staff/board_member), permissions
├── board_members (0..many) — per-board membership with seat, term, status
└── resident_account (0..1) — civic engagement subscriptions, notification preferences
```

Core entities include: Town, Person, Board, Meeting, Agenda Item, Motion, Vote Record, Meeting Attendance, Minutes Document, Minutes Section, Exhibit, Agenda Template, Permission Template, Notification Event, Notification Delivery, Audit Log.

Phase 2–3 entities add: Warrant Article, Audio Recording, Transcript, Straw Poll, Parcel, E911 Address, Consortium.

See [`diagrams/data_model.svg`](diagrams/data_model.svg) for the full entity-relationship diagram.

---

## Compliance Scope

- Maine Open Meetings Law (1 MRSA §401–412)
- Maine FOIA / Public Records retention
- Maine Conflict of Interest (30-A M.R.S.A. §2605)
- Robert's Rules of Order (loose baseline for motions, seconds, votes)
- ADA / WCAG 2.1 AA (public portal and generated documents)
- CAN-SPAM (email notifications)
- TCPA (SMS notifications — Phase 2)

---

## Development Phases

The project is organized into 3 phases with 56 development sessions across 29 logical blocks. Each session includes a detailed task list and a self-contained Claude AI prompt. See [`docs/workflow/`](docs/workflow/README.md) for the complete build plan.

| Phase | Focus | Sessions | Estimated Tasks |
|-------|-------|----------|----------------|
| **Phase 1 — MVP** | Core platform: wizard, agendas, live meetings, minutes, portal, notifications, RBAC, PWA | 37 | ~420 |
| **Phase 2 — Differentiation** | AI minutes drafting, audio/transcription, warrant articles, SMS, straw polls, React Native | 11 | ~111 |
| **Phase 3 — Scale** | Parcel data (Maine GeoLibrary), proximity matching, postal mail, multi-town consortiums, zoning integration | 8 | ~68 |
| **Total** | | **56** | **~599** |

---

## Go-to-Market

Maine Municipal Association (MMA) as primary institutional channel. Pilot deployments with 2–3 Maine towns before public launch. Population-tiered pricing with no setup fees, no per-user fees.

| Population | Annual Price |
|------------|-------------|
| Under 1,000 | $600/year |
| 1,000–2,500 | $900/year |
| 2,500–5,000 | $1,200/year |
| 5,000–10,000 | $1,800/year |

---

## License

TBD — open core model. Core will be open source; managed hosting and AI features are commercial.
