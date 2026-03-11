/**
 * Executive Session Dialog — collects the statutory citation for entering
 * executive session per Maine 1 M.R.S.A. §405(6).
 *
 * The dialog does NOT create DB records — it returns the citation and
 * pre-filled motion text to the parent, which handles the motion/vote flow.
 */

import { useState } from "react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { AlertTriangle, Lock } from "lucide-react";

// Maine 1 M.R.S.A. §405(6) categories
const EXECUTIVE_SESSION_CITATIONS = [
  { letter: "A", short: "Personnel matters", full: "Discussion of the employment, appointment, assignment, duties, promotion, demotion, compensation, evaluation, disciplining, resignation, or dismissal of an official, appointee, or employee" },
  { letter: "B", short: "Student suspension or expulsion", full: "Discussion of suspension or expulsion of a public school student" },
  { letter: "C", short: "Records exemption under FOAA", full: "Discussion of a matter which would be within the scope of the 'executive session' provisions of FOAA if it related to records" },
  { letter: "D", short: "Labor contract negotiations", full: "Discussion of labor contract negotiations, including proposals and counterproposals" },
  { letter: "E", short: "Consultation with legal counsel", full: "Consultations with a municipal attorney concerning pending or contemplated litigation" },
  { letter: "F", short: "Confidential records", full: "Discussion of information contained in records made, maintained, or received by a body or agency when access by the general public to those records is prohibited" },
  { letter: "G", short: "Examination content", full: "Discussion or approval of the content of examinations" },
  { letter: "H", short: "Confidential information", full: "Discussion of information provided to the body in confidence" },
] as const;

interface ExecutiveSessionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onProceed: (citation: string, citationLetter: string, prefillMotionText: string) => void;
}

export function ExecutiveSessionDialog({ open, onOpenChange, onProceed }: ExecutiveSessionDialogProps) {
  const [selectedLetter, setSelectedLetter] = useState<string>("");

  const selected = EXECUTIVE_SESSION_CITATIONS.find(c => c.letter === selectedLetter);
  const citation = selected ? `1 MRSA 405(6)(${selected.letter})` : "";
  const motionText = selected
    ? `to enter Executive Session pursuant to 1 M.R.S.A. Section 405(6)(${selected.letter}) — ${selected.short}`
    : "";

  const handleProceed = () => {
    if (!selected) return;
    onProceed(citation, selected.letter, motionText);
    onOpenChange(false);
    setSelectedLetter("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lock className="h-5 w-5" />
            Enter Executive Session
          </DialogTitle>
          <DialogDescription>
            Select the statutory basis for entering executive session under
            Maine 1 M.R.S.A. §405(6). A legal citation is required.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Motion required warning */}
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-900 dark:bg-amber-950/30">
            <div className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400">
              <AlertTriangle className="h-3.5 w-3.5" />
              A motion to enter executive session is required before proceeding. The motion will be pre-filled after selecting a citation.
            </div>
          </div>

          {/* Citation selection */}
          <div>
            <Label htmlFor="exec-citation">
              Legal Citation <span className="text-destructive">*</span>
            </Label>
            <select
              id="exec-citation"
              className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              value={selectedLetter}
              onChange={(e) => setSelectedLetter(e.target.value)}
            >
              <option value="">Select statutory basis...</option>
              {EXECUTIVE_SESSION_CITATIONS.map((c) => (
                <option key={c.letter} value={c.letter}>
                  ({c.letter}) {c.short}
                </option>
              ))}
            </select>
          </div>

          {/* Full citation text */}
          {selected && (
            <div className="rounded-md border bg-muted/50 px-3 py-2">
              <p className="text-xs font-medium text-muted-foreground mb-1">
                1 M.R.S.A. §405(6)({selected.letter}):
              </p>
              <p className="text-sm">{selected.full}</p>
            </div>
          )}

          {/* Pre-filled motion preview */}
          {selected && (
            <div>
              <Label>Pre-filled Motion Text</Label>
              <p className="mt-1 rounded-md border bg-muted/50 px-3 py-2 text-sm italic">
                {motionText}
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleProceed} disabled={!selectedLetter}>
            Proceed to Motion
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export { EXECUTIVE_SESSION_CITATIONS };
