# Pre-13.01-A: Board Detail Page Tab Refactor

**Depends on:** None (prerequisite for 13.x and 14.x)
**Unlocks:** Board Settings tab used by notice templates (13.x) and minutes workflow overrides (14.x)

---

## Prompt

Refactor the board detail page (`/boards/:boardId`) from a long scrolling page into a tabbed layout. The board detail page has grown to include board info, member roster, and links to meetings and templates. As more settings are added, scrolling becomes impractical.

Add URL-based tab routing so each tab is directly linkable. Introduce a shell Settings tab (empty placeholder) that will be populated by sessions 13.x and 14.x.

---

## Tasks

### Task 1 — Read and map existing board detail page content

Read `packages/web/src/routes/boards.$boardId.tsx` and `packages/web/src/components/boards/MemberRoster.tsx` in full. Document:
- What sections currently exist on the board detail page
- What data is fetched and from which tables
- What actions are available (edit board, add member, etc.)

### Task 2 — Design tab structure

Implement five tabs using URL hash or search params for active tab state (e.g., `?tab=members`). Default tab is `overview`.

| Tab | Route Param | Content |
|-----|-------------|---------|
| Overview | `?tab=overview` | Board name, municipality type, formality, quorum rule, motion format, presiding officer, recording secretary, meeting count summary |
| Members | `?tab=members` | Full MemberRoster component (currently on main page) |
| Meetings | `?tab=meetings` | Link card to `/boards/:boardId/meetings` or inline recent meetings list |
| Templates | `?tab=templates` | Link card to `/boards/:boardId/templates` or inline template list |
| Settings | `?tab=settings` | Placeholder: "Board settings coming soon" — shell only |

### Task 3 — Implement tab navigation component

Create a `BoardTabs` component using Tailwind-styled tab buttons (not a third-party tab library). Active tab highlighted. Tab bar is sticky below the board header.

The board header (name, badge for formality, Edit Board button) remains above the tabs on all views.

### Task 4 — Migrate Overview content

Extract current board info display into the Overview tab. Keep the existing edit board dialog accessible from the header's Edit button.

### Task 5 — Migrate Members tab

Move `MemberRoster` into the Members tab. Ensure the "Add Member" button and all member actions still work.

### Task 6 — Meetings and Templates tabs

Meetings tab: show the 5 most recent/upcoming meetings for this board with a "View all meetings →" link to `/boards/:boardId/meetings`.

Templates tab: show the list of agenda templates for this board with a "Manage templates →" link to `/boards/:boardId/templates`.

### Task 7 — Settings tab shell

Render a placeholder card in the Settings tab:
```
Board Settings
Configure notice templates and minutes workflow for this board.
[Coming soon — settings will appear here]
```

### Task 8 — Update internal navigation links

Update any links elsewhere in the app that point to `/boards/:boardId` to include the appropriate `?tab=` param where relevant (e.g., "Go to Members" should land on `?tab=members`).

### Task 9 — Typecheck and verify

Run `react-router typegen && tsc --noEmit`. Load the board detail page in preview and verify all five tabs render without errors, tab state persists on page reload, and all existing functionality (edit board, add member, etc.) still works.

---

## Verification Checklist

- [ ] All five tabs render
- [ ] Active tab is preserved on page reload (URL-based state)
- [ ] Edit Board dialog still accessible
- [ ] Member roster and all member actions work from Members tab
- [ ] Meetings tab shows recent meetings with link to full list
- [ ] Templates tab shows templates with link to template manager
- [ ] Settings tab shows placeholder (no errors)
- [ ] TypeScript clean
- [ ] No existing tests broken
