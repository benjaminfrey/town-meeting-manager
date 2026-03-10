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
import { usePowerSync, useQuery } from "@powersync/react";
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
  const powerSync = usePowerSync();
  const [step, setStep] = useState<1 | 2>(1);
  const [searchQuery, setSearchQuery] = useState("");
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [selectedPerson, setSelectedPerson] = useState<SelectedPerson | null>(
    null,
  );
  const [selectedRole, setSelectedRole] = useState<
    "board_member" | "staff" | null
  >(null);
  const [isSaving, setIsSaving] = useState(false);
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

  const { data: personRows } = useQuery(
    searchTerm
      ? "SELECT * FROM persons WHERE town_id = ? AND (name LIKE ? OR email LIKE ?) AND archived_at IS NULL"
      : "SELECT * FROM persons WHERE 1=0",
    searchTerm ? [townId, searchTerm, searchTerm] : [],
  );
  const { data: uaRows } = useQuery(
    "SELECT * FROM user_accounts WHERE town_id = ? AND archived_at IS NULL",
    [townId],
  );
  const { data: bmRows } = useQuery(
    "SELECT person_id, COUNT(*) as count FROM board_members WHERE town_id = ? AND status = 'active' GROUP BY person_id",
    [townId],
  );
  // Check existing membership on this board
  const { data: existingMemberRows } = useQuery(
    "SELECT person_id FROM board_members WHERE board_id = ? AND status = 'active'",
    [boardId],
  );

  const existingMemberPersonIds = useMemo(
    () =>
      new Set(
        ((existingMemberRows ?? []) as Record<string, unknown>[]).map((r) =>
          String(r.person_id),
        ),
      ),
    [existingMemberRows],
  );

  // Build user account lookup
  const uaMap = useMemo(() => {
    const map = new Map<
      string,
      { id: string; role: string; archived_at: string | null }
    >();
    for (const ua of (uaRows ?? []) as Record<string, unknown>[]) {
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
    for (const bm of (bmRows ?? []) as Record<string, unknown>[]) {
      map.set(String(bm.person_id), Number(bm.count));
    }
    return map;
  }, [bmRows]);

  // Search results
  const searchResults: SelectedPerson[] = useMemo(() => {
    return ((personRows ?? []) as Record<string, unknown>[])
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
  const { data: emailCheckRows } = useQuery(
    personForm.values.email.includes("@")
      ? "SELECT id FROM persons WHERE town_id = ? AND email = ? LIMIT 1"
      : "SELECT id FROM persons WHERE 1=0",
    personForm.values.email.includes("@")
      ? [townId, personForm.values.email.toLowerCase().trim()]
      : [],
  );
  const emailExists =
    ((emailCheckRows ?? []) as Record<string, unknown>[]).length > 0;

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
  const handleSaveBoardMember = useCallback(async () => {
    if (!selectedPerson) return;
    setIsSaving(true);
    try {
      const now = new Date().toISOString();
      let personId = selectedPerson.id;

      // Create new person if needed
      if (!personId) {
        personId = crypto.randomUUID();
        await powerSync.execute(
          "INSERT INTO persons (id, town_id, name, email, created_at) VALUES (?, ?, ?, ?, ?)",
          [personId, townId, selectedPerson.name, selectedPerson.email, now],
        );
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

        await powerSync.execute(
          `INSERT INTO user_accounts (id, person_id, town_id, role, gov_title, permissions, auth_user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            userAccountId,
            personId,
            townId,
            "board_member",
            bmConfig.gov_title.trim() || null,
            JSON.stringify(emptyPerms),
            "",
            now,
          ],
        );
      } else if (bmConfig.gov_title.trim()) {
        // Update gov_title on existing account
        await powerSync.execute(
          "UPDATE user_accounts SET gov_title = ? WHERE id = ?",
          [bmConfig.gov_title.trim(), userAccountId],
        );
      }

      // Unset previous default rec sec if needed
      if (bmConfig.is_default_rec_sec) {
        await powerSync.execute(
          "UPDATE board_members SET is_default_rec_sec = 0 WHERE board_id = ? AND is_default_rec_sec = 1",
          [boardId],
        );
      }

      // Create board_members entry
      const bmId = crypto.randomUUID();
      await powerSync.execute(
        `INSERT INTO board_members (id, person_id, board_id, town_id, seat_title, term_start, term_end, status, is_default_rec_sec, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          bmId,
          personId,
          boardId,
          townId,
          bmConfig.seat_title.trim() || null,
          bmConfig.term_start || null,
          bmConfig.term_end || null,
          "active",
          bmConfig.is_default_rec_sec ? 1 : 0,
          now,
        ],
      );

      // Create invitation
      const invId = crypto.randomUUID();
      const token = crypto.randomUUID();
      const expiresAt = new Date(
        Date.now() + 7 * 24 * 60 * 60 * 1000,
      ).toISOString();
      await powerSync.execute(
        `INSERT INTO invitations (id, person_id, user_account_id, town_id, token, expires_at, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [invId, personId, userAccountId, townId, token, expiresAt, "pending", now],
      );

      toast.success(`${selectedPerson.name} added to ${boardName}`);
      resetAndClose();
    } finally {
      setIsSaving(false);
    }
  }, [selectedPerson, bmConfig, boardId, boardName, townId, powerSync]);

  // ─── Save staff ───────────────────────────────────────────────────
  const handleSaveStaff = useCallback(
    async (staffResult: StaffAccountResult) => {
      if (!selectedPerson) return;
      setIsSaving(true);
      try {
        const now = new Date().toISOString();
        let personId = selectedPerson.id;

        // Create new person if needed
        if (!personId) {
          personId = crypto.randomUUID();
          await powerSync.execute(
            "INSERT INTO persons (id, town_id, name, email, created_at) VALUES (?, ?, ?, ?, ?)",
            [personId, townId, selectedPerson.name, selectedPerson.email, now],
          );
        }

        // Create user_account as staff
        const userAccountId = crypto.randomUUID();
        await powerSync.execute(
          `INSERT INTO user_accounts (id, person_id, town_id, role, gov_title, permissions, auth_user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            userAccountId,
            personId,
            townId,
            "staff",
            staffResult.gov_title || null,
            JSON.stringify(staffResult.permissions),
            "",
            now,
          ],
        );

        // Create invitation
        const invId = crypto.randomUUID();
        const token = crypto.randomUUID();
        const expiresAt = new Date(
          Date.now() + 7 * 24 * 60 * 60 * 1000,
        ).toISOString();
        await powerSync.execute(
          `INSERT INTO invitations (id, person_id, user_account_id, town_id, token, expires_at, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            invId,
            personId,
            userAccountId,
            townId,
            token,
            expiresAt,
            "pending",
            now,
          ],
        );

        toast.success(`${selectedPerson.name} added as staff`);
        resetAndClose();
      } finally {
        setIsSaving(false);
      }
    },
    [selectedPerson, townId, powerSync],
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
                      onClick={() => void handleSaveBoardMember()}
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
                  onComplete={(result) => void handleSaveStaff(result)}
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
