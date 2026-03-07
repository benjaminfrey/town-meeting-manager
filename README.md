# Town Meeting Manager

Meeting lifecycle management for New England's Select Board / Town Meeting form of government.

**Status:** Pre-development — concept & specification phase  
**Geography:** Maine-first, expandable to NH, VT, MA, CT, RI  
**Target:** Towns of 1,000–5,000 population  
**Model:** Open core SaaS — $600–$1,200/year flat annual subscription

---

## What This Is

Town Meeting Manager is a purpose-built civic platform that covers the full meeting lifecycle for small New England towns: agenda drafting, meeting notice compliance, live meeting management, AI-assisted minutes drafting, public records archiving, and resident civic engagement — all tuned to the Select Board / Town Meeting form of government and Maine open meetings law.

It serves three audiences:
- **Meeting administrators** (Town Clerks, Town Managers, Recording Secretaries) — full application access
- **Board members** (elected and appointed) — agenda review, voting, draft minutes
- **General public** — no-login portal with searchable agendas, minutes, and meeting calendar

---

## Project Structure

```
town-meeting-manager/
├── README.md                        # This file
├── docs/
│   └── town_meeting_manager_plan.docx   # Full project plan & specification
├── diagrams/
│   ├── feature_map.svg              # Five-module feature map with audiences & compliance layer
│   └── data_model.svg               # Entity-relationship data model (Supabase/PostgreSQL)
└── (src/ — not yet created)
```

---

## Specification Documents

| Document | Location | Description |
|----------|----------|-------------|
| Project Plan | `docs/town_meeting_manager_plan.docx` | 12-section comprehensive specification covering product overview, feature map, data model, compliance architecture, onboarding design, tech stack, business model, roadmap, and civic engagement module |
| Feature Map | `diagrams/feature_map.svg` | Visual map of all five modules, three audience access levels, compliance layer, and formal/informal mode switch |
| Data Model | `diagrams/data_model.svg` | Full entity-relationship diagram with 13+ core entities, field lists, and relationship cardinalities |

---

## Six Product Modules

| # | Module | Status |
|---|--------|--------|
| 1 | Onboarding & Configuration | Specified |
| 2 | Agenda Building | Specified |
| 3 | Live Meeting Manager | Specified |
| 4 | Minutes & Records | Specified |
| 5 | Annual Town Meeting (Warrant Articles) | Specified |
| 6 | Civic Participation & Engagement | Specified |

---

## Tech Stack (Planned)

| Layer | Technology |
|-------|------------|
| Frontend (Web) | React + Tailwind CSS |
| Frontend (Mobile) | React Native |
| Database & Auth | Supabase (PostgreSQL + Auth + Storage + Realtime) |
| API | Node.js / Fastify |
| AI (Minutes Drafting) | Anthropic Claude API |
| Source Control | GitHub |
| Infrastructure | Linux + Docker Compose + Nginx |
| Email | Resend or Postmark (TBD) |
| SMS | Twilio or similar (TBD, TCPA-compliant) |

---

## Compliance Scope

- Maine Open Meetings Law (1 MRSA §401–412)
- Maine FOIA / Public Records retention
- Robert's Rules of Order (loose baseline for motions, seconds, votes)
- ADA / WCAG 2.1 AA (public portal and generated documents)
- CAN-SPAM (email notifications)
- TCPA (SMS notifications)

---

## Development Phases

**Phase 0 (Current):** Specification, data model, roles & permissions, pilot town recruitment  
**Phase 1:** Core MVP — wizard, agenda building, live meeting manager, basic minutes, public portal  
**Phase 2:** Differentiation — AI minutes drafting, warrant article workflow, civic engagement (email/SMS/polls)  
**Phase 3:** Scale — parcel proximity matching, postal mail, multi-town consortiums, zoning integration

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
