/**
 * The system Trash, for “Move to Trash” on a duplicate photo: the file can
 * be taken back out, unlike a delete. macOS asks Foundation’s
 * `NSFileManager trashItemAtURL` (through osascript, so no binary ships
 * with the package), Linux asks `gio trash`. Other systems get an error
 * that says to delete the file in the file manager.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

/** Moves each path to the Trash in order; rejects at the first failure. */
export type TrashFn = (paths: string[]) => Promise<void>;

const run = promisify(execFile);

// JavaScript for Automation: the paths are the script's arguments, and the
// first failure's message is its output.
const MAC_SCRIPT = `function run(paths) {
  ObjC.import('Foundation');
  const fm = $.NSFileManager.defaultManager;
  for (const p of paths) {
    const error = $();
    if (!fm.trashItemAtURLResultingItemURLError($.NSURL.fileURLWithPath(p), null, error))
      return error.localizedDescription.js;
  }
  return '';
}`;

export const systemTrash: TrashFn = async (paths) => {
  if (!paths.length) return;
  if (process.platform === 'darwin') {
    const { stdout } = await run('osascript', [
      '-l',
      'JavaScript',
      '-e',
      MAC_SCRIPT,
      ...paths,
    ]);
    if (stdout.trim()) throw new Error(stdout.trim());
  } else if (process.platform === 'linux') {
    try {
      await run('gio', ['trash', '--', ...paths]);
    } catch (e: any) {
      throw new Error(
        e?.code === 'ENOENT'
          ? 'gio is not installed, so the admin cannot use the Trash here. Delete the file in your file manager.'
          : e?.stderr?.trim() || e.message
      );
    }
  } else
    throw new Error(
      'The admin can move files to the Trash on macOS and Linux only. Delete the file in your file manager.'
    );
};
