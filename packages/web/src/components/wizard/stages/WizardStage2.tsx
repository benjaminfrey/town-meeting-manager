/**
 * WizardStage2 — "Governing Board" placeholder.
 * Will be implemented in session 03.02.
 */

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface WizardStage2Props {
  onValidityChange: (isValid: boolean) => void;
  onRegister: (handlers: { validate: () => unknown }) => void;
}

export function WizardStage2({ onValidityChange, onRegister }: WizardStage2Props) {
  // Placeholder is always valid — user can pass through
  onValidityChange(true);
  onRegister({ validate: () => ({}) });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your Governing Board</CardTitle>
        <CardDescription>
          Configure your primary governing board (Select Board / Town Council)
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex min-h-[200px] items-center justify-center rounded-lg border-2 border-dashed border-muted-foreground/25">
          <p className="text-sm text-muted-foreground">
            Stage 2: Governing Board — coming in session 03.02
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
