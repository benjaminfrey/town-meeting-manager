#!/usr/bin/env bash
#
# Provision a git worktree for a subagent, at an EXPLICIT base.
#
# Why this exists
# ---------------
# The agent harness's built-in worktree isolation branches from the repository's
# default branch, NOT from the branch you are working on. Measured 2026-08-29:
# two agents dispatched while `stage-1-phase-d` was 6 commits ahead of `main`
# both came up at `main`'s HEAD, missing the entire authorization layer they had
# been asked to build on. Both noticed and reset themselves — which is exactly
# the problem, because it made a systemic defect look like two lucky catches.
# Phase E fans out across many worktrees; one agent that does not check would
# silently produce work built on a base without the tenancy guarantees.
#
# So the base is named here and asserted, rather than inherited and hoped for.
#
# It copies NO env files, deliberately. It used to copy two gitignored ones,
# and both are now worse than useless in a worktree:
#
#   packages/web/.env — needed only while `packages/web/src/lib/supabase.ts`
#     existed, because that module threw at import without it. Phase E wave 6
#     deleted it; the web app now reads only `DEV` and the optional
#     `VITE_API_URL` / `VITE_VAPID_PUBLIC_KEY`, and CI dropped its copy step. A
#     leftover copy holds an old Supabase anon JWT that developers were told to
#     delete — copying it would spread that file into every worktree.
#
#   docker/.env — read only by `docker compose` in `docker/` (the legacy
#     Supabase stack behind `pnpm supabase:*`). That stack has a fixed project
#     name and a fixed `container_name` on all nine services, so running it
#     from a worktree would take over the main checkout's containers rather
#     than start its own. Nothing on the test or dev path reads the file, and it
#     holds the stack's secrets.
#
# API tests need only DATABASE_URL — on a Homebrew Postgres,
# DATABASE_URL="postgres://$USER@localhost:5432/postgres"; the harness's default
# is CI's `postgres` role, which a local cluster usually lacks. A task
# that runs the API dev server needs `packages/api/.env`, which is not copied
# either: create it from `packages/api/.env.example` in the worktree.
#
# Usage:  scripts/dev/new-agent-worktree.sh <name> [base]
#         base defaults to the current branch's HEAD, which is almost always
#         what you want and is precisely what the harness would NOT give you.
#
set -euo pipefail

NAME="${1:?usage: new-agent-worktree.sh <name> [base]}"
BASE="${2:-HEAD}"

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

BASE_SHA="$(git rev-parse --verify "${BASE}^{commit}")"
BRANCH="agent/${NAME}"
WT_PATH="${REPO_ROOT}/.claude/worktrees/${NAME}"

if [ -e "$WT_PATH" ]; then
  echo "error: ${WT_PATH} already exists. Remove it first:" >&2
  echo "       git worktree remove ${WT_PATH}" >&2
  exit 1
fi

if git show-ref --quiet --verify "refs/heads/${BRANCH}"; then
  echo "error: branch ${BRANCH} already exists." >&2
  exit 1
fi

git worktree add -b "$BRANCH" "$WT_PATH" "$BASE_SHA" >/dev/null

# Assert, do not assume. A worktree at the wrong base is the failure this
# script exists to prevent, so it must not be possible to leave here silently.
ACTUAL="$(git -C "$WT_PATH" rev-parse HEAD)"
if [ "$ACTUAL" != "$BASE_SHA" ]; then
  echo "error: worktree came up at ${ACTUAL}, expected ${BASE_SHA}." >&2
  git worktree remove --force "$WT_PATH" 2>/dev/null || true
  exit 1
fi

cat <<EOF
worktree : ${WT_PATH}
branch   : ${BRANCH}
base     : ${BASE_SHA}  ($(git log --format=%s -1 "$BASE_SHA"))

Dependencies are not installed. Run 'pnpm install' inside the worktree if the
task needs to build or test. API tests also need DATABASE_URL, e.g.
  DATABASE_URL="postgres://\$USER@localhost:5432/postgres" pnpm exec turbo run test

Remove when finished:
  git worktree remove ${WT_PATH} && git branch -D ${BRANCH}
EOF
