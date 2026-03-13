# Pre-13.01-B: Notice Compliance Engine (Shared Library)

**Depends on:** Pre-13.01-A (board tabs — can run in parallel, no dependency)
**Unlocks:** Session 13.x (Meeting Notice Template System)
**See also:** Advisory 3.4 — Meeting Notice Template System & Compliance Engine

---

## Prompt

Build a pure TypeScript notice compliance engine in `packages/shared/src/notice-rules/`. This library has no UI — it provides:

1. A structured database of state-specific meeting notice rules (Maine primary; NH/VT/MA stubs)
2. A deadline calculator: given a meeting date and type, returns the latest date by which notice must be posted, with urgency level
3. A forecast calculator: given today's date and a desired meeting type, returns the earliest possible meeting date

The engine is **advisory only** — it returns guidance data; enforcement is the UI's responsibility.

**See Advisory 3.4 §4 for the complete data model, types, and API specification.**

---

## Tasks

### Task 1 — Create package structure

Create the following files in `packages/shared/src/notice-rules/`:

```
index.ts          — public exports
types.ts          — NoticeRule, ComplianceResult, ForecastResult interfaces
rules/
  maine.ts        — Maine rule dataset
  new-hampshire.ts — NH stubs
  vermont.ts      — VT stubs
  index.ts        — state registry (getRulesForState)
calculator.ts     — getNoticeDeadline, forecastEarliestMeetingDate
formatter.ts      — human-readable strings (advisoryMessage, explanation)
```

Export everything from `packages/shared/src/index.ts` under the `noticeRules` namespace.

### Task 2 — Define types

In `types.ts`, implement the full type definitions from Advisory 3.4 §4.2:
- `NoticeRule` interface
- `ComplianceResult` interface (includes `warningLevel: 'ok' | 'warning' | 'danger' | 'overdue'`)
- `ForecastResult` interface
- `MeetingType` union type (must match existing `meeting_type` enum values in the DB: `regular`, `special`, `annual_town_meeting`, `special_town_meeting`, `public_hearing`, `workshop`, `emergency`)

### Task 3 — Maine rule dataset

In `rules/maine.ts`, implement the Maine rules from Advisory 3.4 §4.3. Include the legal review disclaimer as a code comment.

Rules to implement:
- `ME_OPEN_MEETINGS_BOARD` — 24 hours, all board meetings, 1 M.R.S.A. §403
- `ME_TOWN_MEETING_WARRANT` — 14 calendar days, annual_town_meeting, 30-A M.R.S.A. §2521
- `ME_SPECIAL_TOWN_MEETING` — 14 calendar days, special_town_meeting, 30-A M.R.S.A. §2521
- `ME_ZONING_ORDINANCE_HEARING` — 14 calendar days, public_hearing with actionType `zoning_ordinance`, 30-A M.R.S.A. §4352
- `ME_SUBDIVISION_HEARING` — 14 calendar days, public_hearing with actionType `subdivision`, 30-A M.R.S.A. §4403
- `ME_BUDGET_COMMITTEE` — 10 calendar days, public_hearing with actionType `budget`, 30-A M.R.S.A. §2902

### Task 4 — State registry

In `rules/index.ts`, implement `getRulesForState(state: string): NoticeRule[]` that returns the appropriate rule set. Stubs for NH/VT return empty arrays with a console warning in development.

### Task 5 — Deadline calculator

In `calculator.ts`, implement:

```typescript
function getNoticeDeadline(params: {
  meetingDate: Date;
  meetingTime?: string;
  state: string;
  meetingType: MeetingType;
  actionTypes?: string[];
}): ComplianceResult
```

Logic:
1. Get applicable rules via `getRulesForState` filtered by `meetingType` and `actionTypes`
2. Find the rule with the largest notice requirement (most restrictive)
3. Calculate deadline: `meetingDate - minimumNoticeDays` (calendar days) or `meetingDateTime - minimumNoticeHours`
4. Calculate `daysUntilDeadline` from `now()`
5. Set `warningLevel`:
   - `ok`: > 3 days until deadline
   - `warning`: 1–3 days until deadline
   - `danger`: < 24 hours until deadline, but not yet overdue
   - `overdue`: deadline has passed

### Task 6 — Forecast calculator

In `calculator.ts`, implement:

```typescript
function forecastEarliestMeetingDate(params: {
  fromDate: Date;
  state: string;
  meetingType: MeetingType;
  actionTypes?: string[];
}): ForecastResult
```

Logic:
1. Get applicable rules
2. Find most restrictive rule
3. `earliestMeetingDate = fromDate + minimumNoticeDays` (calendar days)
4. Return with human-readable `explanation` string

### Task 7 — Formatter

In `formatter.ts`, implement helpers:
- `formatAdvisoryMessage(result: ComplianceResult): string` — e.g., "Notice must be posted by March 14 (2 days from now) per 1 M.R.S.A. §403"
- `formatForecastExplanation(result: ForecastResult): string` — e.g., "A special town meeting regarding a land use ordinance requires 14 days notice per 30-A M.R.S.A. §4352. If notice is posted today (March 12), the earliest meeting date is March 26."

### Task 8 — Export from shared package

Add to `packages/shared/src/index.ts`:
```typescript
export * from './notice-rules/index.js';
```

Run `npx turbo run build --filter=@town-meeting/shared` to verify the build passes.

### Task 9 — Unit tests

Write unit tests in `packages/shared/src/notice-rules/__tests__/calculator.test.ts`:

Test cases:
- Regular board meeting: 24-hour rule, various urgency levels
- Special town meeting: 14-day rule
- Zoning ordinance hearing with actionType
- Deadline already overdue
- Forecast: earliest date for special town meeting
- Forecast: earliest date for zoning hearing with actionType

Use Vitest. Run `npm test --filter=@town-meeting/shared` and verify all pass.

---

## Verification Checklist

- [ ] All rule types and interfaces in `types.ts`
- [ ] Maine rules dataset complete with 6 rules
- [ ] State registry returns correct rules by state
- [ ] `getNoticeDeadline` returns correct deadline for each rule type
- [ ] `warningLevel` correct for all urgency thresholds
- [ ] `forecastEarliestMeetingDate` returns correct earliest date
- [ ] Formatter produces readable strings
- [ ] Package builds cleanly
- [ ] All unit tests pass
- [ ] Exported from shared package index
