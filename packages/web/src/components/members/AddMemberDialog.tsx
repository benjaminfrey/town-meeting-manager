/**
 * AddMemberDialog — two-step dialog for adding members to a board.
 *
 * Step 1: Find or create a PERSON (search by name/email)
 * Step 2: Configure account (board member or staff)
 *
 * Enforces mutual exclusivity between staff and board_member roles.
 * Creates PERSON, USER_ACCOUNT, BOARD_MEMBERS, and INVITATION records.
 *
 * ─── Phase E, wave 2, Task 3 — the largest single migration in the wave ───
 *
 * This file made 14 raw Supabase calls (5 reads, 9 writes, counted directly
 * against the pre-migration version) — every one replaced below by a
 * `boardMember`/`person` procedure. See `packages/api/src/trpc/routers/
 * board-member.ts`'s own header for the three hazards this migration closes
 * (the FK-bypasses-RLS checks on `personId`/`boardId`, the permissions
 * matrix's "write exactly what was sent" contract, and the invitation
 * token now generated in the database instead of the browser).
 *
 * Reads: `boardMember.searchCandidates` replaces the four-way merge of
 * `person` search + `user_account` by town + `board_member` active-counts by
 * town + `board_member` active-on-this-board by town; `boardMember
 * .personEmailExists` replaces the fifth (the live email-uniqueness check).
 *
 * Writes: a NEW person is created with `person.insert` FIRST (the same
 * two-step shape `AddPersonDialog` already uses), then the resulting id is
 * handed to `boardMember.addBoardMember` or `boardMember.addStaffMember` —
 * both take an EXISTING `personId` only. See `board-member.ts`'s header for
 * why person creation is not folded into either of those two procedures.
 */

import { useCallback, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/lib/queryKeys";
import { trpc, trpcClient } from "@/lib/trpc";
import { apiFetch } from "@/lib/api-client";
import { Loader2, Search, UserPlus, ChevronLeft } from "lucide-react";
import { z } from "zod";
import { toast } from "sonner";
import { checkRoleMutualExclusivity } from "@town-meeting/shared";
import type { UserRole } from "@town-meeting/shared";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Badge } from "@/components/ui/badge";
import { useWizardForm } from "@/hooks/useWizardForm";
import { BoardMemberConfigForm, type BoardMemberFormData } from "./BoardMemberConfigForm";
import { StaffAccountFlow, type StaffAccountResult } from "./StaffAccountFlow";
import { RoleConflictDialog } from "./RoleConflictDialog";

// ─── Schemas ──────────────────────────────────────────────────────────

const NewPersonSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters").max(100),
  email: z.string().email("Must be a valid email"),
});

type NewPersonData = z.infer<typeof NewPersonSchema>;

const INITIAL_PERSON: NewPersonData = { name: "", email: "" };

// ─── Types ────────────────────────────────────────────────────────────

interface SelectedPerson {
  id: string;
  name: string;
  email: string;
  role: string | null;
  user_account_id: string | null;
  active_board_count: number;
}

interface AddMemberDialogProps {
  boardId: string;
  boardName: string;
  electionMethod: string;
  townId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// ─── Component ────────────────────────────────────────────────────────

export function AddMemberDialog({
  boardId,
  boardName,
  electionMethod,
  townId,
  open,
  onOpenChange,
}: AddMemberDialogProps) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<1 | 2>(1);
  const [searchQuery, setSearchQuery] = useState("");
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [selectedPerson, setSelectedPerson] = useState<SelectedPerson | null>(null);
  const [selectedRole, setSelectedRole] = useState<"board_member" | "staff" | null>(null);
  const [showConflictDialog, setShowConflictDialog] = useState(false);

  // Board member config
  const [bmConfig, setBmConfig] = useState<BoardMemberFormData>({
    seat_title: "",
    term_start: new Date().toISOString().split("T")[0]!,
    term_end: "",
    gov_title: "",
    is_default_rec_sec: false,
  });

  // New person form
  const personForm = useWizardForm(NewPersonSchema, INITIAL_PERSON);

  // ─── Search ─────────────────────────────────────────────────────────
  // `boardMember.searchCandidates` replaces the four-way merge this used to
  // be (`person` search + `user_account` by town + `board_member`
  // active-counts by town + `board_member` active-on-this-board by town) —
  // the server now does the exclusion and the count in one query. `.min(2)`
  // on the procedure's own input mirrors this `enabled` gate, so a caller
  // that bypasses the client cannot force a town-wide scan on an empty or
  // one-character pattern.
  const trimmedSearch = searchQuery.trim();
  const { data: searchResults = [] } = useQuery({
    ...trpc.boardMember.searchCandidates.queryOptions({ boardId, query: trimmedSearch }),
    enabled: trimmedSearch.length >= 2,
  });

  // Check email uniqueness — `boardMember.personEmailExists` replaces the
  // fifth read.
  const emailToCheck = personForm.values.email.toLowerCase().trim();
  const { data: emailExists = false } = useQuery({
    ...trpc.boardMember.personEmailExists.queryOptions({ email: emailToCheck }),
    enabled: !!emailToCheck && emailToCheck.includes("@"),
  });

  // ─── Step 1: Select person ─────────────────────────────────────────
  const handleSelectPerson = (person: SelectedPerson) => {
    setSelectedPerson(person);
    // Pre-select role based on existing account
    if (person.role === "staff") {
      setSelectedRole("staff");
    } else {
      setSelectedRole("board_member");
    }
    setStep(2);
  };

  const handleCreatePerson = () => {
    const data = personForm.validate();
    if (!data || emailExists) return;

    setSelectedPerson({
      id: "", // Will be created
      name: data.name,
      email: data.email.toLowerCase().trim(),
      role: null,
      user_account_id: null,
      active_board_count: 0,
    });
    setSelectedRole("board_member");
    setStep(2);
  };

  // ─── Step 2: Role selection with conflict check ────────────────────
  const handleRoleChange = (role: "board_member" | "staff") => {
    if (selectedPerson?.role) {
      const conflict = checkRoleMutualExclusivity(selectedPerson.role as UserRole, role);
      if (conflict.conflict && selectedPerson.user_account_id) {
        setSelectedRole(role);
        setShowConflictDialog(true);
        return;
      }
    }
    setSelectedRole(role);
  };

  const handleConflictResolved = () => {
    setShowConflictDialog(false);
    // The account was archived, clear the cached role
    if (selectedPerson) {
      setSelectedPerson({
        ...selectedPerson,
        role: null,
        user_account_id: null,
      });
    }
  };

  // `person.insert` — the first step for a brand-new person, shared by both
  // mutations below. See this file's header for why person creation is a
  // separate call rather than folded into `boardMember.addBoardMember`/
  // `.addStaffMember`.
  const { mutateAsync: insertPerson } = useMutation(trpc.person.insert.mutationOptions());

  /** An existing person's id, or a freshly created one for `selectedPerson.id === ""`. */
  async function resolvePersonId(): Promise<string> {
    if (!selectedPerson) throw new Error("No person selected");
    if (selectedPerson.id) return selectedPerson.id;
    const created = await insertPerson({
      name: selectedPerson.name,
      email: selectedPerson.email,
    });
    return created.id;
  }

  // ─── Save board member ─────────────────────────────────────────────
  const { mutate: saveBoardMember, isPending: isSavingBoardMember } = useMutation({
    mutationFn: async () => {
      const personId = await resolvePersonId();
      return trpcClient.boardMember.addBoardMember.mutate({
        personId,
        boardId,
        seatTitle: bmConfig.seat_title.trim() || null,
        termStart: bmConfig.term_start,
        termEnd: bmConfig.term_end || null,
        govTitle: bmConfig.gov_title.trim() || null,
        isDefaultRecSec: bmConfig.is_default_rec_sec,
      });
    },
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.members.byBoard(boardId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.persons.byTown(townId) });
      // `people.tsx` reads person + user_account through `person.list` now
      // (Phase E, wave 1, Task 3); this dialog can create/change both, so it
      // owes that read the same invalidation the legacy key above gets —
      // conventions item 7.
      void queryClient.invalidateQueries(trpc.person.pathFilter());
      // `MemberRoster.tsx` reads its roster through `boardMember.roster` now
      // (this task) — same reasoning, new key.
      void queryClient.invalidateQueries(trpc.boardMember.pathFilter());
      // Fire invitation email (best-effort, non-blocking) — same as the
      // original mutationFn's direct call, now against the id the server
      // handed back rather than one this component generated itself.
      void apiFetch(`/api/invitations/${result.invitationId}/send`, { method: "POST" }).catch(
        () => {
          // Non-critical — admin can resend from member roster
        },
      );
      toast.success(`${result.name} added to ${boardName}`);
      resetAndClose();
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to add board member");
    },
  });

  // ─── Save staff ───────────────────────────────────────────────────
  const { mutate: saveStaff, isPending: isSavingStaff } = useMutation({
    mutationFn: async (staffResult: StaffAccountResult) => {
      const personId = await resolvePersonId();
      return trpcClient.boardMember.addStaffMember.mutate({
        personId,
        govTitle: staffResult.gov_title || null,
        permissions: staffResult.permissions,
      });
    },
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.members.byBoard(boardId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.persons.byTown(townId) });
      // See the sibling `saveBoardMember` mutation's identical comment above.
      void queryClient.invalidateQueries(trpc.person.pathFilter());
      void queryClient.invalidateQueries(trpc.boardMember.pathFilter());
      void apiFetch(`/api/invitations/${result.invitationId}/send`, { method: "POST" }).catch(
        () => {
          // Non-critical — admin can resend from member roster
        },
      );
      toast.success(`${result.name} added as staff`);
      resetAndClose();
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to add staff member");
    },
  });

  const isSaving = isSavingBoardMember || isSavingStaff;

  const handleSaveBoardMember = useCallback(() => {
    saveBoardMember();
  }, [saveBoardMember]);

  const handleSaveStaff = useCallback(
    (staffResult: StaffAccountResult) => {
      saveStaff(staffResult);
    },
    [saveStaff],
  );

  const resetAndClose = () => {
    setStep(1);
    setSearchQuery("");
    setShowCreateForm(false);
    setSelectedPerson(null);
    setSelectedRole(null);
    setBmConfig({
      seat_title: "",
      term_start: new Date().toISOString().split("T")[0]!,
      term_end: "",
      gov_title: "",
      is_default_rec_sec: false,
    });
    personForm.setValues(INITIAL_PERSON);
    onOpenChange(false);
  };

  const conflict =
    selectedPerson?.role && selectedRole
      ? checkRoleMutualExclusivity(selectedPerson.role as UserRole, selectedRole as UserRole)
      : { conflict: false };

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (!o) resetAndClose();
          else onOpenChange(o);
        }}
      >
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{step === 1 ? "Add Member" : "Configure Account"}</DialogTitle>
            <DialogDescription>
              {step === 1
                ? `Search for an existing person or create a new one for ${boardName}.`
                : `Configure ${selectedPerson?.name}'s account.`}
            </DialogDescription>
          </DialogHeader>

          {/* ─── Step 1: Find or Create Person ───────────────────── */}
          {step === 1 && (
            <div className="space-y-4">
              {/* Search */}
              <div className="space-y-1.5">
                <Label>Search by name or email</Label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      setShowCreateForm(false);
                    }}
                    placeholder="Type at least 2 characters..."
                    className="pl-9"
                  />
                </div>
              </div>

              {/* Search results */}
              {trimmedSearch.length >= 2 && searchResults.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">
                    {searchResults.length} result
                    {searchResults.length !== 1 ? "s" : ""}
                  </p>
                  <div className="space-y-1 max-h-[200px] overflow-y-auto">
                    {searchResults.map((person) => (
                      <button
                        key={person.id}
                        type="button"
                        className="w-full text-left rounded-lg border p-3 hover:bg-muted/50 transition-colors cursor-pointer"
                        onClick={() => handleSelectPerson({ ...person, email: person.email ?? "" })}
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="text-sm font-medium">{person.name}</div>
                            <div className="text-xs text-muted-foreground">{person.email}</div>
                          </div>
                          <div className="flex items-center gap-1.5">
                            {person.role && (
                              <Badge variant="outline" className="text-xs">
                                {person.role === "admin"
                                  ? "Admin"
                                  : person.role === "staff"
                                    ? "Staff"
                                    : "Board Member"}
                              </Badge>
                            )}
                            {person.active_board_count > 0 && (
                              <span className="text-xs text-muted-foreground">
                                {person.active_board_count} board
                                {person.active_board_count !== 1 ? "s" : ""}
                              </span>
                            )}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* No results + create option */}
              {trimmedSearch.length >= 2 && searchResults.length === 0 && !showCreateForm && (
                <div className="text-center py-4">
                  <p className="text-sm text-muted-foreground mb-2">No matching people found.</p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setShowCreateForm(true);
                      // Pre-fill name or email from search
                      if (searchQuery.includes("@")) {
                        personForm.setValue("email", searchQuery.trim());
                      } else {
                        personForm.setValue("name", searchQuery.trim());
                      }
                    }}
                  >
                    <UserPlus className="mr-2 h-4 w-4" />
                    Create New Person
                  </Button>
                </div>
              )}

              {/* Create new person button when there are results */}
              {trimmedSearch.length >= 2 && searchResults.length > 0 && !showCreateForm && (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => setShowCreateForm(true)}
                >
                  <UserPlus className="mr-2 h-4 w-4" />
                  Create New Person
                </Button>
              )}

              {/* Create new person form */}
              {showCreateForm && (
                <div className="space-y-3 rounded-lg border p-3">
                  <p className="text-sm font-medium">Create New Person</p>
                  <div className="space-y-1.5">
                    <Label>Name</Label>
                    <Input
                      value={personForm.values.name}
                      onChange={(e) => personForm.setValue("name", e.target.value)}
                      onBlur={() => personForm.handleBlur("name")}
                      placeholder="Full name"
                    />
                    {personForm.errors.name && (
                      <p className="text-xs text-destructive">{personForm.errors.name}</p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label>Email</Label>
                    <Input
                      type="email"
                      value={personForm.values.email}
                      onChange={(e) => personForm.setValue("email", e.target.value)}
                      onBlur={() => personForm.handleBlur("email")}
                      placeholder="email@example.com"
                    />
                    {personForm.errors.email && (
                      <p className="text-xs text-destructive">{personForm.errors.email}</p>
                    )}
                    {emailExists && (
                      <p className="text-xs text-destructive">
                        A person with this email already exists in your town.
                      </p>
                    )}
                  </div>
                  <Button
                    size="sm"
                    onClick={handleCreatePerson}
                    disabled={!personForm.isValid || emailExists}
                  >
                    Continue
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* ─── Step 2: Configure Account ───────────────────────── */}
          {step === 2 && selectedPerson && (
            <div className="space-y-4">
              {/* Person info */}
              <div className="rounded-lg border bg-muted/30 p-3">
                <div className="text-sm font-medium">{selectedPerson.name}</div>
                <div className="text-xs text-muted-foreground">{selectedPerson.email}</div>
              </div>

              {/* Role selection */}
              <div className="space-y-1.5">
                <Label>Role</Label>
                <RadioGroup
                  value={selectedRole ?? ""}
                  onValueChange={(val) => handleRoleChange(val as "board_member" | "staff")}
                  className="flex gap-4"
                >
                  <label className="flex items-center gap-2 cursor-pointer">
                    <RadioGroupItem value="board_member" />
                    <span className="text-sm">Board Member</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <RadioGroupItem value="staff" />
                    <span className="text-sm">Staff</span>
                  </label>
                </RadioGroup>
              </div>

              {/* Board member configuration */}
              {selectedRole === "board_member" && (
                <>
                  <BoardMemberConfigForm
                    values={bmConfig}
                    onChange={setBmConfig}
                    electionMethod={electionMethod}
                  />
                  <DialogFooter>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setStep(1);
                        setSelectedPerson(null);
                      }}
                      disabled={isSaving}
                    >
                      <ChevronLeft className="mr-1 h-3.5 w-3.5" />
                      Back
                    </Button>
                    <Button onClick={handleSaveBoardMember} disabled={isSaving}>
                      {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Add Board Member
                    </Button>
                  </DialogFooter>
                </>
              )}

              {/* Staff configuration */}
              {selectedRole === "staff" && (
                <StaffAccountFlow
                  townId={townId}
                  onComplete={(result) => handleSaveStaff(result)}
                  onBack={() => {
                    setStep(1);
                    setSelectedPerson(null);
                  }}
                />
              )}

              {/* No role selected yet */}
              {!selectedRole && (
                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setStep(1);
                      setSelectedPerson(null);
                    }}
                  >
                    <ChevronLeft className="mr-1 h-3.5 w-3.5" />
                    Back
                  </Button>
                </DialogFooter>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Role conflict dialog */}
      {showConflictDialog && selectedPerson?.user_account_id && conflict.conflict && (
        <RoleConflictDialog
          personName={selectedPerson.name}
          conflict={conflict}
          userAccountId={selectedPerson.user_account_id}
          open={showConflictDialog}
          onOpenChange={setShowConflictDialog}
          onResolved={handleConflictResolved}
        />
      )}
    </>
  );
}
