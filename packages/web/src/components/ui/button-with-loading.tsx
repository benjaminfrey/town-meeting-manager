import type { ComponentProps } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ButtonWithLoadingProps extends ComponentProps<typeof Button> {
  /** When true, shows a spinner and disables the button */
  loading?: boolean;
  /** Text to show while loading (falls back to children if omitted) */
  loadingText?: string;
}

/**
 * shadcn/ui Button extended with a loading state.
 * Shows a spinner and disables the button during async operations.
 *
 * @example
 * <ButtonWithLoading loading={isPending} loadingText="Saving…" onClick={handleSave}>
 *   Save Changes
 * </ButtonWithLoading>
 */
export function ButtonWithLoading({
  loading = false,
  loadingText,
  disabled,
  children,
  className,
  ...props
}: ButtonWithLoadingProps) {
  return (
    <Button
      disabled={loading || disabled}
      className={cn(className)}
      aria-busy={loading}
      {...props}
    >
      {loading && (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
      )}
      {loading && loadingText ? loadingText : children}
    </Button>
  );
}
