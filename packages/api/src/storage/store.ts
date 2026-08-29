/**
 * Stage 1, Task D1e — writing and removing bytes, durably.
 *
 * ─── The ordering, which is the whole content of this file ────────────────
 *
 * The owner's decision is **replace, not versioned**: an upload supersedes the
 * previous file and the old bytes go away. That crosses two systems — a file
 * tree and a database — with no transaction spanning them, so the only thing
 * to design is which failure is survivable.
 *
 *   1. **Write the new file, durably, first.** `writeFileDurably` writes to a
 *      temporary name in the destination directory, fsyncs the file, renames
 *      it into place (atomic on the same filesystem), and fsyncs the
 *      directory. A reader either sees the whole old file or the whole new
 *      one — never a truncated one.
 *   2. **Then update the database.** If that fails, the new file is deleted
 *      again UNLESS it occupies the same path as the file still referenced by
 *      the row we failed to update — deleting it in that case would destroy
 *      the seal the town is still using in order to tidy up after a failure.
 *   3. **Only then delete what was superseded.** After the row commits,
 *      nothing references the old bytes.
 *
 * So: the old file is never removed before the new one is durable, and a
 * failed database update does not leave a file nothing points at. The residual
 * failure is a delete that fails in step 3 — an orphaned file with a correct
 * database. That is logged and deliberately not retried; an orphan costs
 * disk, and the alternative (deleting before the commit) costs a document.
 *
 * ─── What this does NOT do ────────────────────────────────────────────────
 *
 * Back itself up. `infrastructure/scripts/backup.sh` runs two `pg_dump`s and
 * `restore.sh` runs `pg_restore`; neither touches a file tree, and moving
 * documents out of Supabase's storage volume onto this one does not change
 * that — it makes it matter more. What a file-tree backup needs is recorded
 * in this task's report; it is explicitly out of scope here.
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { publicAssetRoot, resolveWithin } from "./paths.js";

/**
 * ─── Who has to be able to read these bytes ───────────────────────────────
 *
 * The process that WRITES every file here is the API container, running as
 * root. The process that READS almost all of them is an nginx worker, which
 * `infrastructure/nginx/nginx.conf` drops to the unprivileged `nginx` user —
 * the master is root, but no worker is, and it is the worker that opens the
 * file for a static request and for an `X-Accel-Redirect`.
 *
 * The first version of this module wrote every file `0640` with no group
 * arrangement, so every file landed `root:root 0640`. Correct in every test
 * — nothing in the suite reads a file as another user — and `EACCES` for
 * every nginx worker in production. The whole document delivery path was
 * dead behind nginx and no test could see it.
 *
 * The fix has two halves, one here and one in the compose file:
 *
 *   1. **A shared group.** `infrastructure/docker-compose.production.yml`
 *      runs the API as `${TMM_ASSET_UID:-0}:${TMM_ASSET_GID:-101}` — still
 *      root, so it can write into the volume, but with nginx's group as its
 *      PRIMARY group. Every file and directory it creates is therefore
 *      group-owned by nginx with no `chown` call anywhere. 101 is the `nginx`
 *      uid/gid in the official `nginx:*-alpine` images; it is a variable so a
 *      different base image is a compose edit, not a code change.
 *
 *   2. **Modes that say who may read, set here.** Below.
 *
 * ─── Two roots, two answers ───────────────────────────────────────────────
 *
 * PUBLIC ASSET ROOT — town seals. nginx serves these to the anonymous
 * internet at `/public-assets/seals/` with no route in front, so "world
 * readable" is not a widening of anything: it is a restatement of what the
 * root is for. `0644`/`0755`. What must NOT happen is world-WRITABLE — these
 * bytes are served from the application's own origin, so a writer other than
 * the API is a stored-content vector. No group or other write bit is set.
 *
 * DOCUMENT ROOT — minutes and exhibits, including drafts and `board_only`
 * material. nginx marks this root `internal` and only reaches it after a
 * route has authorized the fetch. `0640`/`0750`: owner (the API) and group
 * (nginx) and nobody else. That last clause is load-bearing rather than
 * decorative, because the `storage-data` volume is mounted by a third
 * container — Supabase Storage, at `/var/lib/storage` — so "other" here is
 * not an empty set, and `0644` would hand that container every town's draft
 * minutes.
 *
 * Both are applied with `fchmod`/`chmod` AFTER creation rather than by the
 * `mode` argument to `open`/`mkdir`, which the process umask subtracts from.
 * A deployment that set `umask 027` would otherwise strip the group read bit
 * off the public root and take nginx's access away again — the exact failure
 * this is fixing, arriving by a different door.
 */
export const PUBLIC_ASSET_FILE_MODE = 0o644;
export const PUBLIC_ASSET_DIRECTORY_MODE = 0o755;
export const DOCUMENT_FILE_MODE = 0o640;
export const DOCUMENT_DIRECTORY_MODE = 0o750;

/**
 * The modes for a root. Default-deny: anything that is not demonstrably the
 * public asset root gets the document root's tighter pair, so a root added
 * later is private until someone decides otherwise.
 */
export function storageModesFor(root: string): { file: number; directory: number } {
  return path.resolve(root) === publicAssetRoot()
    ? { file: PUBLIC_ASSET_FILE_MODE, directory: PUBLIC_ASSET_DIRECTORY_MODE }
    : { file: DOCUMENT_FILE_MODE, directory: DOCUMENT_DIRECTORY_MODE };
}

/**
 * `mkdir -p` from `root` down to `directory`, and set the mode on every level
 * including `root` itself.
 *
 * Chmod'ing the whole chain rather than only the leaf matters because a
 * directory with no group `x` bit is not traversable, and nginx cannot read a
 * file it cannot reach. Nothing above `root` is touched: `/var/lib/tmm` is the
 * volume mount point, created by Docker, and is not ours to re-permission.
 */
async function ensureDirectory(root: string, directory: string, mode: number): Promise<void> {
  const base = path.resolve(root);
  const chain: string[] = [];
  for (let current = directory; ; current = path.dirname(current)) {
    chain.unshift(current);
    if (current === base || path.dirname(current) === current) break;
  }
  await fs.mkdir(directory, { recursive: true, mode });
  for (const level of chain) {
    await fs.chmod(level, mode);
  }
}

/**
 * Write `bytes` to `relative` under `root` so that a crash cannot leave a
 * partial file where a whole one used to be.
 *
 * Returns the absolute path written.
 */
export async function writeFileDurably(
  root: string,
  relative: string,
  bytes: Uint8Array,
): Promise<string> {
  const absolute = resolveWithin(root, relative);
  const directory = path.dirname(absolute);
  const modes = storageModesFor(root);
  await ensureDirectory(root, directory, modes.directory);

  const temporary = path.join(directory, `.tmp-${randomUUID()}`);
  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(temporary, "wx", modes.file);
    await handle.write(bytes);
    // Set the mode explicitly: the `open` argument above is masked by the
    // process umask, and the file has to be readable by nginx whatever the
    // container's umask happens to be. fchmod is not masked.
    await handle.chmod(modes.file);
    await handle.sync();
  } finally {
    await handle?.close();
  }

  try {
    await fs.rename(temporary, absolute);
  } catch (err) {
    await fs.rm(temporary, { force: true });
    throw err;
  }

  // fsync the directory so the rename itself survives a power loss, not just
  // the file's contents.
  let directoryHandle: fs.FileHandle | undefined;
  try {
    directoryHandle = await fs.open(directory, "r");
    await directoryHandle.sync();
  } catch {
    // Not every platform permits opening a directory for fsync. The rename is
    // still atomic; only its durability across a hard power loss is weakened.
  } finally {
    await directoryHandle?.close();
  }

  return absolute;
}

/**
 * Remove `relative` under `root` if it is there.
 *
 * Never throws for a missing file: this is called to tidy up after something
 * else succeeded, and turning "already gone" into an error would fail a
 * request whose real work is complete.
 */
export async function removeFileIfPresent(root: string, relative: string): Promise<void> {
  let absolute: string;
  try {
    absolute = resolveWithin(root, relative);
  } catch {
    // A path this module would refuse to write is one it will not delete
    // either — a stored value that does not validate points at something we
    // did not put there.
    return;
  }
  await fs.rm(absolute, { force: true });
}

/** Does a stored file exist? Used to answer 404 before handing nginx a name. */
export async function fileExists(root: string, relative: string): Promise<boolean> {
  try {
    const absolute = resolveWithin(root, relative);
    const stat = await fs.stat(absolute);
    return stat.isFile();
  } catch {
    return false;
  }
}

/** The stored file's size, or `undefined` when it is not there. */
export async function fileSize(root: string, relative: string): Promise<number | undefined> {
  try {
    const stat = await fs.stat(resolveWithin(root, relative));
    return stat.isFile() ? stat.size : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Read a stored file. Only the development delivery path uses this — in
 * production nginx serves the bytes and this process never opens the file.
 */
export async function readStoredFile(root: string, relative: string): Promise<Buffer> {
  return fs.readFile(resolveWithin(root, relative));
}

/**
 * Run `commit` (the database half) with the file already durable, and undo the
 * file if `commit` throws.
 *
 * `keepOnFailure` names the path that must survive a failed commit even though
 * this call wrote it — the case where the new file landed on top of the one
 * the unchanged row still points at.
 */
export async function withWrittenFile<T>(
  root: string,
  relative: string,
  bytes: Uint8Array,
  commit: () => Promise<T>,
  options: { keepOnFailure?: boolean; onCleanupError?: (err: unknown) => void } = {},
): Promise<T> {
  await writeFileDurably(root, relative, bytes);
  try {
    return await commit();
  } catch (err) {
    if (!options.keepOnFailure) {
      try {
        await removeFileIfPresent(root, relative);
      } catch (cleanupError) {
        options.onCleanupError?.(cleanupError);
      }
    }
    throw err;
  }
}
