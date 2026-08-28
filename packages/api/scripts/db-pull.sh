#!/usr/bin/env bash
# Guarded wrapper around `drizzle-kit pull`.
#
# WHY THIS GUARD EXISTS
#
# `drizzle-kit pull` OVERWRITES src/db/schema.ts wholesale. Run against a
# database built from drizzle/0000_baseline.sql it will:
#
#   1. Regenerate the 28 RLS policies as `pgPolicy()` calls — and drop the
#      USING/WITH CHECK clause from every policy after the first on each
#      table. That is not a hypothetical: it is the exact defect Task 4 (B1)
#      measured (53 of 79 policies lost their clause) and Task 5 (B2) removed.
#      The next `drizzle-kit generate` would then emit unconditionally
#      permissive policies on tenant-isolation-critical tables.
#   2. Delete the banner at the top of schema.ts that explains why RLS is not
#      defined there — i.e. erase the warning about the thing it just did.
#
# RLS lives in packages/api/drizzle/0000_baseline.sql. schema.ts models tables,
# columns, indexes and foreign keys only. If you re-pull, you must re-delete
# every `pgPolicy()` call and restore the banner by hand before committing.
#
# packages/api/src/db/__tests__/schema-invariants.test.ts will catch a database
# whose RLS has been damaged, but it CANNOT catch a schema.ts that has grown
# policy definitions back — that damage only appears at the next `generate`.
set -euo pipefail

if [ "${ALLOW_DB_PULL:-}" != "1" ]; then
  cat >&2 <<'MSG'
db:pull is guarded. `drizzle-kit pull` overwrites packages/api/src/db/schema.ts,
which would reintroduce pgPolicy() calls with missing USING/WITH CHECK clauses
(the Task 4 defect) and delete the banner explaining why RLS is not defined
there. RLS lives in packages/api/drizzle/0000_baseline.sql.

If you genuinely need to re-introspect, run:

    ALLOW_DB_PULL=1 pnpm db:pull

and then, before committing: delete every pgPolicy() call from schema.ts,
restore the top-of-file banner, and re-run `pnpm test`.
MSG
  exit 1
fi

echo "ALLOW_DB_PULL=1 set — running drizzle-kit pull. Remember to strip pgPolicy() calls afterwards." >&2
# `pnpm exec` rather than a bare `drizzle-kit`, so the script also works when run
# directly instead of through `pnpm db:pull` (which puts node_modules/.bin on PATH).
exec pnpm exec drizzle-kit pull "$@"
