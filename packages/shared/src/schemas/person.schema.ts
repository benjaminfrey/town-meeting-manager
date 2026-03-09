import { z } from "zod";
import { BoardMemberStatus, UserRole } from "../constants/enums.js";

export const PersonSchema = z.object({
  id: z.string().uuid(),
  town_id: z.string().uuid(),
  name: z.string().min(2).max(100),
  email: z.string().email(),
  created_at: z.string().datetime(),
  archived_at: z.string().datetime().nullable(),
});

export const CreatePersonSchema = PersonSchema.omit({
  id: true,
  created_at: true,
  archived_at: true,
});

export const UserAccountSchema = z.object({
  id: z.string().uuid(),
  person_id: z.string().uuid(),
  town_id: z.string().uuid(),
  role: z.enum([
    UserRole.SYS_ADMIN,
    UserRole.ADMIN,
    UserRole.STAFF,
    UserRole.BOARD_MEMBER,
  ]),
  gov_title: z.string().max(100).nullable(),
  permissions: z.object({
    global: z.record(z.string(), z.boolean()),
    board_overrides: z.array(
      z.object({
        board_id: z.string().uuid(),
        permissions: z.record(z.string(), z.boolean()),
      }),
    ),
  }),
  auth_user_id: z.string().uuid(),
  created_at: z.string().datetime(),
  archived_at: z.string().datetime().nullable(),
});

export const CreateUserAccountSchema = UserAccountSchema.omit({
  id: true,
  created_at: true,
  archived_at: true,
});

export const BoardMemberSchema = z.object({
  id: z.string().uuid(),
  person_id: z.string().uuid(),
  board_id: z.string().uuid(),
  town_id: z.string().uuid(),
  seat_title: z.string().max(50).nullable(),
  term_start: z.string().date(),
  term_end: z.string().date().nullable(),
  status: z.enum([BoardMemberStatus.ACTIVE, BoardMemberStatus.ARCHIVED]),
  is_default_rec_sec: z.boolean(),
  created_at: z.string().datetime(),
});

export const CreateBoardMemberSchema = BoardMemberSchema.omit({
  id: true,
  created_at: true,
});

export const ResidentAccountSchema = z.object({
  id: z.string().uuid(),
  person_id: z.string().uuid(),
  town_id: z.string().uuid(),
  notification_preferences: z.record(z.string(), z.unknown()),
  created_at: z.string().datetime(),
  archived_at: z.string().datetime().nullable(),
});
