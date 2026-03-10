import type {
  BoardMemberStatus,
  UserRole,
} from "../constants/enums.js";
import type { PermissionsMatrix } from "../constants/permissions.js";

/** PERSON — the identity anchor entity */
export interface Person {
  id: string;
  town_id: string;
  name: string;
  email: string;
  created_at: string;
  archived_at: string | null;
}

/** USER_ACCOUNT — app login linked to a PERSON (0..1) */
export interface UserAccount {
  id: string;
  person_id: string;
  town_id: string;
  role: UserRole;
  gov_title: string | null;
  permissions: PermissionsMatrix;
  auth_user_id: string;
  created_at: string;
  archived_at: string | null;
}

/** BOARD_MEMBER — board membership linked to a PERSON (0..many) */
export interface BoardMember {
  id: string;
  person_id: string;
  board_id: string;
  town_id: string;
  seat_title: string | null;
  term_start: string;
  term_end: string | null;
  status: BoardMemberStatus;
  is_default_rec_sec: boolean;
  created_at: string;
}

/** INVITATION — account invitation linked to a PERSON + USER_ACCOUNT */
export interface Invitation {
  id: string;
  person_id: string;
  user_account_id: string;
  town_id: string;
  token: string;
  expires_at: string;
  status: "pending" | "accepted" | "expired";
  created_at: string;
}

/** RESIDENT_ACCOUNT — civic engagement account linked to a PERSON (0..1) */
export interface ResidentAccount {
  id: string;
  person_id: string;
  town_id: string;
  notification_preferences: Record<string, unknown>;
  created_at: string;
  archived_at: string | null;
}
