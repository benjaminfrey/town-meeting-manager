/**
 * WizardStage5 — "Meeting Style" placeholder.
 * Will be implemented in session 03.03.
 */

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface WizardStage5Props {
  onValidityChange: (isValid: boolean) => void;
  onRegister: (handlers: { validate: () => unknown }) => void;
}

export function WizardStage5({ onValidityChange, onRegister }: WizardStage5Props) {
  onValidityChange(true);
  onRegister({ validate: () => ({}) });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Meeting Style &amp; Minutes</CardTitle>
        <CardDescription>
          Set your default meeting formality and minutes format
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex min-h-[200px] items-center justify-center rounded-lg border-2 border-dashed border-muted-foreground/25">
          <p className="text-sm text-muted-foreground">
            Stage 5: Meeting Style — coming in session 03.03
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
