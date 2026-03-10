/**
 * Lightweight form management hook for wizard stages.
 *
 * Provides react-hook-form-like ergonomics (field-level validation on
 * blur, computed isValid, validate-all on submit) using plain React
 * state + Zod — no external form library needed.
 *
 * We avoid react-hook-form because it creates duplicate React instance
 * errors when @powersync/web is excluded from Vite's dep optimization.
 * This hook provides equivalent functionality for our use case.
 */

import { useCallback, useMemo, useState } from "react";

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
  const [values, setValuesState] = useState<T>(initialValues);
  const [errors, setErrors] = useState<FieldErrors<T>>({});

  const setValue = useCallback(
    <K extends keyof T>(field: K, value: T[K]) => {
      setValuesState((prev) => ({ ...prev, [field]: value }));
      // Clear error for this field so validation re-runs on next blur
      setErrors((prev) => {
        if (!(field in prev)) return prev;
        const next = { ...prev };
        delete next[field];
        return next;
      });
    },
    []
  );

  const setValues = useCallback((newValues: T) => {
    setValuesState(newValues);
    setErrors({});
  }, []);

  const handleBlur = useCallback(
    (field: keyof T) => {
      // Parse the full form to check this specific field
      const result = schema.safeParse(values);
      if (!result.success) {
        const fieldIssue = result.error.issues.find(
          (issue) => issue.path[0] === field
        );
        if (fieldIssue) {
          setErrors((prev) => ({
            ...prev,
            [field]: fieldIssue.message,
          }));
        } else {
          // This field is valid — clear any existing error
          setErrors((prev) => {
            if (!(field in prev)) return prev;
            const next = { ...prev };
            delete next[field];
            return next;
          });
        }
      } else {
        // Entire form is valid — clear this field's error
        setErrors((prev) => {
          if (!(field in prev)) return prev;
          const next = { ...prev };
          delete next[field];
          return next;
        });
      }
    },
    [schema, values]
  );

  const validate = useCallback(() => {
    const result = schema.safeParse(values);
    if (!result.success) {
      const newErrors: FieldErrors<T> = {};
      for (const issue of result.error.issues) {
        const field = issue.path[0] as keyof T;
        if (!newErrors[field]) {
          newErrors[field] = issue.message;
        }
      }
      setErrors(newErrors);
      return null;
    }
    setErrors({});
    return result.data;
  }, [schema, values]);

  const isValid = useMemo(() => schema.safeParse(values).success, [schema, values]);

  return { values, errors, isValid, setValue, setValues, handleBlur, validate };
}
