/**
 * AddMemberDialog — two-step dialog for adding members to a board.
 *
 * Step 1: Find or create a PERSON (search by name/email)
 * Step 2: Configure account (board member or staff)
 *
 * Enforces mutual exclusivity between staff and board_member roles.
 * Creates PERSON, USER_ACCOUNT, BOARD_MEMBERS, and INVITATION records.
 */

import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSupabase } from "@/hooks/useSupabase";

const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:3001";
import { queryKeys } from "@/lib/queryKeys";
import { Loader2, Search, UserPlus, ChevronLeft } from "lucide-react";
import { z } from "zod";
import { toast } from "sonner";
import {
  checkRoleMutualExclusivity,
  ALL_PERMISSION_ACTIONS,
} from "@town-meeting/shared";
import type { PermissionAction, PermissionsMatrix, UserRole } from "@town-meeting/shared";
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
import {
  BoardMemberConfigForm,
  type BoardMemberFormData,
} from "./BoardMemberConfigForm";
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
  const supabase = useSupabase();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<1 | 2>(1);
  const [searchQuery, setSearchQuery] = useState("");
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [selectedPerson, setSelectedPerson] = useState<SelectedPerson | null>(
    null,
  );
  const [selectedRole, setSelectedRole] = useState<
    "board_member" | "staff" | null
  >(null);
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
  const searchTerm = searchQuery.trim().length >= 2 ? `%${searchQuery.trim()}%` : "";

  const { data: personRows = [] } = useQuery({
    queryKey: [...queryKeys.persons.byTown(townId), 'search', searchTerm],
    queryFn: async () => {
      const term = searchQuery.trim();
      const { data, error } = await supabase
        .from('person')
        .select('*')
        .eq('town_id', townId)
        .is('archived_at', null)
        .or(`name.ilike.%${term}%,email.ilike.%${term}%`);
      if (error) throw error;
      return data;
    },
    enabled: !!searchTerm,
  });

  const { data: uaRows = [] } = useQuery({
    queryKey: queryKeys.userAccounts.byTown(townId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_account')
        .select('*')
        .eq('town_id', townId)
        .is('archived_at', null);
      if (error) throw error;
      return data;
    },
    enabled: !!townId,
  });

  const { data: bmRows = [] } = useQuery({
    queryKey: [...queryKeys.members.all, 'activeCounts', townId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('board_member')
        .select('person_id')
        .eq('town_id', townId)
        .eq('status', 'active');
      if (error) throw error;
      return data;
    },
    enabled: !!townId,
  });

  // Check existing membership on this board
  const { data: existingMemberRows = [] } = useQuery({
    queryKey: [...queryKeys.members.byBoard(boardId), 'personIds'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('board_member')
        .select('person_id')
        .eq('board_id', boardId)
        .eq('status', 'active');
      if (error) throw error;
      return data;
    },
    enabled: !!boardId,
  });

  const existingMemberPersonIds = useMemo(
    () =>
      new Set(
        existingMemberRows.map((r) => String(r.person_id)),
      ),
    [existingMemberRows],
  );

  // Build user account lookup
  const uaMap = useMemo(() => {
    const map = new Map<
      string,
      { id: string; role: string; archived_at: string | null }
    >();
    for (const ua of uaRows) {
      map.set(String(ua.person_id), {
        id: String(ua.id),
        role: String(ua.role ?? ""),
        archived_at: (ua.archived_at as string) || null,
      });
    }
    return map;
  }, [uaRows]);

  // Build board member count lookup
  const bmCountMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const bm of bmRows) {
      const personId = String(bm.person_id);
      map.set(personId, (map.get(personId) ?? 0) + 1);
    }
    return map;
  }, [bmRows]);

  // Search results
  const searchResults: SelectedPerson[] = useMemo(() => {
    return personRows
      .filter((p) => !existingMemberPersonIds.has(String(p.id)))
      .map((p) => {
        const personId = String(p.id);
        const ua = uaMap.get(personId);
        return {
          id: personId,
          name: String(p.name ?? ""),
          email: String(p.email ?? ""),
          role: ua?.role ?? null,
          user_account_id: ua?.id ?? null,
          active_board_count: bmCountMap.get(personId) ?? 0,
        };
      });
  }, [personRows, uaMap, bmCountMap, existingMemberPersonIds]);

  // Check email uniqueness
  const emailToCheck = personForm.values.email.toLowerCase().trim();
  const { data: emailCheckRows = [] } = useQuery({
    queryKey: [...queryKeys.persons.byTown(townId), 'emailCheck', emailToCheck],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('person')
        .select('id')
        .eq('town_id', townId)
        .eq('email', emailToCheck)
        .limit(1);
      if (error) throw error;
      return data;
    },
    enabled: !!emailToCheck && emailToCheck.includes('@'),
  });
  const emailExists = emailCheckRows.length > 0;

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

  // ─── Save board member ─────────────────────────────────────────────
  const { mutate: saveBoardMember, isPending: isSavingBoardMember } = useMutation({
    mutationFn: async () => {
      if (!selectedPerson) throw new Error("No person selected");
      const now = new Date().toISOString();
      let personId = selectedPerson.id;

      // Create new person if needed
      if (!personId) {
        personId = crypto.randomUUID();
        const { error } = await supabase.from('person').insert({
          id: personId,
          town_id: townId,
          name: selectedPerson.name,
          email: selectedPerson.email,
          created_at: now,
        });
        if (error) throw error;
      }

      // Create or update user_account
      let userAccountId = selectedPerson.user_account_id;
      if (!userAccountId) {
        userAccountId = crypto.randomUUID();
        const emptyPerms: PermissionsMatrix = {
          global: {} as Record<PermissionAction, boolean>,
          board_overrides: [],
        };
        // Initialize all to false
        for (const action of ALL_PERMISSION_ACTIONS) {
          emptyPerms.global[action] = false;
        }

        const { error } = await supabase.from('user_account').insert({
          id: userAccountId,
          person_id: personId,
          town_id: townId,
          role: "board_member",
          gov_title: bmConfig.gov_title.trim() || null,
          permissions: emptyPerms,
          auth_user_id: "",
          created_at: now,
        });
        if (error) throw error;
      } else if (bmConfig.gov_title.trim()) {
        // Update gov_title on existing account
        const { error } = await supabase
          .from('user_account')
          .update({ gov_title: bmConfig.gov_title.trim() })
          .eq('id', userAccountId);
        if (error) throw error;
      }

      // Unset previous default rec sec if needed
      if (bmConfig.is_default_rec_sec) {
        const { error } = await supabase
          .from('board_member')
          .update({ is_default_rec_sec: false })
          .eq('board_id', boardId)
          .eq('is_default_rec_sec', true);
        if (error) throw error;
      }

      // Create board_members entry
      const bmId = crypto.randomUUID();
      const { error: bmError } = await supabase.from('board_member').insert({
        id: bmId,
        person_id: personId,
        board_id: boardId,
        town_id: townId,
        seat_title: bmConfig.seat_title.trim() || null,
        term_start: bmConfig.term_start || null,
        term_end: bmConfig.term_end || null,
        status: "active",
        is_default_rec_sec: bmConfig.is_default_rec_sec,
        created_at: now,
      });
      if (bmError) throw bmError;

      // Create invitation
      const invId = crypto.randomUUID();
      const token = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      const { error: invError } = await supabase.from('invitation').insert({
        id: invId,
        person_id: personId,
        user_account_id: userAccountId,
        town_id: townId,
        token,
        expires_at: expiresAt,
        status: "pending",
        created_at: now,
      });
      if (invError) throw invError;

      // Fire invitation email (best-effort, non-blocking)
      void (async () => {
        try {
          const { data: sessionData } = await supabase.auth.getSession();
          const accessToken = sessionData?.session?.access_token;
          if (accessToken) {
            await fetch(`${API_BASE}/api/invitations/${invId}/send`, {
              method: "POST",
              headers: { Authorization: `Bearer ${accessToken}` },
            });
          }
        } catch {
          // Non-critical — admin can resend from member roster
        }
      })();

      return selectedPerson.name;
    },
    onSuccess: (name) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.members.byBoard(boardId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.persons.byTown(townId) });
      toast.success(`${name} added to ${boardName}`);
      resetAndClose();
    },
  });

  // ─── Save staff ───────────────────────────────────────────────────
  const { mutate: saveStaff, isPending: isSavingStaff } = useMutation({
    mutationFn: async (staffResult: StaffAccountResult) => {
      if (!selectedPerson) throw new Error("No person selected");
      const now = new Date().toISOString();
      let personId = selectedPerson.id;

      // Create new person if needed
      if (!personId) {
        personId = crypto.randomUUID();
        const { error } = await supabase.from('person').insert({
          id: personId,
          town_id: townId,
          name: selectedPerson.name,
          email: selectedPerson.email,
          created_at: now,
        });
        if (error) throw error;
      }

      // Create user_account as staff
      const userAccountId = crypto.randomUUID();
      const { error: uaError } = await supabase.from('user_account').insert({
        id: userAccountId,
        person_id: personId,
        town_id: townId,
        role: "staff",
        gov_title: staffResult.gov_title || null,
        permissions: staffResult.permissions,
        auth_user_id: "",
        created_at: now,
      });
      if (uaError) throw uaError;

      // Create invitation
      const invId = crypto.randomUUID();
      const token = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      const { error: invError } = await supabase.from('invitation').insert({
        id: invId,
        person_id: personId,
        user_account_id: userAccountId,
        town_id: townId,
        token,
        expires_at: expiresAt,
        status: "pending",
        created_at: now,
      });
      if (invError) throw invError;

      // Fire invitation email (best-effort, non-blocking)
      void (async () => {
        try {
          const { data: sessionData } = await supabase.auth.getSession();
          const accessToken = sessionData?.session?.access_token;
          if (accessToken) {
            await fetch(`${API_BASE}/api/invitations/${invId}/send`, {
              method: "POST",
              headers: { Authorization: `Bearer ${accessToken}` },
            });
          }
        } catch {
          // Non-critical — admin can resend from member roster
        }
      })();

      return selectedPerson.name;
    },
    onSuccess: (name) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.members.byBoard(boardId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.persons.byTown(townId) });
      toast.success(`${name} added as staff`);
      resetAndClose();
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
            <DialogTitle>
              {step === 1 ? "Add Member" : "Configure Account"}
            </DialogTitle>
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
              {searchTerm && searchResults.length > 0 && (
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
                        onClick={() => handleSelectPerson(person)}
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="text-sm font-medium">
                              {person.name}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {person.email}
                            </div>
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
              {searchTerm && searchResults.length === 0 && !showCreateForm && (
                <div className="text-center py-4">
                  <p className="text-sm text-muted-foreground mb-2">
                    No matching people found.
                  </p>
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
              {searchTerm && searchResults.length > 0 && !showCreateForm && (
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
                      onChange={(e) =>
                        personForm.setValue("name", e.target.value)
                      }
                      onBlur={() => personForm.handleBlur("name")}
                      placeholder="Full name"
                    />
                    {personForm.errors.name && (
                      <p className="text-xs text-destructive">
                        {personForm.errors.name}
                      </p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label>Email</Label>
                    <Input
                      type="email"
                      value={personForm.values.email}
                      onChange={(e) =>
                        personForm.setValue("email", e.target.value)
                      }
                      onBlur={() => personForm.handleBlur("email")}
                      placeholder="email@example.com"
                    />
                    {personForm.errors.email && (
                      <p className="text-xs text-destructive">
                        {personForm.errors.email}
                      </p>
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
                <div className="text-xs text-muted-foreground">
                  {selectedPerson.email}
                </div>
              </div>

              {/* Role selection */}
              <div className="space-y-1.5">
                <Label>Role</Label>
                <RadioGroup
                  value={selectedRole ?? ""}
                  onValueChange={(val) =>
                    handleRoleChange(val as "board_member" | "staff")
                  }
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
                    <Button
                      onClick={handleSaveBoardMember}
                      disabled={isSaving}
                    >
                      {isSaving && (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      )}
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
      {showConflictDialog &&
        selectedPerson?.user_account_id &&
        conflict.conflict && (
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
