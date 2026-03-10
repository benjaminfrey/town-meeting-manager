/**
 * WizardStage4 — "Boards & Committees" placeholder.
 * Will be implemented in session 03.03.
 */

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface WizardStage4Props {
  onValidityChange: (isValid: boolean) => void;
  onRegister: (handlers: { validate: () => unknown }) => void;
}

export function WizardStage4({ onValidityChange, onRegister }: WizardStage4Props) {
  onValidityChange(true);
  onRegister({ validate: () => ({}) });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your Boards &amp; Committees</CardTitle>
        <CardDescription>
          Register boards and committees beyond the governing board
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex min-h-[200px] items-center justify-center rounded-lg border-2 border-dashed border-muted-foreground/25">
          <p className="text-sm text-muted-foreground">
            Stage 4: Boards &amp; Committees — coming in session 03.03
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
