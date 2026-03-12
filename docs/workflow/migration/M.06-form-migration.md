# Session M.06 — Form Migration: Replace useWizardForm with react-hook-form

**Phase:** Migration | **Block:** PowerSync → TanStack Query
**Dependencies:** M.02
**Estimated tasks:** 16

---

## Description

Replace the `useWizardForm` hook with standard `react-hook-form` + `zodResolver` in all 14 files that use it. `useWizardForm` was a workaround required because PowerSync's WASM bundle conflicted with react-hook-form's direct import. With PowerSync removed, react-hook-form works normally.

The migration in each file is mechanical: swap the import and the hook call. The Zod schemas and form field JSX remain unchanged.

## Files Modified

**Wizard stages (4 files):**
- `packages/web/src/components/wizard/stages/WizardStage1.tsx`
- `packages/web/src/components/wizard/stages/WizardStage2.tsx`
- `packages/web/src/components/wizard/stages/WizardStage3.tsx`
- `packages/web/src/components/wizard/stages/WizardStage4.tsx`
- `packages/web/src/components/wizard/stages/WizardStage5.tsx`

**Dialog forms (9 files):**
- `packages/web/src/components/meetings/CreateMeetingDialog.tsx`
- `packages/web/src/components/boards/EditBoardDialog.tsx`
- `packages/web/src/components/boards/AddBoardDialog.tsx`
- `packages/web/src/components/meetings/InlineItemForm.tsx`
- `packages/web/src/components/members/AddMemberDialog.tsx`
- `packages/web/src/components/dashboard/MeetingRolesEditor.tsx`
- `packages/web/src/components/dashboard/MeetingDefaultsEditor.tsx`
- `packages/web/src/components/dashboard/TownSettingsEditor.tsx`

## Tasks

1. Read `packages/web/src/hooks/useWizardForm.ts` to understand the hook's API (already deleted in M.05, but the interface is needed to understand callers)
2. Read all 14 files that import useWizardForm to understand current usage patterns
3. Migrate WizardStage1.tsx
4. Migrate WizardStage2.tsx
5. Migrate WizardStage3.tsx
6. Migrate WizardStage4.tsx
7. Migrate WizardStage5.tsx
8. Migrate CreateMeetingDialog.tsx
9. Migrate EditBoardDialog.tsx
10. Migrate AddBoardDialog.tsx
11. Migrate InlineItemForm.tsx
12. Migrate AddMemberDialog.tsx
13. Migrate MeetingRolesEditor.tsx
14. Migrate MeetingDefaultsEditor.tsx
15. Migrate TownSettingsEditor.tsx
16. Verify TypeScript: `pnpm --filter @town-meeting/web tsc --noEmit --skipLibCheck 2>&1 | grep "useWizardForm\|wizard/stages\|CreateMeeting\|EditBoard\|AddBoard\|InlineItem\|AddMember\|MeetingRoles\|MeetingDefaults\|TownSettings"` — expect zero errors

## Prompt

```
You are migrating all useWizardForm usages in the Town Meeting Manager to standard react-hook-form. The useWizardForm hook was a workaround for a PowerSync/react-hook-form bundle conflict. Now that PowerSync has been removed, react-hook-form can be used directly.

PROJECT CONTEXT:
- Monorepo root: /Users/ben/Documents/GitHub/town-meeting-manager/
- Web package: packages/web/
- react-hook-form and @hookform/resolvers were installed in M.01
- Zod is already installed (used for schema validation throughout)
- The useWizardForm hook was deleted in M.05

THE MIGRATION PATTERN:

Old code (useWizardForm):
```typescript
import { useWizardForm } from '@/hooks/useWizardForm';
import { mySchema, type MyFormValues } from '@town-meeting/shared/schemas';

const { form, handleSubmit, isSubmitting } = useWizardForm({
  schema: mySchema,
  defaultValues: { field1: '', field2: '' },
  onSubmit: async (values) => {
    // handle submit
  },
});

// In JSX:
<form onSubmit={handleSubmit}>
  <Input {...form.register('field1')} />
  {form.formState.errors.field1 && <p>{form.formState.errors.field1.message}</p>}
  <Button type="submit" disabled={isSubmitting}>Save</Button>
</form>
```

New code (react-hook-form):
```typescript
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { mySchema, type MyFormValues } from '@town-meeting/shared/schemas';

const form = useForm<MyFormValues>({
  resolver: zodResolver(mySchema),
  defaultValues: { field1: '', field2: '' },
});

const onSubmit = form.handleSubmit(async (values) => {
  // handle submit (same logic as before)
});

const isSubmitting = form.formState.isSubmitting;

// In JSX:
<form onSubmit={onSubmit}>
  <Input {...form.register('field1')} />
  {form.formState.errors.field1 && <p>{form.formState.errors.field1.message}</p>}
  <Button type="submit" disabled={isSubmitting}>Save</Button>
</form>
```

IMPORTANT DIFFERENCES:
1. `useForm` is called directly instead of the wrapper hook
2. `handleSubmit` is now `form.handleSubmit(asyncFn)` — call it to get the event handler
3. `isSubmitting` is now `form.formState.isSubmitting` — not a separate destructured value
4. The schema is passed as `resolver: zodResolver(schema)` instead of `schema: schema`
5. Zod `.transform()` is now safe to use — the PowerSync constraint is gone

STEP-BY-STEP FOR EACH FILE:

For each of the 14 files:

1. Read the file in full
2. Note the exact destructured values from useWizardForm (they vary per file)
3. Apply the migration:
   a. Change import: remove `useWizardForm` import, add `useForm` from 'react-hook-form' and `zodResolver` from '@hookform/resolvers/zod'
   b. Change hook call: `useWizardForm({ schema, defaultValues, onSubmit })` → `useForm<Schema>({ resolver: zodResolver(schema), defaultValues })`
   c. Extract the submit handler: `const onSubmit = form.handleSubmit(async (values) => { ... })`
   d. Update references: `isSubmitting` → `form.formState.isSubmitting`, `handleSubmit` → `onSubmit`
   e. The submit logic (what happens with the form values) stays exactly the same — only the form API call changes
4. Preserve all JSX, form field registration, error display, and dialog/sheet logic unchanged

WIZARD STAGE FILES (packages/web/src/components/wizard/stages/):

These files use useWizardForm with a WizardContext or parent-controlled submission. Read WizardProvider.tsx and the stage files carefully to understand the submission flow before migrating. The key patterns:
- WizardStages likely receive `onNext: (values) => void` or `onComplete` props
- The form may be controlled by a parent WizardProvider that collects data across steps
- Preserve the multi-step wizard coordination logic exactly as-is
- Only change the form hook API

DIALOG FILES (packages/web/src/components/):

These are self-contained dialogs with their own forms. Each:
- Has a schema import from @town-meeting/shared
- Calls useWizardForm with the schema and onSubmit handler
- The onSubmit calls powersync.execute() — those will be migrated in M.08
- For this session, only migrate the form hook part; leave the submit body (powersync.execute calls) unchanged even though they'll fail — they'll be fixed in M.08

HANDLING FORM FIELD REGISTRATION:

If the file uses the Form components from shadcn/ui (`<Form>`, `<FormField>`, `<FormItem>`, `<FormLabel>`, `<FormControl>`, `<FormMessage>`), these work with the react-hook-form `form` object. No changes needed to the JSX Form component structure — just update the `form` prop:

```tsx
// Old
<Form {...form.formState}>
// New (if using shadcn Form)
<Form {...form}> // or however the Form component is used — read shadcn usage in the file
```

If the file uses raw `<form>` element with `form.register()`, no JSX changes needed.

IMPORTANT: Do NOT change the submit body logic (the powersync.execute calls, Supabase calls, or anything that happens when the form is submitted). Only change the form hook setup at the top of the component. The submit body will be migrated in M.08.

VERIFICATION CHECKLIST:
1. No file in the 14 imports useWizardForm after migration
2. All 14 files import useForm from 'react-hook-form'
3. All 14 files import zodResolver from '@hookform/resolvers/zod'
4. The form.handleSubmit(asyncFn) pattern is used everywhere (not direct function call)
5. isSubmitting references use form.formState.isSubmitting
6. Wizard stage coordination logic is preserved
7. TypeScript check: `pnpm --filter @town-meeting/web tsc --noEmit --skipLibCheck 2>&1 | grep "useWizardForm"` — should return no matches (the hook no longer exists)
```

## Commit Message

```
M.06: Replace useWizardForm with react-hook-form in all 14 form files
```
