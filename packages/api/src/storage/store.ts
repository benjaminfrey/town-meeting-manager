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
import { resolveWithin } from "./paths.js";

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
  await fs.mkdir(directory, { recursive: true });

  const temporary = path.join(directory, `.tmp-${randomUUID()}`);
  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(temporary, "wx", 0o640);
    await handle.write(bytes);
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
