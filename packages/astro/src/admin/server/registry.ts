/**
 * What outlives one dev server: Astro restarts its server after a config
 * edit, and the integration and this module are loaded again, but the Node
 * process stays. The token, the run queue, uploads in progress and jobs are
 * kept on `globalThis`, keyed by gallery directory.
 */
import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { registryRoot, type AdminInfo } from '../token.ts';
import type { Job } from './jobs.ts';
import type { RunQueue } from './queue.ts';
import type { Upload } from './uploads.ts';

export interface GalleryEntry extends AdminInfo {
  galleryDir: string;
  /** Events from the queue and jobs; each admin instance listens while it is open. */
  bus: EventEmitter;
  queue?: RunQueue;
  uploads: Map<string, Upload>;
  /** Content hashes of photos added in this session, which may have no manifest yet. */
  added: Map<string, { photoId: string; path: string }>;
  job: Job | null;
  /** Upload completions run one at a time. */
  lock: Promise<unknown>;
  publishInfo?: { at: number; value: unknown };
}

export function galleryEntry(galleryDir: string, api: string): GalleryEntry {
  const root = registryRoot();
  let entry = root.galleries.get(galleryDir) as GalleryEntry | undefined;
  if (!entry) {
    const bus = new EventEmitter();
    bus.setMaxListeners(0);
    entry = {
      galleryDir,
      token: randomBytes(24).toString('base64url'),
      api,
      bus,
      uploads: new Map(),
      added: new Map(),
      job: null,
      lock: Promise.resolve(),
    };
    root.galleries.set(galleryDir, entry);
  }
  entry.api = api;
  root.current = galleryDir;
  return entry;
}

/** Forget a gallery for good (tests, a desktop shell closing a gallery). */
export function dropGalleryEntry(galleryDir: string): void {
  const root = registryRoot();
  root.galleries.delete(galleryDir);
  if (root.current === galleryDir) root.current = undefined;
}
