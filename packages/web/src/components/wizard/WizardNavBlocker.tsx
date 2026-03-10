/**
 * WizardNavBlocker — intercepts navigation away from the wizard.
 *
 * Two interception mechanisms:
 * 1. beforeunload event — catches tab close / browser refresh
 * 2. React Router useBlocker — catches in-app navigation away from /setup
 *
 * When in-app navigation is blocked, shows a confirmation dialog.
 * Navigation between wizard stages (/setup → /setup) is NOT blocked.
 */

import { useEffect } from "react";
import { useBlocker } from "react-router";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function WizardNavBlocker() {
  // ─── Browser tab close / refresh ──────────────────────────────────
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Modern browsers show their own "Leave site?" dialog
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  // ─── In-app navigation away from /setup ───────────────────────────
  const blocker = useBlocker(({ currentLocation, nextLocation }) => {
    // Only block when leaving /setup, not when navigating within it
    return (
      currentLocation.pathname.startsWith("/setup") &&
      !nextLocation.pathname.startsWith("/setup")
    );
  });

  return (
    <Dialog
      open={blocker.state === "blocked"}
      onOpenChange={(open) => {
        if (!open && blocker.state === "blocked") {
          blocker.reset();
        }
      }}
    >
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Leave setup?</DialogTitle>
          <DialogDescription>
            If you leave, your setup progress will be lost. Are you sure?
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => blocker.state === "blocked" && blocker.reset()}
          >
            Stay
          </Button>
          <Button
            variant="destructive"
            onClick={() => blocker.state === "blocked" && blocker.proceed()}
          >
            Leave
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
