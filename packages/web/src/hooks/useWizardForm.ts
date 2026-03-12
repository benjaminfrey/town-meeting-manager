/**
 * Form management hook for wizard stages and dialogs.
 *
 * Now backed by react-hook-form + zodResolver. The PowerSync bundle
 * conflict that previously blocked react-hook-form has been removed.
 *
 * This wrapper preserves the same external API that all 17+ consumers
 * depend on (values, errors, isValid, setValue, handleBlur, validate)
 * so that no JSX changes are needed in consumer components.
 */

import { useCallback, useMemo } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

type FieldErrors<T> = Partial<Record<keyof T, string>>;

/**
 * Duck-typed schema interface compatible with both Zod v3 and v4.
 * The shared package uses Zod v4 while the web package uses v3 —
 * this interface accepts any object with a safeParse method.
 *
 * Uses PropertyKey[] for path to accommodate Zod v4's type (which
 * includes symbol alongside string | number).
 */
interface SafeParseable<T> {
  safeParse(data: unknown):
    | { success: true; data: T }
    | {
        success: false;
        error: { issues: Array<{ path: PropertyKey[]; message: string }> };
      };
}

interface UseWizardFormReturn<T extends Record<string, unknown>> {
  /** Current form values */
  values: T;
  /** Field-level error messages (only for fields that have been validated) */
  errors: FieldErrors<T>;
  /** Whether all fields pass validation */
  isValid: boolean;
  /** Update a single field value. Clears its error if one existed. */
  setValue: <K extends keyof T>(field: K, value: T[K]) => void;
  /** Replace all values at once (e.g., restoring from saved state) */
  setValues: (values: T) => void;
  /** Call on field blur — validates the single field */
  handleBlur: (field: keyof T) => void;
  /** Validate all fields. Returns parsed data if valid, or null if invalid. */
  validate: () => T | null;
}

export function useWizardForm<T extends Record<string, unknown>>(
  schema: SafeParseable<T>,
  initialValues: T
): UseWizardFormReturn<T> {
  const form = useForm<T>({
    // zodResolver expects a ZodSchema — our SafeParseable duck-type is compatible
    resolver: zodResolver(schema as any),
    defaultValues: initialValues as any,
    mode: "onBlur",
  });

  const values = form.watch();

  // Convert react-hook-form's nested errors to flat { field: "message" } shape
  const errors = useMemo(() => {
    const flat: FieldErrors<T> = {};
    const rhfErrors = form.formState.errors;
    for (const key of Object.keys(rhfErrors)) {
      const err = rhfErrors[key as keyof typeof rhfErrors];
      if (err && typeof err === "object" && "message" in err) {
        flat[key as keyof T] = err.message as string;
      }
    }
    return flat;
  }, [form.formState.errors]);

  const isValid = form.formState.isValid;

  const setValue = useCallback(
    <K extends keyof T>(field: K, value: T[K]) => {
      form.setValue(field as any, value as any, {
        shouldValidate: false,
        shouldDirty: true,
      });
      // Clear error for this field (matches original behavior)
      form.clearErrors(field as any);
    },
    [form]
  );

  const setValues = useCallback(
    (newValues: T) => {
      form.reset(newValues as any);
    },
    [form]
  );

  const handleBlur = useCallback(
    (field: keyof T) => {
      form.trigger(field as any);
    },
    [form]
  );

  const validate = useCallback(() => {
    // Synchronous validation using the schema directly — matches original
    // behavior where validate() returns T | null immediately.
    const currentValues = form.getValues();
    const result = schema.safeParse(currentValues);
    if (!result.success) {
      // Set errors on the form for display
      for (const issue of result.error.issues) {
        const field = issue.path[0] as string;
        if (field) {
          form.setError(field as any, { message: issue.message });
        }
      }
      return null;
    }
    form.clearErrors();
    return result.data;
  }, [form, schema]);

  return { values, errors, isValid, setValue, setValues, handleBlur, validate };
}
