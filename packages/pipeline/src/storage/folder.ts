import {
  mkdir,
  readdir,
  rename,
  rm,
  rmdir,
  stat,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import type { Storage } from './types.ts';

export interface FolderStorageOptions {
  /** Directory written to, usually `<gallery>/public/_mg`. */
  root: string;
  /** URL prefix for that directory, usually `/_mg`. */
  baseUrl?: string;
}

/** Stores derivatives in the site’s `public/` folder, so they ship with the build. */
export function folderStorage({
  root,
  baseUrl = '/_mg',
}: FolderStorageOptions): Storage {
  const pathOf = (key: string) => {
    if (key.includes('..')) throw new Error(`invalid storage key: ${key}`);
    return join(root, ...key.split('/'));
  };
  return {
    async put(key, bytes) {
      const path = pathOf(key);
      await mkdir(dirname(path), { recursive: true });
      const tmp = `${path}.${process.pid}.tmp`;
      await writeFile(tmp, bytes);
      await rename(tmp, path);
    },
    async has(key) {
      try {
        await stat(pathOf(key));
        return true;
      } catch {
        return false;
      }
    },
    url(key) {
      return `${baseUrl}/${key}`;
    },
    async list(prefix) {
      const dir = pathOf(prefix.replace(/\/$/, ''));
      try {
        const entries = await readdir(dir, {
          recursive: true,
          withFileTypes: true,
        });
        return entries
          .filter((e) => e.isFile() && !e.name.endsWith('.tmp'))
          .map((e) =>
            relative(root, join(e.parentPath, e.name)).split(sep).join('/')
          );
      } catch (e: any) {
        if (e?.code === 'ENOENT') return [];
        throw e;
      }
    },
    async remove(key) {
      const path = pathOf(key);
      await rm(path, { force: true });
      // Remove the photo folder once it is empty.
      await rmdir(dirname(path)).catch(() => {});
    },
    async sweep() {
      const removed: string[] = [];
      const rel = (p: string) => relative(root, p).split(sep).join('/');
      // Depth first, so a folder emptied of temp files is removed too.
      const visit = async (dir: string): Promise<boolean> => {
        let entries;
        try {
          entries = await readdir(dir, { withFileTypes: true });
        } catch (e: any) {
          if (e?.code === 'ENOENT') return true;
          throw e;
        }
        let empty = true;
        for (const e of entries) {
          const p = join(dir, e.name);
          if (e.isDirectory()) {
            if (await visit(p)) {
              await rmdir(p).catch(() => {});
              removed.push(`${rel(p)}/`);
            } else empty = false;
          } else if (e.name.endsWith('.tmp')) {
            await rm(p, { force: true });
            removed.push(rel(p));
          } else empty = false;
        }
        return empty;
      };
      await visit(root);
      return removed;
    },
  };
}
