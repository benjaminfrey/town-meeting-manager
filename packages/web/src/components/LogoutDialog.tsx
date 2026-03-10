/**
 * Logout confirmation dialog with unsynced changes warning.
 *
 * If there are pending local changes in the PowerSync upload queue,
 * the dialog warns the user that signing out will discard them.
 */

import { useState } from "react";
import { useNavigate } from "react-router";
import { useQuery } from "@powersync/react";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/providers/AuthProvider";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface LogoutDialogProps {
  trigger: React.ReactNode;
}

export function LogoutDialog({ trigger }: LogoutDialogProps) {
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const [isSigningOut, setIsSigningOut] = useState(false);

  // Check for pending uploads in the PowerSync CRUD queue
  const { data: crudCount } = useQuery(
    "SELECT count(*) as count FROM ps_crud"
  );
  const pendingUploads = crudCount?.[0]?.count ?? 0;

  const handleSignOut = async () => {
    setIsSigningOut(true);
    try {
      await signOut();
      navigate("/login", { replace: true });
    } catch (error) {
      console.error("Failed to sign out:", error);
      setIsSigningOut(false);
    }
  };

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Sign out?</AlertDialogTitle>
          <AlertDialogDescription>
            {pendingUploads > 0 ? (
              <>
                You have{" "}
                <span className="font-medium text-foreground">
                  {pendingUploads} unsynced{" "}
                  {pendingUploads === 1 ? "change" : "changes"}
                </span>
                . Signing out will discard them. Are you sure?
              </>
            ) : (
              "Are you sure you want to sign out? Any unsynced changes will be lost."
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isSigningOut}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleSignOut}
            disabled={isSigningOut}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {isSigningOut ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Signing out...
              </>
            ) : (
              "Sign out"
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
