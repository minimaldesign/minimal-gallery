/**
 * The admin's script entry: the hash routes, the state from `GET /state`
 * and its live updates over Server-Sent Events (`/events`), and what
 * belongs to no single view (the gallery's name, the first-run checklist,
 * the queue line, the Preview links). The views live in ./scripts.
 *
 * The event stream reconnects by itself after a dev-server restart (a
 * settings edit causes one); every `open` reloads the state.
 */
import {
  $,
  $$,
  API,
  TOKEN,
  api,
  app,
  bound,
  count,
  on,
  photoById,
  toast,
  type Album,
  type FirstRun,
  type Photo,
  type Queue,
  type State,
} from './scripts/core.ts';
import {
  afterRefresh,
  markCurrent,
  markFresh,
  photoUpdated,
  renderGrid,
  renderTree,
  select,
  showInspector,
} from './scripts/photos.ts';
import { photoArrived, photoFailed } from './scripts/uploads.ts';
import {
  jobEvent,
  loadPublish,
  loadSettings,
  logLine,
} from './scripts/site.ts';

const html = document.documentElement;

/* ------------------------------------------------------------------ */
/* ROUTES: #/, #/album/<id>, #/settings, #/publish                     */
/* ------------------------------------------------------------------ */

function readRoute() {
  const hash = decodeURIComponent(location.hash.replace(/^#/, '')) || '/';
  const previousAlbum = app.album;
  if (hash.startsWith('/album/')) {
    app.route = 'photos';
    app.album = hash.slice('/album/'.length).replace(/\/$/, '') || null;
  } else if (hash === '/settings' || hash === '/publish') {
    app.route = hash.slice(1) as 'settings' | 'publish';
  } else {
    app.route = 'photos';
    app.album = null;
  }
  if (app.album !== previousAlbum && app.selected) {
    const photo = photoById(app.selected);
    if (!photo || (app.album && photo.album !== app.album)) app.selected = null;
  }
  html.dataset.route = app.route;
  markCurrent();
  if (app.route === 'settings') void loadSettings();
  if (app.route === 'publish') void loadPublish();
  if (app.route === 'photos') {
    renderGrid();
    showInspector();
  }
}

window.addEventListener('hashchange', readRoute);

/* ------------------------------------------------------------------ */
/* STATE                                                               */
/* ------------------------------------------------------------------ */

async function refresh() {
  try {
    app.state = await api<State>('GET', '/state');
  } catch (error) {
    bound('queue').textContent = 'The admin is not answering.';
    toast('The gallery could not be read', (error as Error).message);
    return;
  }
  renderAll();
}

let refreshTimer = 0;
const refreshSoon = () => {
  clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(refresh, 300);
};

function renderAll() {
  const state = app.state;
  if (!state) return;
  bound('name').textContent = state.gallery.name;
  document.title = `${state.gallery.name}: admin`;
  renderTree();
  afterRefresh();
  readRoute();
  renderChecklist(state.firstRun);
  renderQueue(state.queue);
}

on('grid', () => {
  renderGrid();
  renderTree();
});
on('albums-changed', () => renderTree());
on('refresh', refreshSoon);
on('inspector', showInspector);

/* ------------------------------------------------------------------ */
/* CHECKLIST AND QUEUE                                                 */
/* ------------------------------------------------------------------ */

function renderChecklist(firstRun: FirstRun) {
  const list = $<HTMLDetailsElement>('[data-checklist]');
  const steps = ['photos', 'named', 'previewed', 'published'] as const;
  const done = steps.filter((s) => firstRun[s]).length;
  for (const step of steps) {
    const item = $(`[data-step="${step}"]`, list);
    item.toggleAttribute('data-done', firstRun[step]);
    $('[data-done-text]', item).textContent = firstRun[step] ? ', done' : '';
  }
  bound('steps', list).textContent = `${done} of 4`;
  list.hidden = done === steps.length;
}

function renderQueue(queue: Queue) {
  const box = $('[data-queue]');
  const label = bound('queue');
  const bar = bound<HTMLProgressElement>('queue-progress');
  const bucket = app.state?.bucket;
  box.dataset.state = queue.running
    ? 'running'
    : queue.paused
      ? 'paused'
      : 'idle';
  if (queue.running) {
    label.textContent = queue.total
      ? `Processing ${queue.done + 1 > queue.total ? queue.total : queue.done + 1} of ${count(queue.total, 'photo')}`
      : 'Reading the photos…';
    bar.max = Math.max(1, queue.total);
    bar.value = queue.done;
  } else if (queue.paused) {
    label.textContent = 'Paused while publishing';
  } else if (queue.queued) {
    label.textContent = 'Waiting for changes to settle…';
  } else {
    const parts = ['Up to date'];
    if (queue.errors)
      parts.push(`${count(queue.errors, 'photo')} could not be read`);
    if (bucket?.pending)
      parts.push(`${count(bucket.pending, 'file')} to upload`);
    label.textContent = parts.join(' · ');
  }
}

/* ------------------------------------------------------------------ */
/* EVENTS                                                              */
/* ------------------------------------------------------------------ */

const data = <T>(event: Event) => JSON.parse((event as MessageEvent).data) as T;

function connect() {
  let opened = false;
  const events = new EventSource(
    `${API}/events?token=${encodeURIComponent(TOKEN)}`
  );
  events.addEventListener('open', () => {
    // the first open follows the page's own load; later ones are reconnects
    if (opened) void refresh();
    opened = true;
  });

  events.addEventListener('queue', (event) => {
    const queue = data<Queue>(event);
    if (!app.state) return;
    const wasRunning = app.state.queue.running;
    app.state.queue = queue;
    renderQueue(queue);
    if (wasRunning && !queue.running) refreshSoon();
  });

  events.addEventListener('photo', (event) => {
    const photo = data<Photo>(event);
    const state = app.state;
    if (!state) return;
    const i = state.photos.findIndex((p) => p.id === photo.id);
    if (i !== -1) state.photos[i] = photo;
    else {
      // after the last photo of its album, else at the end
      let at = -1;
      state.photos.forEach((p, j) => p.album === photo.album && (at = j));
      state.photos.splice(at === -1 ? state.photos.length : at + 1, 0, photo);
    }
    state.firstRun.photos = true;
    markFresh(photo.id);
    photoArrived(photo.id);
    renderGrid();
    renderTree();
    renderChecklist(state.firstRun);
    photoUpdated(photo.id);
  });

  events.addEventListener('photo-removed', (event) => {
    const { id } = data<{ id: string }>(event);
    if (!app.state) return;
    app.state.photos = app.state.photos.filter((p) => p.id !== id);
    if (app.selected === id) void select(null);
    renderGrid();
    renderTree();
  });

  events.addEventListener('albums', (event) => {
    if (!app.state) return;
    app.state.albums = data<Album[]>(event);
    renderTree();
    refreshSoon();
  });

  events.addEventListener('settings', () => refreshSoon());

  // a named `error` event carries data; the connection's own error does not
  events.addEventListener('error', (event) => {
    if (!(event instanceof MessageEvent) || !event.data) {
      bound('queue').textContent = 'Reconnecting…';
      return;
    }
    const { path, message } = data<{ path: string | null; message: string }>(
      event
    );
    photoFailed(path, message);
    toast(
      path
        ? `${path.replace(/^photos\//, '')} could not be read`
        : 'A run failed',
      message
    );
  });

  events.addEventListener('log', (event) => logLine(data(event)));
  events.addEventListener('job', (event) => jobEvent(data(event)));
}

/* ------------------------------------------------------------------ */
/* LINKS                                                               */
/* ------------------------------------------------------------------ */

document.addEventListener('click', (event) => {
  const target = event.target as Element;
  if (
    target.closest('[data-preview]') &&
    app.state &&
    !app.state.firstRun.previewed
  ) {
    app.state.firstRun.previewed = true;
    renderChecklist(app.state.firstRun);
    api('POST', '/first-run/previewed').catch(() => {});
  }
  const focus = target.closest<HTMLElement>('[data-focus]')?.dataset.focus;
  if (focus) setTimeout(() => document.getElementById(focus)?.focus(), 50);
});

/* ------------------------------------------------------------------ */
/* NO RELOADS                                                          */
/* ------------------------------------------------------------------ */

// Astro reloads every open page when the content store changes, which
// happens after each pipeline run, and Vite reloads them after a
// dev-server restart (a settings edit causes one). The admin follows the
// gallery over its own event stream, and a reload would drop uploads in
// progress and unsaved edits. A listener that never settles holds Vite's
// client before it reloads; reload the tab by hand after editing the
// admin's own code.
if (import.meta.hot) {
  const hold = () => new Promise<never>(() => {});
  import.meta.hot.on('vite:beforeFullReload', hold);
  import.meta.hot.on('vite:ws:disconnect', hold);
}

connect();
void refresh();
