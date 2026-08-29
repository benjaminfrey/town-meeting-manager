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
# It also copies the two gitignored env files a fresh worktree does not inherit.
# `packages/web/.env` matters most: without it `packages/web/src/lib/supabase.ts`
# throws at import time, inside the SPA prerender, which surfaces as
# "[react-router] Cannot convert undefined or null to object" in
# groupRoutesByParentId — an error naming neither the variable nor Supabase.
# One session lost real time to that and bisected four commits before finding it.
# CI does the same copy (.github/workflows/ci.yml) for the same reason.
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

for ENV_FILE in packages/web/.env docker/.env; do
  if [ -f "$ENV_FILE" ]; then
    cp "$ENV_FILE" "${WT_PATH}/${ENV_FILE}"
  elif [ -f "${ENV_FILE}.example" ]; then
    cp "${ENV_FILE}.example" "${WT_PATH}/${ENV_FILE}"
  fi
done

cat <<EOF
worktree : ${WT_PATH}
branch   : ${BRANCH}
base     : ${BASE_SHA}  ($(git log --format=%s -1 "$BASE_SHA"))
env      : $(ls "${WT_PATH}/packages/web/.env" >/dev/null 2>&1 && echo "web/.env present" || echo "web/.env MISSING")

Dependencies are not installed. Run 'pnpm install' inside the worktree if the
task needs to build or test.

Remove when finished:
  git worktree remove ${WT_PATH} && git branch -D ${BRANCH}
EOF
