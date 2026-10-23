/**
 * Getting photos in: drops on the grid and on the album tree (folders read
 * recursively with webkitGetAsEntry), the “Choose photos” and “Choose a
 * folder” inputs, then chunked uploads to the API with per-file and
 * overall progress, three at a time.
 *
 * Where files go:
 * - on an album's grid, loose files and the top of a dropped or chosen
 *   folder go into that album; folders inside it become albums inside it;
 * - on the tree, a dropped folder becomes a new album (inside the album it
 *   is dropped on, or at the top), and its folders albums inside that one;
 * - with no album to go into (every photo, or the tree's top), loose files
 *   ask which album they belong to.
 *
 * Sidecars (.xmp, .md, .json) travel with the photo of the same name. A
 * photo the API adds shows in the grid at once from the local file, dimmed,
 * until its `photo` event brings the real thumbnail.
 */
import {
  $,
  api,
  ApiError,
  announce,
  app,
  albumById,
  autoTitle,
  bound,
  count,
  emit,
  fromTemplate,
  photoById,
  slugify,
  stripExtension,
  toast,
} from './core.ts';
import { createAlbum, isReordering } from './photos.ts';

const SIDECARS = new Set(['xmp', 'md', 'json']);
const CONCURRENCY = 3;

interface Picked {
  file: File;
  /** Folders between the drop (or the chosen folder) and the file. */
  dir: string[];
}

type Outcome = 'added' | 'duplicate' | 'skipped' | 'failed';

interface Job {
  file: File;
  album: string;
  sidecars: File[];
  row: HTMLLIElement;
  state: 'queued' | 'uploading' | 'processing' | Outcome | 'done';
  sent: number;
  photoId?: string;
  path?: string;
}

const tray = $('[data-uploads]');
const list = $('[data-upload-list]');
const jobs: Job[] = [];
let running = 0;

/* ------------------------------------------------------------------ */
/* READING DROPS AND PICKS                                             */
/* ------------------------------------------------------------------ */

const fileOf = (entry: FileSystemFileEntry) =>
  new Promise<File>((resolve, reject) => entry.file(resolve, reject));

const readAll = (reader: FileSystemDirectoryReader) =>
  new Promise<FileSystemEntry[]>((resolve, reject) =>
    reader.readEntries(resolve, reject)
  );

async function walk(entry: FileSystemEntry, dir: string[], out: Picked[]) {
  if (entry.isFile) {
    out.push({ file: await fileOf(entry as FileSystemFileEntry), dir });
  } else if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    // readEntries answers in batches (100 in Chrome) until it returns none
    for (
      let batch = await readAll(reader);
      batch.length;
      batch = await readAll(reader)
    )
      for (const child of batch) await walk(child, [...dir, entry.name], out);
  }
}

/** Every file in a drop, with its folders. Entries must be taken synchronously. */
function entriesOf(data: DataTransfer) {
  return [...data.items]
    .filter((item) => item.kind === 'file')
    .map((item) => item.webkitGetAsEntry?.() ?? null);
}

async function readDrop(data: DataTransfer): Promise<Picked[]> {
  const entries = entriesOf(data);
  const files = [...data.files];
  if (!entries.length || entries.some((e) => !e))
    return files.map((file) => ({ file, dir: [] }));
  const out: Picked[] = [];
  try {
    for (const entry of entries) await walk(entry!, [], out);
  } catch {
    // an entry the engine cannot read back (a drop made by a script, in
    // Safari): the plain file list still holds the loose files
    return files.map((file) => ({ file, dir: [] }));
  }
  return out;
}

function readInput(input: HTMLInputElement): Picked[] {
  return [...(input.files ?? [])].map((file) => {
    const parts = (file.webkitRelativePath || file.name).split('/');
    return { file, dir: parts.slice(0, -1) };
  });
}

/* ------------------------------------------------------------------ */
/* PLANNING: which album each file goes to                             */
/* ------------------------------------------------------------------ */

const ext = (name: string) => name.split('.').pop()?.toLowerCase() ?? '';

/**
 * @param base the album to add to, or null for the top of the gallery
 * @param keepTop whether the top folder of a drop becomes an album of its own
 */
async function plan(picked: Picked[], base: string | null, keepTop: boolean) {
  const files = picked.filter(
    ({ file }) =>
      !file.name.startsWith('.') &&
      !file.name.startsWith('_') &&
      file.name !== 'Thumbs.db'
  );
  if (!files.length) return;

  // loose files with nowhere to go: ask
  let looseAlbum = base;
  const loose = files.filter(
    (f) => (keepTop ? f.dir : f.dir.slice(1)).length === 0 && !base
  );
  if (loose.length) {
    const photos = loose.filter((f) => !SIDECARS.has(ext(f.file.name)));
    const name = await askAlbum(photos.length || loose.length);
    if (!name) return;
    const known = app.state?.albums.find(
      (a) =>
        a.title.toLowerCase() === name.toLowerCase() || a.id === slugify(name)
    );
    looseAlbum = known ? known.id : await createAlbum(null, name);
  }

  // create the albums the folders ask for, parents first
  const albumOf = new Map<string, string>();
  const folders = [
    ...new Set(files.map((f) => (keepTop ? f.dir : f.dir.slice(1)).join('/'))),
  ]
    .filter(Boolean)
    .sort((a, b) => a.split('/').length - b.split('/').length);
  for (const folder of folders) {
    const parts = folder.split('/');
    const parentKey = parts.slice(0, -1).join('/');
    const parent = parentKey ? albumOf.get(parentKey)! : base;
    try {
      albumOf.set(folder, await createAlbum(parent, parts.at(-1)!));
    } catch (error) {
      toast(
        `The album “${parts.at(-1)}” could not be made`,
        (error as Error).message
      );
      return;
    }
  }
  emit('albums-changed');

  // pair each sidecar with its photo, folder by folder
  const groups = new Map<string, { photo?: Picked; sidecars: Picked[] }>();
  const keyOf = (f: Picked, name: string) =>
    `${f.dir.join('/')}\u0000${name.toLowerCase()}`;
  for (const f of files) {
    if (SIDECARS.has(ext(f.file.name))) continue;
    groups.set(keyOf(f, stripExtension(f.file.name)), {
      photo: f,
      sidecars: [],
    });
  }
  const orphans: Picked[] = [];
  for (const f of files) {
    if (!SIDECARS.has(ext(f.file.name))) continue;
    const base1 = stripExtension(f.file.name);
    const group =
      groups.get(keyOf(f, base1)) ??
      groups.get(keyOf(f, stripExtension(base1)));
    if (group) group.sidecars.push(f);
    else orphans.push(f);
  }

  const target = (f: Picked) => {
    const folder = (keepTop ? f.dir : f.dir.slice(1)).join('/');
    return folder ? albumOf.get(folder)! : looseAlbum!;
  };
  const added: Job[] = [];
  for (const group of groups.values()) {
    const f = group.photo!;
    added.push(
      makeJob(
        f.file,
        target(f),
        group.sidecars.map((s) => s.file)
      )
    );
  }
  for (const f of orphans) {
    const job = makeJob(f.file, target(f), []);
    finish(job, 'skipped', 'No photo of the same name came with it.');
    added.push(job);
  }
  if (!added.length) return;
  showTray();
  announce(`Adding ${count(groups.size, 'photo')}.`);
  pump();
}

/** “Add these photos to which album?” Resolves to the name, or null. */
function askAlbum(n: number): Promise<string | null> {
  const dialog = $<HTMLDialogElement>('[data-pick-album]');
  const input = $<HTMLInputElement>('#pick-album-name', dialog);
  bound('pick-text', dialog).textContent =
    `${count(n, 'photo')}, not in a folder. Albums are folders, so they need one.`;
  input.value = '';
  dialog.showModal();
  return new Promise((resolve) => {
    dialog.addEventListener(
      'close',
      () =>
        resolve(
          dialog.returnValue === 'add' ? input.value.trim() || null : null
        ),
      { once: true }
    );
  });
}

/* ------------------------------------------------------------------ */
/* UPLOADING                                                           */
/* ------------------------------------------------------------------ */

function makeJob(file: File, album: string, sidecars: File[]): Job {
  const row = fromTemplate<HTMLLIElement>('upload');
  $('.uploads_name', row).textContent = file.name;
  list.append(row);
  const job: Job = { file, album, sidecars, row, state: 'queued', sent: 0 };
  jobs.push(job);
  if (sidecars.length)
    $('.uploads_reason', row).textContent = `With ${sidecars
      .map((s) => s.name)
      .join(', ')}`;
  return job;
}

function pump() {
  while (running < CONCURRENCY) {
    const job = jobs.find((j) => j.state === 'queued');
    if (!job) break;
    running += 1;
    job.state = 'uploading';
    upload(job)
      .catch((error) => finish(job, 'failed', (error as Error).message))
      .finally(() => {
        running -= 1;
        pump();
        renderTray();
      });
  }
  renderTray();
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Send one file in chunks; retry a chunk on a network error, resume on a 409. */
async function send(
  file: File,
  meta: Record<string, unknown>,
  onProgress?: (sent: number) => void
) {
  const start = await api<{
    id?: string;
    chunkSize?: number;
    status?: string;
    reason?: string;
  }>('POST', '/uploads', {
    name: file.name,
    size: file.size,
    lastModified: file.lastModified,
    ...meta,
  });
  if (start.status === 'skipped' || !start.id)
    return {
      id: null,
      skipped: start.reason ?? 'Not a photo the gallery can show.',
    };
  const { id, chunkSize = 4 * 1024 * 1024 } = start;
  let offset = 0;
  let tries = 0;
  while (offset < file.size) {
    try {
      const { received } = await api<{ received: number }>(
        'PUT',
        `/uploads/${id}?offset=${offset}`,
        file.slice(offset, offset + chunkSize)
      );
      offset = received;
      tries = 0;
      onProgress?.(offset);
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.status === 409 &&
        typeof error.body?.received === 'number'
      ) {
        offset = error.body.received;
        continue;
      }
      if (error instanceof ApiError || tries >= 5) throw error;
      tries += 1;
      await wait(400 * 2 ** tries);
    }
  }
  return { id, skipped: null };
}

async function upload(job: Job) {
  setRow(job, 'uploading', 'Uploading');
  const started = await send(job.file, { album: job.album }, (sent) => {
    job.sent = sent;
    const bar = $<HTMLProgressElement>('progress', job.row);
    bar.value = job.file.size ? sent / job.file.size : 1;
    renderTray();
  });
  if (!started.id) return finish(job, 'skipped', started.skipped!);
  for (const sidecar of job.sidecars) {
    const side = await send(sidecar, {
      album: job.album,
      sidecarOf: started.id,
    });
    if (side.id) await api('POST', `/uploads/${side.id}/complete`);
  }
  job.sent = job.file.size;
  const done = await api<{
    status: Outcome;
    photoId?: string;
    path?: string;
    sameAs?: string;
    reason?: string;
  }>('POST', `/uploads/${started.id}/complete`);
  if (done.status === 'added' && done.photoId) {
    job.photoId = done.photoId;
    job.path = done.path;
    job.state = 'processing';
    setRow(job, 'processing', 'Processing');
    // its photo event may have come before this answer
    if (photoById(done.photoId)) finish(job, 'done');
    else {
      app.pending.set(done.photoId, {
        id: done.photoId,
        album: job.album,
        title: autoTitle(stripExtension(job.file.name)),
        url: URL.createObjectURL(job.file),
      });
      emit('grid');
    }
  } else if (done.status === 'duplicate') {
    const same = photoById(done.sameAs ?? null);
    const where = same
      ? `“${same.title}” in ${albumById(same.album)?.title ?? same.album}`
      : done.path;
    finish(
      job,
      'duplicate',
      `Already in the gallery: ${where ?? 'added just now'}.`
    );
  } else {
    finish(job, 'skipped', done.reason ?? 'Not a photo the gallery can show.');
  }
}

const LABELS: Record<string, string> = {
  added: 'Added',
  duplicate: 'Already there',
  skipped: 'Skipped',
  failed: 'Failed',
};

function setRow(job: Job, state: string, label: string, reason?: string) {
  job.row.dataset.state = state;
  $('.uploads_state', job.row).textContent = label;
  if (reason !== undefined) $('.uploads_reason', job.row).textContent = reason;
}

function finish(job: Job, outcome: Outcome | 'done', reason = '') {
  job.state = outcome;
  job.sent = job.file.size;
  setRow(
    job,
    outcome === 'done' ? 'done' : outcome,
    LABELS[outcome] ?? 'Added',
    reason
  );
  renderTray();
}

/** A photo event: the uploaded file that became this photo is done. */
export function photoArrived(id: string) {
  const pending = app.pending.get(id);
  if (pending) {
    app.pending.delete(id);
    setTimeout(() => URL.revokeObjectURL(pending.url), 5000);
  }
  const job = jobs.find((j) => j.photoId === id && j.state === 'processing');
  if (job) finish(job, 'done');
}

/** An error event: an uploaded file the pipeline could not read. */
export function photoFailed(path: string | null, message: string) {
  const job = path
    ? jobs.find((j) => j.state === 'processing' && j.path === path)
    : null;
  if (job) {
    if (job.photoId) app.pending.delete(job.photoId);
    finish(job, 'failed', message);
    emit('grid');
  }
}

/* ------------------------------------------------------------------ */
/* TRAY                                                                */
/* ------------------------------------------------------------------ */

function showTray() {
  tray.hidden = false;
}

function renderTray() {
  if (!jobs.length) return;
  const total = jobs.reduce((n, j) => n + j.file.size, 0);
  const sent = jobs.reduce((n, j) => n + j.sent, 0);
  const tally = (s: Job['state']) => jobs.filter((j) => j.state === s).length;
  const uploading = tally('queued') + tally('uploading');
  const processing = tally('processing');
  const added = tally('done') + processing;
  const duplicates = tally('duplicate');
  const skipped = tally('skipped');
  const failed = tally('failed');
  const photos = jobs.length;

  const title = bound('uploads-title');
  const bar = bound<HTMLProgressElement>('uploads-progress');
  bar.value = total ? sent / total : 1;
  bar.hidden = !uploading && !processing;
  if (uploading)
    title.textContent = `Uploading: ${photos - uploading} of ${count(photos, 'file')} done`;
  else if (processing)
    title.textContent = `Processing ${count(processing, 'photo')}`;
  else
    title.textContent = added
      ? `${count(added, 'photo')} added`
      : 'Nothing added';

  const parts = [];
  if (added) parts.push(`${added} added`);
  if (duplicates) parts.push(`${duplicates} already in the gallery`);
  if (skipped) parts.push(`${skipped} skipped`);
  if (failed) parts.push(`${failed} failed`);
  bound('uploads-summary').textContent = parts.length
    ? `${parts.join(', ')}.`
    : '';

  const settled = !uploading && !processing;
  if (settled && tray.dataset.settled === undefined) {
    tray.dataset.settled = '';
    announce(`${parts.join(', ')}.`);
    if (duplicates || skipped || failed)
      $<HTMLDetailsElement>('.uploads_details', tray).open = true;
  } else if (!settled) delete tray.dataset.settled;
}

$('[data-action="close-uploads"]').addEventListener('click', () => {
  tray.hidden = true;
  // finished rows go; a later upload starts a fresh list
  for (let i = jobs.length - 1; i >= 0; i--)
    if (!['queued', 'uploading', 'processing'].includes(jobs[i].state)) {
      jobs[i].row.remove();
      jobs.splice(i, 1);
    }
});

window.addEventListener('beforeunload', (event) => {
  if (jobs.some((j) => j.state === 'queued' || j.state === 'uploading'))
    event.preventDefault();
});

/* ------------------------------------------------------------------ */
/* WIRING: inputs, the grid's drop, the tree's drop                    */
/* ------------------------------------------------------------------ */

document.addEventListener('change', (event) => {
  const input = (event.target as Element).closest<HTMLInputElement>(
    'input[data-pick]'
  );
  if (!input) return;
  const picked = readInput(input);
  input.value = '';
  // a chosen folder is like a dropped one
  void plan(picked, app.album, !app.album);
});

const hasFiles = (event: DragEvent) =>
  Boolean(event.dataTransfer?.types.includes('Files')) && !isReordering();

const view = $('[data-photos-view]');
const overlay = $('[data-overlay]');
let overlayTimer = 0;

view.addEventListener('dragover', (event) => {
  if (!hasFiles(event)) return;
  event.preventDefault();
  event.dataTransfer!.dropEffect = 'copy';
  overlay.dataset.over = '';
  $('[data-empty]').dataset.over = '';
  clearTimeout(overlayTimer);
  overlayTimer = window.setTimeout(hideOverlay, 150);
});

function hideOverlay() {
  delete overlay.dataset.over;
  delete $('[data-empty]').dataset.over;
}

view.addEventListener('drop', async (event) => {
  if (!hasFiles(event)) return;
  event.preventDefault();
  hideOverlay();
  const picked = await readDrop(event.dataTransfer!);
  void plan(picked, app.album, !app.album);
});

const tree = $('[data-tree]');
let treeTimer = 0;

function treeTarget(event: DragEvent) {
  const link = (event.target as Element).closest<HTMLElement>(
    '.menu_link[data-album]'
  );
  return link?.dataset.album ? link : null;
}

function clearTree() {
  delete tree.dataset.over;
  for (const el of tree.querySelectorAll('[data-over]'))
    el.removeAttribute('data-over');
}

$('.sidebar').addEventListener('dragover', (event) => {
  if (!hasFiles(event)) return;
  event.preventDefault();
  event.dataTransfer!.dropEffect = 'copy';
  clearTree();
  const link = treeTarget(event);
  if (link) link.dataset.over = '';
  else tree.dataset.over = '';
  clearTimeout(treeTimer);
  treeTimer = window.setTimeout(clearTree, 150);
});

$('.sidebar').addEventListener('drop', async (event) => {
  if (!hasFiles(event)) return;
  event.preventDefault();
  const link = treeTarget(event);
  clearTree();
  const picked = await readDrop(event.dataTransfer!);
  void plan(picked, link?.dataset.album ?? null, true);
});

// a drop that misses every target must not open the file in the tab
window.addEventListener('dragover', (event) => {
  if (event.defaultPrevented) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'none';
});
window.addEventListener('drop', (event) => event.preventDefault());
