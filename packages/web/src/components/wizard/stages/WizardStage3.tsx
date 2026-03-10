/**
 * WizardStage3 — "Meeting Roles" placeholder.
 * Will be implemented in session 03.02.
 */

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface WizardStage3Props {
  onValidityChange: (isValid: boolean) => void;
  onRegister: (handlers: { validate: () => unknown }) => void;
}

export function WizardStage3({ onValidityChange, onRegister }: WizardStage3Props) {
  onValidityChange(true);
  onRegister({ validate: () => ({}) });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Who Runs Your Meetings</CardTitle>
        <CardDescription>
          Identify default roles for meeting operations
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex min-h-[200px] items-center justify-center rounded-lg border-2 border-dashed border-muted-foreground/25">
          <p className="text-sm text-muted-foreground">
            Stage 3: Meeting Roles — coming in session 03.02
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
