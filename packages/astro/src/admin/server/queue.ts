/**
 * The admin’s run queue: the one owner of pipeline runs while the admin is
 * open. Uploads, sidecar edits and changes seen in `photos/` ask for a run;
 * requests are debounced, a changing file is waited for until its size holds
 * still, and a request during a run queues one more run after it.
 */
import { stat } from 'node:fs/promises';
import type {
  PhotoError,
  PhotoManifest,
  ProcessOptions,
  ProcessSummary,
} from '@minimalgallery/pipeline';

export type ProcessFn = (
  galleryDir: string,
  options: ProcessOptions
) => Promise<ProcessSummary>;

export interface QueueSnapshot {
  running: boolean;
  queued: boolean;
  paused: boolean;
  total: number;
  done: number;
  pending: number;
  current: string | null;
  errors: number;
  last: {
    at: string;
    seconds: number;
    photos: number;
    encoded: number;
    metadataOnly: number;
    errors: number;
  } | null;
}

export type QueueEvent =
  | { type: 'queue'; queue: QueueSnapshot }
  | { type: 'manifest'; manifest: PhotoManifest }
  | { type: 'photo-error'; error: PhotoError }
  | { type: 'run-error'; message: string }
  | { type: 'run-done'; summary: ProcessSummary };

export interface QueueOptions {
  galleryDir: string;
  process: ProcessFn;
  emit: (event: QueueEvent) => void;
  /** Quiet time before a run starts. Default 1500 ms. */
  debounceMs?: number;
  /** A stream of requests still starts a run after this long. Default 6000 ms. */
  maxWaitMs?: number;
  log?: (message: string) => void;
}

export class RunQueue {
  #o: Required<Omit<QueueOptions, 'log'>> & Pick<QueueOptions, 'log'>;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #firstRequest: number | undefined;
  /** Files to wait for: path to the size seen when the change came in. */
  #watch = new Map<string, number>();
  #dirty = false;
  #prune = false;
  #running = false;
  #paused = false;
  #total = 0;
  #done = 0;
  #errors = 0;
  #current: string | null = null;
  #last: QueueSnapshot['last'] = null;
  #idleWaiters: Array<() => void> = [];
  /** Errors reported in the previous run, so each is sent once. */
  #knownErrors = new Set<string>();
  #disposed = false;

  constructor(options: QueueOptions) {
    this.#o = {
      ...options,
      debounceMs: options.debounceMs ?? 1500,
      maxWaitMs: options.maxWaitMs ?? 6000,
    };
  }

  /** Replace the event sink (a new admin instance after a dev-server restart). */
  setEmit(emit: (event: QueueEvent) => void): void {
    this.#o.emit = emit;
  }

  snapshot(): QueueSnapshot {
    return {
      running: this.#running,
      queued: this.#dirty,
      paused: this.#paused,
      total: this.#total,
      done: this.#done,
      pending: Math.max(0, this.#total - this.#done),
      current: this.#current,
      errors: this.#errors,
      last: this.#last,
    };
  }

  #emitQueue() {
    this.#o.emit({ type: 'queue', queue: this.snapshot() });
  }

  /**
   * Ask for a run. `paths` are photo files to wait for: the run starts once
   * their size stops changing. `prune` removes what belongs to deleted photos.
   */
  schedule({ prune = false, paths = [] as string[] } = {}): void {
    if (this.#disposed) return;
    this.#dirty = true;
    if (prune) this.#prune = true;
    for (const p of paths)
      stat(p).then(
        (s) => this.#watch.set(p, s.size),
        () => {}
      );
    if (!this.#running && !this.#paused) this.#arm(false);
    this.#emitQueue();
  }

  /** Run as soon as possible, without the debounce. */
  runNow({ prune = false } = {}): void {
    if (this.#disposed) return;
    this.#dirty = true;
    if (prune) this.#prune = true;
    if (!this.#running && !this.#paused) this.#arm(true);
    this.#emitQueue();
  }

  #arm(now: boolean) {
    clearTimeout(this.#timer);
    const t = Date.now();
    this.#firstRequest ??= t;
    const wait = now
      ? 0
      : Math.max(
          0,
          Math.min(
            this.#o.debounceMs,
            this.#firstRequest + this.#o.maxWaitMs - t
          )
        );
    this.#timer = setTimeout(() => void this.#fire(), wait);
  }

  async #fire() {
    this.#timer = undefined;
    if (this.#running || this.#paused || this.#disposed) return;
    let changing = false;
    for (const [path, size] of this.#watch) {
      const now = await stat(path).then(
        (s) => s.size,
        () => null
      );
      if (now === null) this.#watch.delete(path);
      else if (now !== size) {
        this.#watch.set(path, now);
        changing = true;
      }
    }
    if (changing) {
      // Still being written (a Finder copy): look again after a quiet period.
      this.#timer = setTimeout(() => void this.#fire(), this.#o.debounceMs);
      return;
    }
    if (this.#running || this.#paused || this.#disposed) return;
    this.#watch.clear();
    this.#firstRequest = undefined;
    await this.#run();
  }

  async #run() {
    this.#running = true;
    this.#dirty = false;
    const prune = this.#prune;
    this.#prune = false;
    this.#total = 0;
    this.#done = 0;
    this.#errors = 0;
    this.#current = null;
    this.#emitQueue();
    const started = performance.now();
    let planned = false;
    const reported = new Set<string>();
    try {
      const summary = await this.#o.process(this.#o.galleryDir, {
        prune,
        log: this.#o.log,
        onPlan: ({ pending }) => {
          planned = true;
          this.#total = pending;
          this.#emitQueue();
        },
        onPhoto: (manifest) => {
          this.#done++;
          this.#current = manifest.source;
          this.#o.emit({ type: 'manifest', manifest });
          this.#emitQueue();
        },
        onError: (error) => {
          if (planned) this.#done++;
          this.#errors++;
          reported.add(`${error.path}\n${error.message}`);
          this.#o.emit({ type: 'photo-error', error });
          this.#emitQueue();
        },
      });
      // Files the walk refused (RAW) have no callback: report the
      // ones the previous run did not.
      const now = new Set<string>();
      for (const error of summary.errors) {
        const key = `${error.path}\n${error.message}`;
        now.add(key);
        if (!reported.has(key) && !this.#knownErrors.has(key))
          this.#o.emit({ type: 'photo-error', error });
      }
      this.#knownErrors = now;
      this.#last = {
        at: new Date().toISOString(),
        seconds: (performance.now() - started) / 1000,
        photos: summary.photos,
        encoded: summary.encoded,
        metadataOnly: summary.metadataOnly,
        errors: summary.errors.length,
      };
      this.#o.emit({ type: 'run-done', summary });
    } catch (e) {
      this.#o.emit({
        type: 'run-error',
        message: (e as Error)?.message ?? String(e),
      });
    } finally {
      this.#running = false;
      this.#total = 0;
      this.#done = 0;
      this.#current = null;
      if (this.#dirty && !this.#paused && !this.#disposed) this.#arm(false);
      else this.#settle();
      this.#emitQueue();
    }
  }

  #settle() {
    if (this.#running) return;
    const waiters = this.#idleWaiters;
    this.#idleWaiters = [];
    for (const w of waiters) w();
  }

  /** Resolves when no run is in progress. */
  idle(): Promise<void> {
    if (!this.#running) return Promise.resolve();
    return new Promise((done) => this.#idleWaiters.push(done));
  }

  /** Resolves when no run is in progress and none is waiting to start. */
  async settled(): Promise<void> {
    for (;;) {
      await this.idle();
      if (!this.#dirty || this.#paused || this.#disposed) return;
      await new Promise<void>((done) => this.#idleWaiters.push(done));
    }
  }

  /** Hold runs (for a publish, which runs the pipeline itself). Resolves once idle. */
  async pause(): Promise<void> {
    this.#paused = true;
    clearTimeout(this.#timer);
    this.#timer = undefined;
    this.#emitQueue();
    await this.idle();
  }

  resume(): void {
    this.#paused = false;
    if (this.#dirty && !this.#running) this.#arm(false);
    this.#emitQueue();
  }

  /** Stop the timers for good (tests, a desktop shell quitting). */
  dispose(): void {
    this.#disposed = true;
    clearTimeout(this.#timer);
    this.#settle();
  }
}
