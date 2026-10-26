/**
 * Changes in `photos/` seen by a file watcher (Vite’s `server.watcher` in
 * dev) become run requests, so photos copied in with Finder show up live.
 * `minimalgallery admin` therefore starts no watcher of its own.
 */
import { basename, extname, join, sep } from 'node:path';
import { PHOTO_EXTENSIONS } from '@minimalgallery/pipeline';
import type { RunQueue } from './queue.ts';

/** The part of chokidar’s `FSWatcher` the bridge uses. */
export interface WatcherLike {
  on(event: string, listener: (path: string) => void): unknown;
  off(event: string, listener: (path: string) => void): unknown;
  add?(paths: string | string[]): unknown;
}

const SIDECARS = new Set(['.xmp']);

/** Connect a watcher to the queue. Returns the function that disconnects it. */
export function bridgeWatcher(
  watcher: WatcherLike,
  galleryDir: string,
  queue: RunQueue
): () => void {
  const photos = join(galleryDir, 'photos');
  watcher.add?.(photos);
  const inPhotos = (path: string) =>
    path.startsWith(photos + sep) &&
    !path
      .slice(photos.length + 1)
      .split(/[\\/]/)
      .some((s) => s.startsWith('.')) &&
    !path.endsWith('.tmp');
  const kind = (path: string) => {
    const ext = extname(path).toLowerCase();
    if (PHOTO_EXTENSIONS.has(ext)) return 'photo';
    if (SIDECARS.has(ext) || basename(path) === '_album.md') return 'sidecar';
    return 'other';
  };
  const listeners: Record<string, (path: string) => void> = {
    add: (path) => {
      if (!inPhotos(path)) return;
      const k = kind(path);
      // RAW files are reported by the run, so they count too.
      queue.schedule({ paths: k === 'photo' ? [path] : [] });
    },
    change: (path) => {
      if (!inPhotos(path)) return;
      const k = kind(path);
      if (k === 'other') return;
      queue.schedule({ paths: k === 'photo' ? [path] : [] });
    },
    unlink: (path) => {
      if (!inPhotos(path)) return;
      queue.schedule({ prune: kind(path) === 'photo' });
    },
    addDir: (path) => {
      if (inPhotos(path)) queue.schedule();
    },
    unlinkDir: (path) => {
      if (inPhotos(path)) queue.schedule({ prune: true });
    },
  };
  for (const [event, fn] of Object.entries(listeners)) watcher.on(event, fn);
  return () => {
    for (const [event, fn] of Object.entries(listeners)) watcher.off(event, fn);
  };
}
