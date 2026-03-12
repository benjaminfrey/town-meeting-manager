# Town Meeting Manager — Development Workflow

This directory contains the complete, step-by-step development workflow for the Town Meeting Manager application. Each session file includes a description, task list, and a precise Claude AI prompt designed to be executed in a Claude Code session.

**Generated:** March 2026
**Based on:** Pre-development advisory resolutions 1.1 through 4.4

---

## How to Use This Document

1. **Work through sessions in order** within each phase. Dependencies are listed on each session file.
2. **Each session is a self-contained Claude Code session block.** Copy the prompt from the `## Prompt` section into a new Claude Code session.
3. **Commit at the end of each session** using the commit message provided.
4. **Test sessions** follow feature sessions — run them after completing the features they test.
5. **Advisory docs are referenced** in prompts. Keep the `docs/advisory-resolutions/` directory intact for context.

---

## Session Index

### Phase 1 — MVP (37 sessions, ~420 tasks)

#### Block 01: Infrastructure & Monorepo Foundation
| Session | Title | Tasks | Dependencies |
|---------|-------|-------|-------------|
| [01.01](phase-1-mvp/01.01-monorepo-init.md) | Monorepo Initialization | 12 | None |
| [01.02](phase-1-mvp/01.02-shared-package.md) | Shared Package Scaffold | 14 | 01.01 |
| [01.03](phase-1-mvp/01.03-docker-supabase.md) | Docker Compose & Self-Hosted Supabase | 11 | 01.01 |
| [01.04](phase-1-mvp/01.04-powersync-config.md) | React Query & Push Notification Foundation | 9 | 01.03 |
| [01.05](phase-1-mvp/01.05-schema-core.md) | Database Schema: Core Tables | 15 | 01.03 |
| [01.06](phase-1-mvp/01.06-schema-extended.md) | Database Schema: Minutes, Templates, Exhibits, Notifications | 13 | 01.05 |
| [01.07](phase-1-mvp/01.07-rls-policies.md) | Row-Level Security Policies | 12 | 01.06 |
| [01.08](phase-1-mvp/01.08-supabase-auth.md) | Supabase Auth Configuration | 9 | 01.07 |

#### Block 02: Web Application Foundation
| Session | Title | Tasks | Dependencies |
|---------|-------|-------|-------------|
| [02.01](phase-1-mvp/02.01-react-web-setup.md) | React Router v7 + Tailwind v4 Web App Setup | 13 | 01.02 |
| [02.02](phase-1-mvp/02.02-powersync-web.md) | React Query Data Layer & Supabase Realtime | 9 | 02.01, 01.04, 01.08 |
| [02.03](phase-1-mvp/02.03-auth-ui.md) | Authentication UI | 10 | 02.02 |

#### Block 03: Onboarding Wizard
| Session | Title | Tasks | Dependencies |
|---------|-------|-------|-------------|
| [03.01](phase-1-mvp/03.01-wizard-framework-stage1.md) | Wizard Framework & Stage 1 (Your Town) | 11 | 02.03 |
| [03.02](phase-1-mvp/03.02-wizard-stages2-3.md) | Wizard Stages 2-3 (Governing Board & Meeting Roles) | 10 | 03.01 |
| [03.03](phase-1-mvp/03.03-wizard-stages4-5-completion.md) | Wizard Stages 4-5 & Completion | 14 | 03.02 |

#### Block 04: Town Profile & Board Management
| Session | Title | Tasks | Dependencies |
|---------|-------|-------|-------------|
| [04.01](phase-1-mvp/04.01-town-dashboard.md) | Town Profile Dashboard | 10 | 03.03 |
| [04.02](phase-1-mvp/04.02-board-management.md) | Board Management | 9 | 04.01 |
| [04.03](phase-1-mvp/04.03-member-management.md) | Member Management | 13 | 04.02 |

#### Block 05: Testing — Foundation & Management
| Session | Title | Tasks | Dependencies |
|---------|-------|-------|-------------|
| [05.01](phase-1-mvp/05.01-test-infrastructure.md) | Test Infrastructure Setup | 10 | 02.02 |
| [05.02](phase-1-mvp/05.02-tests-foundation.md) | Tests: Shared Package, Auth, Onboarding | 12 | 05.01, 03.03, 04.03 |

#### Block 06: Agenda Building
| Session | Title | Tasks | Dependencies |
|---------|-------|-------|-------------|
| [06.01](phase-1-mvp/06.01-agenda-templates.md) | Agenda Template System | 11 | 04.02 |
| [06.02](phase-1-mvp/06.02-meeting-creation-agenda.md) | Meeting Creation & Agenda Building | 14 | 06.01 |
| [06.03](phase-1-mvp/06.03-agenda-packet-pdf.md) | Agenda Packet Generation (Puppeteer) | 10 | 06.02 |

#### Block 07: Live Meeting Manager
| Session | Title | Tasks | Dependencies |
|---------|-------|-------|-------------|
| [07.01](phase-1-mvp/07.01-live-meeting-core.md) | Meeting Session Core: Start, Attendance, Navigation | 14 | 06.02, 02.02 |
| [07.02](phase-1-mvp/07.02-motion-vote-capture.md) | Motion Capture & Vote Recording | 13 | 07.01 |
| [07.03](phase-1-mvp/07.03-exec-session-adjournment.md) | Executive Session, Adjournment & Post-Meeting Review | 11 | 07.02 |

#### Block 08: Testing — Agenda & Meetings
| Session | Title | Tasks | Dependencies |
|---------|-------|-------|-------------|
| [08.01](phase-1-mvp/08.01-tests-agenda-meetings.md) | Tests: Agenda Building & Live Meeting Manager | 12 | 07.03, 05.01 |

#### Block 09: Minutes Generation & Approval
| Session | Title | Tasks | Dependencies |
|---------|-------|-------|-------------|
| [09.01](phase-1-mvp/09.01-minutes-generation.md) | Minutes Generation Pipeline (JSON to HTML to PDF) | 12 | 07.03, 06.03 |
| [09.02](phase-1-mvp/09.02-minutes-review-approval.md) | Minutes Review & Approval Workflow | 11 | 09.01 |

#### Block 10: Public Portal
| Session | Title | Tasks | Dependencies |
|---------|-------|-------|-------------|
| [10.01](phase-1-mvp/10.01-public-portal.md) | Public Portal: Per-Town Subdomain & Content | 13 | 09.02, 01.03 |
| [10.02](phase-1-mvp/10.02-portal-search-seo.md) | Public Portal: Search & SEO | 8 | 10.01 |

#### Block 11: Email Notifications
| Session | Title | Tasks | Dependencies |
|---------|-------|-------|-------------|
| [11.01](phase-1-mvp/11.01-postmark-notifications.md) | Postmark Integration & Notification Event System | 12 | 04.01 |
| [11.02](phase-1-mvp/11.02-email-preferences.md) | Email Preferences & Account Invitation Emails | 8 | 11.01, 04.03 |

#### Block 12: Role-Based Access Control Polish
| Session | Title | Tasks | Dependencies |
|---------|-------|-------|-------------|
| [12.01](phase-1-mvp/12.01-rbac-ui-enforcement.md) | RBAC UI Enforcement & Route Guards | 10 | 04.03, 07.03, 09.02 |

#### Block 13: PWA Configuration
| Session | Title | Tasks | Dependencies |
|---------|-------|-------|-------------|
| [13.01](phase-1-mvp/13.01-pwa-setup.md) | Progressive Web App Setup & Web Push Notifications | 17 | 02.02 |

#### Block 14: Testing — Full Integration
| Session | Title | Tasks | Dependencies |
|---------|-------|-------|-------------|
| [14.01](phase-1-mvp/14.01-tests-full-integration.md) | Tests: Minutes, Portal, Notifications, RBAC, PWA | 14 | 09.02, 10.02, 11.02, 12.01, 13.01 |

#### Block 15: Phase 1 Polish & Deployment
| Session | Title | Tasks | Dependencies |
|---------|-------|-------|-------------|
| [15.01](phase-1-mvp/15.01-phase1-polish.md) | Phase 1 Polish: Error Handling, Loading States, Edge Cases | 10 | 14.01 |
| [15.02](phase-1-mvp/15.02-deployment-config.md) | Deployment Configuration & Production Readiness | 11 | 15.01 |

---

### Phase 2 — Differentiation (11 sessions, ~111 tasks)

#### Block 16: AI Minutes Drafting
| Session | Title | Tasks | Dependencies |
|---------|-------|-------|-------------|
| [16.01](phase-2-differentiation/16.01-claude-api-prompts.md) | Claude API Integration & Prompt Architecture | 11 | 09.01 |
| [16.02](phase-2-differentiation/16.02-ai-minutes-review-ux.md) | AI Minutes Review UX | 9 | 16.01 |

#### Block 17: Audio Recording & Transcription
| Session | Title | Tasks | Dependencies |
|---------|-------|-------|-------------|
| [17.01](phase-2-differentiation/17.01-audio-recording.md) | Single-Device Audio Recording | 10 | 07.03 |
| [17.02](phase-2-differentiation/17.02-transcription.md) | Audio Transcription Integration | 9 | 17.01, 16.01 |

#### Block 18: Warrant Article Workflow
| Session | Title | Tasks | Dependencies |
|---------|-------|-------|-------------|
| [18.01](phase-2-differentiation/18.01-warrant-articles.md) | Warrant Article Data Model & Workflow | 10 | 06.02 |

#### Block 19: SMS Notifications (Twilio)
| Session | Title | Tasks | Dependencies |
|---------|-------|-------|-------------|
| [19.01](phase-2-differentiation/19.01-twilio-sms.md) | Twilio Integration & TCPA Compliance | 12 | 11.01 |

#### Block 20: Civic Engagement
| Session | Title | Tasks | Dependencies |
|---------|-------|-------|-------------|
| [20.01](phase-2-differentiation/20.01-resident-straw-polls.md) | Resident Accounts & Straw Polls | 12 | 10.01, 19.01 |

#### Block 21: React Native Mobile App
| Session | Title | Tasks | Dependencies |
|---------|-------|-------|-------------|
| [21.01](phase-2-differentiation/21.01-react-native-setup.md) | React Native + Expo Setup | 10 | 01.02 |
| [21.02](phase-2-differentiation/21.02-mobile-meeting-audio.md) | Meeting Participation & Audio | 8 | 21.01, 17.01 |

#### Block 22-23: Testing & Deployment
| Session | Title | Tasks | Dependencies |
|---------|-------|-------|-------------|
| [22.01](phase-2-differentiation/22.01-tests-phase2.md) | Tests: All Phase 2 Features | 12 | 16.02, 17.02, 18.01, 19.01, 20.01, 21.02 |
| [23.01](phase-2-differentiation/23.01-phase2-polish-deploy.md) | Phase 2 Integration, Polish & Deployment | 8 | 22.01 |

---

### Phase 3 — Scale (8 sessions, ~68 tasks)

#### Block 24: Parcel Data Integration
| Session | Title | Tasks | Dependencies |
|---------|-------|-------|-------------|
| [24.01](phase-3-scale/24.01-geolibrary-import.md) | Maine GeoLibrary Data Import Pipeline | 11 | 01.05 |
| [24.02](phase-3-scale/24.02-parcel-display-linking.md) | Parcel Display & Agenda Item Linking | 9 | 24.01 |

#### Block 25: Proximity Matching & Notifications
| Session | Title | Tasks | Dependencies |
|---------|-------|-------|-------------|
| [25.01](phase-3-scale/25.01-proximity-matching.md) | Proximity Matching for Residents | 8 | 24.02, 20.01 |
| [25.02](phase-3-scale/25.02-postal-mail.md) | Postal Mail Notifications | 7 | 25.01 |

#### Block 26: Multi-Town Consortiums
| Session | Title | Tasks | Dependencies |
|---------|-------|-------|-------------|
| [26.01](phase-3-scale/26.01-multi-town-consortiums.md) | Multi-Town Management | 8 | 15.02 |

#### Block 27: Advanced Features
| Session | Title | Tasks | Dependencies |
|---------|-------|-------|-------------|
| [27.01](phase-3-scale/27.01-zoning-planning.md) | Advanced Zoning & Planning Features | 8 | 24.02 |

#### Block 28-29: Testing & Deployment
| Session | Title | Tasks | Dependencies |
|---------|-------|-------|-------------|
| [28.01](phase-3-scale/28.01-tests-phase3.md) | Tests: All Phase 3 Features | 10 | 24.02, 25.02, 26.01, 27.01 |
| [29.01](phase-3-scale/29.01-phase3-polish-deploy.md) | Phase 3 Integration, Polish & Deployment | 7 | 28.01 |

---

## Dependency Graph (Critical Path)

```
Phase 1 Critical Path:

01.01 ──> 01.02 ──> 02.01 ──> 02.02 ──> 02.03 ──> 03.01-03 ──> 04.01-03 ──> 06.01-03 ──> 07.01-03 ──> 09.01-02 ──> 10.01-02 ──> 15.01-02
  │                    │                                                         │
  └──> 01.03 ──> 01.04 (React Query + Push foundation) ┘                                                        └──> 08.01 (tests)
         │
         └──> 01.05 ──> 01.06 ──> 01.07 ──> 01.08 ──> 02.02
                                                         │
                                                         └──> 05.01 ──> 05.02
Parallel tracks:
  - 11.01-02 (email) can start after 04.01
  - 12.01 (RBAC) can start after 04.03 + 07.03 + 09.02
  - 13.01 (PWA) can start after 02.02
  - 14.01 (integration tests) waits for all features

Phase 2 builds on Phase 1:
  16.01 (AI minutes) ──> 16.02 ──> 17.02
  17.01 (audio) ──> 17.02, 21.02
  18.01 (warrant) independent after 06.02
  19.01 (SMS) after 11.01
  20.01 (civic) after 10.01 + 19.01
  21.01-02 (mobile) after 01.02

Phase 3 builds on Phase 2:
  24.01-02 (parcels) after 01.05
  25.01-02 (proximity) after 24.02 + 20.01
  26.01 (consortiums) after 15.02
  27.01 (zoning) after 24.02
```

---

## Summary

| Phase | Sessions | Tasks | Description |
|-------|----------|-------|-------------|
| Phase 1 — MVP | 37 | ~420 | Core meeting lifecycle: wizard, agenda, live meetings, minutes, portal, email |
| Phase 2 — Differentiation | 11 | ~111 | AI minutes, audio/transcription, warrants, SMS, civic engagement, mobile |
| Phase 3 — Scale | 8 | ~68 | Parcel data, proximity matching, postal mail, consortiums, zoning |
| **Total** | **56** | **~599** | |
