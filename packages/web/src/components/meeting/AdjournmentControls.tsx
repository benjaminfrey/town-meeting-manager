/**
 * Adjournment Controls — replaces the simple AdjournButton with a
 * dropdown offering both adjournment methods per Q7 advisory decision:
 *
 * 1. "Motion to Adjourn" — formal, goes through motion/vote flow
 * 2. "Adjourn Without Objection" — informal, presiding officer declares
 */

import { useState } from "react";
import { ChevronDown, Gavel, UserCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AdjournWithoutObjectionDialog } from "./AdjournWithoutObjectionDialog";

interface AdjournmentControlsProps {
  presidingOfficerName: string;
  /** Opens MotionCaptureDialog pre-filled for adjournment */
  onAdjournMotion: () => void;
  /** Runs meeting end flow with "without_objection" method */
  onAdjournWithoutObjection: () => void;
}

export function AdjournmentControls({
  presidingOfficerName,
  onAdjournMotion,
  onAdjournWithoutObjection,
}: AdjournmentControlsProps) {
  const [woDialog, setWoDialog] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="outline">
            Adjourn Meeting
            <ChevronDown className="ml-1 h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={onAdjournMotion}>
            <Gavel className="mr-2 h-4 w-4" />
            Motion to Adjourn
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setWoDialog(true)}>
            <UserCheck className="mr-2 h-4 w-4" />
            Adjourn Without Objection
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AdjournWithoutObjectionDialog
        open={woDialog}
        onOpenChange={setWoDialog}
        presidingOfficerName={presidingOfficerName}
        onConfirm={onAdjournWithoutObjection}
      />
    </>
  );
}
