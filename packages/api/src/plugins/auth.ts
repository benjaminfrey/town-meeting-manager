/**
 * Authentication plugin.
 *
 * Provides a `verifyAuth` decorator that extracts and verifies the
 * Bearer token, decodes JWT custom claims, and attaches user info
 * to the request. Also provides `requirePermission` for route-level
 * permission checks.
 */

import fp from "fastify-plugin";
import type { FastifyRequest, FastifyReply } from "fastify";
import type { UserRole } from "@town-meeting/shared";

// ─── Types ───────────────────────────────────────────────────────────

export interface RequestUser {
  id: string;
  personId: string | null;
  email: string;
  townId: string | null;
  role: UserRole;
  permissions: Record<string, boolean>;
}

declare module "fastify" {
  interface FastifyRequest {
    user?: RequestUser;
  }
  interface FastifyInstance {
    verifyAuth: (
      request: FastifyRequest,
      reply: FastifyReply,
    ) => Promise<void>;
  }
}

// ─── JWT Decode ──────────────────────────────────────────────────────

interface JwtPayload {
  sub?: string;
  email?: string;
  town_id?: string;
  role?: string;
  person_id?: string;
  permissions?: Record<string, boolean>;
  app_metadata?: {
    town_id?: string;
    role?: string;
    person_id?: string;
    permissions?: Record<string, boolean>;
  };
  user_metadata?: {
    town_id?: string;
    role?: string;
    person_id?: string;
    permissions?: Record<string, boolean>;
  };
}

function decodeJwtPayload(token: string): JwtPayload | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3 || !parts[1]) return null;
    const decoded = Buffer.from(parts[1], "base64url").toString("utf-8");
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

// ─── Plugin ──────────────────────────────────────────────────────────

export const authPlugin = fp(async (fastify) => {
  fastify.decorate(
    "verifyAuth",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const header = request.headers.authorization;
      if (!header?.startsWith("Bearer ")) {
        return reply.unauthorized("Missing or invalid Authorization header");
      }

      const token = header.slice(7);

      // Verify the token against Supabase auth
      const {
        data: { user },
        error,
      } = await fastify.supabase.auth.getUser(token);

      if (error || !user) {
        return reply.unauthorized("Invalid or expired token");
      }

      // Decode custom claims from JWT payload
      const payload = decodeJwtPayload(token);

      const townId =
        payload?.town_id ??
        payload?.app_metadata?.town_id ??
        payload?.user_metadata?.town_id ??
        null;

      const role =
        (payload?.role as UserRole) ??
        (payload?.app_metadata?.role as UserRole) ??
        (payload?.user_metadata?.role as UserRole) ??
        "admin";

      const personId =
        payload?.person_id ??
        payload?.app_metadata?.person_id ??
        payload?.user_metadata?.person_id ??
        null;

      const permissions =
        payload?.permissions ??
        payload?.app_metadata?.permissions ??
        payload?.user_metadata?.permissions ??
        {};

      request.user = {
        id: user.id,
        personId,
        email: user.email ?? "",
        townId,
        role,
        permissions: typeof permissions === "object" ? permissions : {},
      };
    },
  );
});

// ─── Permission check helper ─────────────────────────────────────────

/**
 * Creates a preHandler that checks if the user has a specific permission.
 * Admin role always passes. For staff, checks the permissions matrix.
 */
export function requirePermission(action: string) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user;
    if (!user) {
      return reply.unauthorized("Not authenticated");
    }

    // Admin always has full access
    if (user.role === "admin" || user.role === "sys_admin") {
      return;
    }

    if (!user.permissions[action]) {
      return reply.forbidden(`Missing permission: ${action}`);
    }
  };
}
