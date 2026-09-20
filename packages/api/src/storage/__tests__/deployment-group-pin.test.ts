/**
 * The half of nginx's read access that no longer has an artefact to be pinned
 * against — and the tripwire that makes Stage 2 unable to ship without it.
 *
 * ─── The property ─────────────────────────────────────────────────────────
 *
 * `storage/store.ts` writes files and directories group-readable, on purpose.
 * Group-readable is only half of a guarantee: nginx's workers run unprivileged
 * (`user nginx;`) as a DIFFERENT Linux user from the API process, so they can
 * read those files only if the two share a group. Before Phase F, the Docker
 * Compose deployment supplied that half by running the API with nginx's group
 * as its PRIMARY group — `user: "${TMM_ASSET_UID:-0}:${TMM_ASSET_GID:-101}"`,
 * 101 being the `nginx` uid/gid in `nginx:*-alpine` — so every file the API
 * created was already group-owned by nginx, with no `chown` anywhere.
 *
 * `serving-surface.test.ts` used to read that compose file and assert it. Phase
 * F deleted the deployment outright (remove, not replace — no non-Docker
 * deployment was being built), so that assertion was removed rather than faked:
 * there is nothing left in the repository that encodes how the API process and
 * nginx run together. Backlog 21.
 *
 * ─── Why this file exists ─────────────────────────────────────────────────
 *
 * Because the gap is invisible until it bites, and then it bites silently: the
 * symptom is not an error but nginx returning 403 for every document and seal,
 * with the API's own logs clean. That is exactly the failure Task D1e's review
 * found the first time, and the reason the compose-file assertion existed.
 *
 * So the requirement outlives its artefact. This test passes VACUOUSLY today —
 * no file in the repository starts the API process — and fails the moment one
 * appears without encoding the group relationship. Its failure message is
 * addressed to whoever writes the Stage 2 deployment, because they are the
 * only person who can discharge it.
 *
 * ─── What counts as encoding it ───────────────────────────────────────────
 *
 * Deliberately broad, and deliberately not a specific mechanism: a compose
 * `user:` line, a systemd `SupplementaryGroups=` or `Group=`, a Dockerfile
 * `USER`, an `install -g`, a `chgrp`, or the `TMM_ASSET_GID` name the old
 * deployment used. The point is that the author THOUGHT about it — the test
 * cannot verify a Linux group relationship from inside a unit test, and
 * pretending otherwise would be the kind of check that cannot fail.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "..");

/** Directories a deployment artefact could plausibly live in. */
const SEARCH_ROOTS = ["infrastructure", "deploy", "packages/api"];

/** Directory names never worth walking into. */
const SKIP = new Set(["node_modules", "dist", "build", ".git", "coverage", "__tests__", "test"]);

/**
 * Files that START THE API PROCESS, as opposed to configuring something else.
 * nginx's own config is not one: it describes the server that READS the files,
 * and it is already pinned by `serving-surface.test.ts`.
 */
function looksLikeProcessArtefact(file: string, text: string): boolean {
  const name = file.toLowerCase();
  if (/docker-compose[^/]*\.ya?ml$/.test(name)) return true;
  if (/\.service$/.test(name) || /\.socket$/.test(name)) return true;
  if (/(^|\/)procfile$/.test(name)) return true;
  if (/(^|\/)dockerfile([^/]*)$/.test(name)) return true;
  // A systemd unit or launcher by any other name.
  return /\[Service\]|ExecStart=/.test(text);
}

const ENCODES_GROUP =
  /TMM_ASSET_GID|SupplementaryGroups|^\s*Group=|^\s*user:\s|^\s*USER\s|chgrp|install\s+-g|--chown|\bgid\b/im;

function artefacts(): { file: string; text: string }[] {
  const found: { file: string; text: string }[] = [];
  const walk = (dir: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return; // a search root that does not exist is not a failure
    }
    for (const entry of entries) {
      if (SKIP.has(entry)) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      const text = readFileSync(full, "utf8");
      const relative = full.slice(REPO_ROOT.length + 1);
      if (looksLikeProcessArtefact(relative, text)) found.push({ file: relative, text });
    }
  };
  for (const root of SEARCH_ROOTS) walk(join(REPO_ROOT, root));
  return found;
}

describe("the deployment must give nginx read access to what the API writes (backlog 21)", () => {
  it("every artefact that starts the API encodes the shared-group relationship", () => {
    const silent = artefacts()
      .filter(({ text }) => !ENCODES_GROUP.test(text))
      .map(({ file }) => file)
      .sort();

    expect(
      silent,
      "these files start the API process but say nothing about the group nginx reads through. " +
        "`storage/store.ts` writes group-readable files; nginx's workers run unprivileged as a " +
        "different user, so they can read them only if the API process shares nginx's group. " +
        'The deleted Docker deployment did it with `user: "${TMM_ASSET_UID:-0}:${TMM_ASSET_GID:-101}"` ' +
        "(101 = the nginx uid/gid in nginx:*-alpine), making every file the API created " +
        "group-owned by nginx with no chown. Do the equivalent for this deployment — systemd " +
        "`SupplementaryGroups=`, a container `user:`, a `chgrp`, whatever fits — then pin it " +
        "here the way the compose file used to be pinned. Symptom if you skip it: nginx " +
        "returns 403 for every document and seal, and the API's logs are clean. See backlog 21",
    ).toEqual([]);
  });

  it("the requirement is still written down where the writer lives", () => {
    // `store.ts`'s comment is the only surviving statement of WHY the modes it
    // sets are not sufficient on their own. If a tidy-up removes it, this test
    // is the last thing standing between Stage 2 and a silent 403.
    const store = readFileSync(join(REPO_ROOT, "packages/api/src/storage/store.ts"), "utf8");
    expect(
      store,
      "storage/store.ts no longer explains that group-readable modes need a shared group to " +
        "be useful. That paragraph is the only place the requirement is stated next to the " +
        "code it constrains — see backlog 21 before removing it",
    ).toMatch(/shared group|group-owned|TMM_ASSET_GID/);
  });
});
