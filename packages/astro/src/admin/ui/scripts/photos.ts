/**
 * The photos side of the admin: the album tree in the sidebar, the grid
 * of the current album (or of every photo), the inspector for a photo or
 * an album, and the order of an album (drag and drop, or Option/Alt with
 * an arrow key, or the inspector's Move buttons).
 */
import {
  $,
  $$,
  api,
  ApiError,
  announce,
  app,
  autoTitle,
  albumById,
  bound,
  count,
  emit,
  fromTemplate,
  photoById,
  showDate,
  showImage,
  slugify,
  status,
  toast,
  type Album,
  type Attention,
  type Photo,
} from './core.ts';

const tree = $('[data-tree]');
const grid = $<HTMLOListElement>('[data-grid]');
const panel = $('[data-inspector-panel]');
const photoForm = $<HTMLFormElement>('[data-form="photo"]');
const albumForm = $<HTMLFormElement>('[data-form="album"]');

/* ------------------------------------------------------------------ */
/* TREE                                                                */
/* ------------------------------------------------------------------ */

/** Photos per album, counted live (uploads land before the next run). */
function counts() {
  const map = new Map<string, number>();
  for (const p of app.state?.photos ?? [])
    map.set(p.album, (map.get(p.album) ?? 0) + 1);
  for (const p of app.pending.values())
    if (!photoById(p.id)) map.set(p.album, (map.get(p.album) ?? 0) + 1);
  return map;
}

export function renderTree() {
  const state = app.state;
  if (!state) return;
  const focused = (document.activeElement as HTMLElement | null)?.closest(
    '[data-tree] a'
  );
  const focusHref = focused?.getAttribute('href');
  const perAlbum = counts();
  const all = $('[data-album=""]', tree);
  bound('total', all).textContent = String(
    [...perAlbum.values()].reduce((a, b) => a + b, 0)
  );
  // keep the All photos item, rebuild the albums under it
  while (tree.children.length > 1) tree.lastElementChild!.remove();
  const byParent = new Map<string | null, Album[]>();
  for (const album of state.albums) {
    const key = album.parent && albumById(album.parent) ? album.parent : null;
    byParent.set(key, [...(byParent.get(key) ?? []), album]);
  }
  const build = (parent: string | null, into: HTMLElement) => {
    for (const album of byParent.get(parent) ?? []) {
      const item = fromTemplate<HTMLLIElement>('album');
      const link = $<HTMLAnchorElement>('.menu_link', item);
      link.href = `#/album/${album.id}`;
      link.dataset.album = album.id;
      $('.menu_label', item).textContent = album.title;
      $('.menu_count', item).textContent = String(perAlbum.get(album.id) ?? 0);
      if (album.hidden) {
        item.dataset.hidden = '';
        link.title = 'Hidden from the site';
      }
      if (byParent.has(album.id)) {
        const sub = document.createElement('ul');
        sub.className = 'menu';
        build(album.id, sub);
        item.append(sub);
      }
      into.append(item);
    }
  };
  build(null, tree);
  markCurrent();
  if (focusHref) $<HTMLElement>(`a[href="${focusHref}"]`, tree)?.focus();

  // the lists other forms pick albums from
  const names = $('#album-names');
  const parents = $<HTMLSelectElement>('#new-album-parent');
  const keep = parents.value;
  names.replaceChildren();
  parents.replaceChildren(parents.options[0]);
  for (const album of state.albums) {
    const depth = album.id.split('/').length - 1;
    names.append(new Option(album.title));
    parents.append(
      new Option(
        `${'\u00a0\u00a0\u00a0'.repeat(depth)}${album.title}`,
        album.id
      )
    );
  }
  parents.value = keep;
}

/** aria-current on the sidebar link of the view you are on. */
export function markCurrent() {
  const href =
    app.route === 'photos'
      ? app.album
        ? `#/album/${app.album}`
        : '#/'
      : `#/${app.route}`;
  for (const link of $$<HTMLAnchorElement>('.sidebar .menu_link')) {
    if (link.getAttribute('href') === href)
      link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
}

/* ------------------------------------------------------------------ */
/* GRID                                                                */
/* ------------------------------------------------------------------ */

const tiles = new Map<string, HTMLLIElement>();

/** Photos whose manifest just arrived over the event stream. */
const fresh = new Set<string>();
export const markFresh = (id: string) => fresh.add(id);

/**
 * Resolves once the dev server serves a file: a `photo` event can come a
 * moment before the new thumbnail is servable. Gives up quietly (a
 * redirect to a bucket elsewhere cannot be checked from here).
 */
async function whenServed(url: string) {
  if (!url || url.startsWith('blob:')) return;
  for (let i = 0; i < 8; i++) {
    try {
      const res = await fetch(url, { method: 'HEAD', cache: 'no-store' });
      if (res.ok) return;
    } catch {
      return;
    }
    await new Promise((r) => setTimeout(r, 250 * 1.6 ** i));
  }
}

interface Tile {
  id: string;
  album: string;
  title: string;
  thumb: string;
  hidden: boolean;
  attention: Attention[];
  busy: boolean;
}

/** What the grid shows: the album's photos (or all), then uploads on their way. */
function tilesInView(): Tile[] {
  const photos = (app.state?.photos ?? []).filter(
    (p) => !app.album || p.album === app.album
  );
  const out: Tile[] = photos.map((p) => ({ ...p, busy: false }));
  for (const p of app.pending.values()) {
    if (photoById(p.id) || (app.album && p.album !== app.album)) continue;
    out.push({
      id: p.id,
      album: p.album,
      title: p.title,
      thumb: p.url,
      hidden: false,
      attention: [],
      busy: true,
    });
  }
  return out;
}

function makeTile(id: string) {
  const item = fromTemplate<HTMLLIElement>('photo');
  item.dataset.id = id;
  const image = $<HTMLImageElement>('.photos_image', item);
  image.loading = 'lazy';
  tiles.set(id, item);
  return item;
}

function updateTile(item: HTMLLIElement, tile: Tile) {
  const open = $('.photos_open', item);
  const image = $<HTMLImageElement>('.photos_image', item);
  if (image.dataset.src !== tile.thumb) {
    if (fresh.has(tile.id)) {
      // keep the local file (or the old thumbnail) until the new one is served
      fresh.delete(tile.id);
      image.dataset.src = tile.thumb;
      void whenServed(tile.thumb).then(() => {
        if (image.dataset.src !== tile.thumb) return;
        delete image.dataset.src;
        showImage(image, tile.thumb);
      });
    } else showImage(image, tile.thumb);
  }
  image.alt = tile.title;
  $('.photos_title', item).textContent = tile.title;
  $('.photos_state', item).textContent = tile.busy ? 'Processing…' : '';
  item.toggleAttribute('data-hidden', tile.hidden);
  if (tile.busy) item.setAttribute('aria-busy', 'true');
  else item.removeAttribute('aria-busy');
  item.draggable = Boolean(app.album) && !tile.busy;
  if (tile.id === app.selected) open.setAttribute('aria-current', 'true');
  else open.removeAttribute('aria-current');

  // the flags are for the pointer; the tile itself tells a screen reader
  const flagsKey = `${tile.attention.join()}|${tile.hidden}`;
  const flags = $('.photos_flags', item);
  if (flags.dataset.key !== flagsKey) {
    flags.dataset.key = flagsKey;
    const marks = [
      ...tile.attention.map((a) => fromTemplate(`flag-${a}`)),
      ...(tile.hidden ? [fromTemplate('flag-hidden')] : []),
    ];
    flags.replaceChildren(...marks);
    $('.photos_note', item).textContent = marks
      .map((m) => m.getAttribute('aria-label') ?? m.textContent?.trim())
      .join(', ');
  }
}

export function renderGrid() {
  const items = tilesInView();
  const seen = new Set<string>();
  items.forEach((tile, i) => {
    const item = tiles.get(tile.id) ?? makeTile(tile.id);
    updateTile(item, tile);
    seen.add(tile.id);
    if (grid.children[i] !== item)
      grid.insertBefore(item, grid.children[i] ?? null);
  });
  for (const [id, item] of tiles)
    if (!seen.has(id)) {
      item.remove();
      tiles.delete(id);
    }
  rove();

  // the head of the view: crumbs, title, count, the empty state
  const album = albumById(app.album);
  const crumbs = $('[data-crumbs]');
  crumbs.replaceChildren();
  if (album) {
    const chain: Album[] = [];
    for (let a = albumById(album.parent); a; a = albumById(a.parent))
      chain.unshift(a);
    for (const a of [null, ...chain]) {
      const li = document.createElement('li');
      const link = document.createElement('a');
      link.href = a ? `#/album/${a.id}` : '#/';
      link.textContent = a ? a.title : 'All photos';
      li.append(link);
      crumbs.append(li);
    }
  }
  const title =
    album?.title ?? (app.album ? autoTitle(app.album) : 'All photos');
  bound('view-title').textContent = title;
  const shown = items.length;
  bound('view-count').textContent = shown ? count(shown, 'photo') : '';
  grid.setAttribute(
    'aria-label',
    album ? `Photos in ${album.title}` : 'All photos'
  );

  const empty = $('[data-empty]');
  empty.hidden = shown > 0;
  bound('empty-title').textContent = app.album
    ? 'Drop photos here'
    : 'Drop a folder of photos here';
  bound('empty-text').textContent = app.album
    ? `They go into ${title}. Folders inside a dropped folder become albums inside ${title}.`
    : 'Each folder becomes an album, and folders inside it become albums inside that one. The files themselves are never changed.';
  bound('empty-path', empty).textContent = album ? album.path : 'album name';
  bound('overlay-title').textContent = album
    ? `Drop to add to ${album.title}`
    : 'Drop folders to make albums';
}

/** One tab stop in the grid: the open photo, else the last focused, else the first. */
let lastFocused: string | null = null;
function rove() {
  const buttons = $$<HTMLButtonElement>('.photos_open', grid);
  const keep =
    tiles.get(app.selected ?? '') ??
    tiles.get(lastFocused ?? '') ??
    (grid.firstElementChild as HTMLLIElement | null);
  for (const b of buttons) b.tabIndex = -1;
  if (keep) $<HTMLButtonElement>('.photos_open', keep).tabIndex = 0;
}

function focusTile(item: Element | null | undefined) {
  if (!item) return;
  const button = $<HTMLButtonElement>('.photos_open', item);
  for (const b of $$<HTMLButtonElement>('.photos_open', grid)) b.tabIndex = -1;
  button.tabIndex = 0;
  button.focus();
  lastFocused = (item as HTMLElement).dataset.id ?? null;
}

const columns = () => {
  const items = [...grid.children] as HTMLElement[];
  const top = items[0]?.offsetTop;
  const n = items.findIndex((el) => el.offsetTop !== top);
  return n === -1 ? items.length : n;
};

grid.addEventListener('click', (event) => {
  const target = event.target as Element;
  const item = target.closest<HTMLLIElement>('.photos_item');
  if (!item || item.hasAttribute('aria-busy')) return;
  const flag = target.closest<HTMLElement>('[data-attention]');
  lastFocused = item.dataset.id!;
  select(item.dataset.id!, (flag?.dataset.attention as Attention) ?? null);
});

grid.addEventListener('keydown', (event) => {
  const button = (event.target as Element).closest('.photos_open');
  if (!button) return;
  const items = [...grid.children];
  const item = button.parentElement!;
  const i = items.indexOf(item);
  const cols = columns();
  const step: Record<string, number> = {
    ArrowLeft: -1,
    ArrowRight: 1,
    ArrowUp: -cols,
    ArrowDown: cols,
  };
  let to: number | null = null;
  if (event.key in step) to = i + step[event.key];
  else if (event.key === 'Home') to = 0;
  else if (event.key === 'End') to = items.length - 1;
  if (to === null) return;
  event.preventDefault();
  to = Math.max(0, Math.min(items.length - 1, to));
  if (event.altKey && app.album && event.key.startsWith('Arrow')) {
    move((item as HTMLElement).dataset.id!, to);
    focusTile(tiles.get((item as HTMLElement).dataset.id!));
    return;
  }
  focusTile(items[to]);
});

/* ------------------------------------------------------------------ */
/* ORDER                                                               */
/* ------------------------------------------------------------------ */

let saveOrderTimer = 0;

/** Move a photo of the current album to a new index, then save the order. */
export function move(id: string, to: number) {
  const state = app.state;
  const albumId = app.album;
  if (!state || !albumId) return;
  const ids = state.photos.filter((p) => p.album === albumId).map((p) => p.id);
  const from = ids.indexOf(id);
  if (from === -1 || to === from) return;
  ids.splice(from, 1);
  ids.splice(Math.max(0, Math.min(ids.length, to)), 0, id);
  const byId = new Map(state.photos.map((p) => [p.id, p]));
  const first = state.photos.findIndex((p) => p.album === albumId);
  const rest = state.photos.filter((p) => p.album !== albumId);
  rest.splice(first, 0, ...ids.map((x) => byId.get(x)!));
  state.photos = rest;
  renderGrid();
  const photo = byId.get(id)!;
  announce(`${photo.title} moved to ${to + 1} of ${ids.length}.`);
  const album = albumById(albumId);
  if (album && album.sort !== 'manual') {
    album.sort = 'manual';
    if (panel.dataset.inspector === 'album') fillAlbum();
  }
  clearTimeout(saveOrderTimer);
  saveOrderTimer = window.setTimeout(async () => {
    const order = state.photos
      .filter((p) => p.album === albumId)
      .map((p) => p.file);
    try {
      const result = await api<{ album: Album }>(
        'PUT',
        `/albums/${encodeURIComponent(albumId)}/order`,
        { order }
      );
      replaceAlbum(result.album);
    } catch (error) {
      toast('The new order was not saved', (error as Error).message);
    }
  }, 500);
}

let dragging: string | null = null;

grid.addEventListener('dragstart', (event) => {
  const item = (event.target as Element).closest<HTMLLIElement>(
    '.photos_item[draggable="true"]'
  );
  if (!item || !event.dataTransfer) return;
  dragging = item.dataset.id!;
  event.dataTransfer.effectAllowed = 'move';
  // Firefox starts a drag only with data set
  event.dataTransfer.setData('text/plain', item.dataset.id!);
  item.classList.add('is-dragging');
});

/** Where a dragged photo would land: before or after the tile under the pointer. */
function dropSpot(event: DragEvent) {
  const item = (event.target as Element).closest<HTMLLIElement>('.photos_item');
  if (!item || item.dataset.id === dragging) return null;
  const box = item.getBoundingClientRect();
  return {
    item,
    after: event.clientX > box.left + box.width / 2,
  };
}

grid.addEventListener('dragover', (event) => {
  if (!dragging) return;
  event.preventDefault();
  event.stopPropagation();
  event.dataTransfer!.dropEffect = 'move';
  for (const el of $$('[data-drop]', grid)) el.removeAttribute('data-drop');
  const spot = dropSpot(event);
  if (spot) spot.item.dataset.drop = spot.after ? 'after' : 'before';
});

grid.addEventListener('drop', (event) => {
  if (!dragging) return;
  event.preventDefault();
  event.stopPropagation();
  const spot = dropSpot(event);
  if (spot) {
    const items = [...grid.children] as HTMLElement[];
    const from = items.findIndex((el) => el.dataset.id === dragging);
    let to = items.indexOf(spot.item) + (spot.after ? 1 : 0);
    if (from < to) to -= 1;
    move(dragging, to);
  }
  endDrag();
});

function endDrag() {
  dragging = null;
  for (const el of $$('[data-drop]', grid)) el.removeAttribute('data-drop');
  for (const el of $$('.is-dragging', grid)) el.classList.remove('is-dragging');
}
grid.addEventListener('dragend', endDrag);

export const isReordering = () => dragging !== null;

/* ------------------------------------------------------------------ */
/* INSPECTOR                                                           */
/* ------------------------------------------------------------------ */

interface Gps {
  lat: number;
  lon: number;
}

interface Detail extends Photo {
  caption: string | null;
  cameraData: Record<string, string | null>;
  gps: Gps | null;
  keywords: string[];
  place: Record<string, string | null> | null;
  copyright: string | null;
  author: string | null;
  preview: string;
  extracted: Record<string, unknown> & {
    from?: Record<string, string>;
    place?: Record<string, string | null> | null;
  };
  overrides: Record<string, unknown> & {
    place?: Record<string, string | null>;
  };
  overridesFile: string | null;
}

let detail: Detail | null = null;

const TEXT = ['title', 'caption', 'date', 'keywords', 'author', 'copyright'];
const PLACE = ['location', 'city', 'state', 'country'];

const FROM: Record<string, string> = {
  album: 'From the album',
  'xmp-sidecar': 'From the .xmp file',
  xmp: 'From the file',
  iptc: 'From the file',
  exif: 'From the camera',
  filename: 'From the file name',
  mtime: 'From the file’s date',
};

/** Map coordinates as the inspector shows them: `35.0116, 135.7681`. */
const showGps = ({ lat, lon }: Gps) =>
  `${Math.round(lat * 1e6) / 1e6}, ${Math.round(lon * 1e6) / 1e6}`;

/**
 * Map coordinates as Apple Maps, Google Maps and most sites copy them:
 * `35.0116, 135.7681`, `-33.8568 151.2153` or `35.0116° N, 135.7681° E`.
 * Undefined when the text is not a latitude and a longitude in range.
 */
export function parseGps(text: string): Gps | undefined {
  const m =
    /^\s*(-?\d+(?:\.\d+)?)\s*°?\s*([NS])?\s*(?:,\s*|\s+)(-?\d+(?:\.\d+)?)\s*°?\s*([EW])?\s*$/i.exec(
      text
    );
  if (!m) return undefined;
  const lat = Number(m[1]) * (/s/i.test(m[2] ?? '') ? -1 : 1);
  const lon = Number(m[3]) * (/w/i.test(m[4] ?? '') ? -1 : 1);
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return undefined;
  return { lat: Math.round(lat * 1e6) / 1e6, lon: Math.round(lon * 1e6) / 1e6 };
}

/** The value of a field as the inspector shows it. */
function asText(name: string, value: unknown): string {
  if (value === null || value === undefined) return '';
  if (name === 'date') return showDate(String(value));
  if (name === 'gps') return showGps(value as Gps);
  if (Array.isArray(value)) return value.join(', ');
  return String(value);
}

/** What a typed value means for the API. */
function fromText(name: string, text: string): unknown {
  if (name === 'keywords')
    return text
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean);
  if (name === 'date') return text.trim().replace(' ', 'T');
  if (name === 'gps') return parseGps(text) ?? text;
  return text;
}

/** The map link under the coordinates, for the value in the field. */
function updateMapLink() {
  const input = control<HTMLInputElement>(photoForm, 'gps');
  const gps = parseGps(input.value.trim() || input.dataset.extracted || '');
  const link = bound<HTMLAnchorElement>('gps-map');
  link.hidden = !gps;
  if (gps)
    link.href = `https://www.openstreetmap.org/?mlat=${gps.lat}&mlon=${gps.lon}#map=15/${gps.lat}/${gps.lon}`;
}

const control = <T extends HTMLElement = HTMLInputElement>(
  form: HTMLFormElement,
  name: string
) => form.elements.namedItem(name) as unknown as T;

function setEntry(name: string, value: unknown, extracted: unknown) {
  const input = control<HTMLInputElement | HTMLTextAreaElement>(
    photoForm,
    name
  );
  const shown = asText(name.replace('place.', ''), extracted);
  input.value = asText(name, value);
  // a lone space keeps :placeholder-shown working when the file has nothing
  input.placeholder = shown || ' ';
  input.dataset.extracted = shown;
}

/** Open a photo in the inspector, optionally on the field a flag points at. */
export async function select(
  id: string | null,
  focus: Attention | null = null
) {
  app.selected = id;
  renderGrid();
  if (!id) {
    detail = null;
    showInspector();
    return;
  }
  showInspector();
  photoForm.setAttribute('aria-busy', 'true');
  try {
    detail = await api<Detail>('GET', `/photos/${encodeURIComponent(id)}`);
  } catch (error) {
    toast('This photo could not be opened', (error as Error).message);
    photoForm.removeAttribute('aria-busy');
    return;
  }
  if (app.selected !== id) return;
  fillPhoto();
  photoForm.removeAttribute('aria-busy');
  if (focus === 'no-date') $<HTMLInputElement>('#p-date').focus();
  else if (focus)
    $<HTMLElement>(`[data-notice="${focus}"]`, photoForm)?.focus();
}

function fillPhoto() {
  if (!detail) return;
  const d = detail;
  const ex = d.extracted;
  const ov = d.overrides;
  delete photoForm.dataset.dirty;
  status(
    photoForm,
    d.overridesFile ? `Your changes are in ${d.overridesFile}.` : ''
  );

  const preview = bound<HTMLImageElement>('photo-preview');
  showImage(preview, d.preview || d.thumb);
  preview.style.setProperty('--inspector-ratio', `${d.width} / ${d.height}`);
  bound('photo-title').textContent = d.title;
  bound('photo-file').textContent = `photos/${d.source}`;

  for (const name of TEXT) setEntry(name, ov[name], ex[name]);
  for (const key of PLACE)
    setEntry(`place.${key}`, ov.place?.[key], ex.place?.[key]);
  setEntry('gps', ov.gps, ex.gps);
  updateMapLink();
  for (const name of [...TEXT, 'gps']) {
    const entry = $(`[data-field="${name}"]`, photoForm);
    const from = $('.entry_from', entry);
    if (from) from.textContent = FROM[ex.from?.[name] ?? ''] ?? 'From the file';
  }

  control<HTMLInputElement>(photoForm, 'hidden').checked = Boolean(
    ov.hidden ?? ex.hidden
  );

  // what the file says about the camera, read only
  for (const [key, value] of Object.entries(d.cameraData ?? {})) {
    const dd = bound(`camera-${key}`);
    dd.textContent = value ?? 'Not in the file';
    dd.toggleAttribute('data-missing', value === null);
  }

  // the date field says plainly when the photo has no date
  const undated = d.attention.includes('no-date');
  $('[data-field="date"]', photoForm).toggleAttribute('data-attention', undated);
  bound('date-hint').textContent = undated
    ? 'The file holds no date. Type the date the photo was taken: 2005-02-27 14:30.'
    : 'Year, month, day, then the time if you know it: 2005-02-27 14:30.';

  // attention notices
  const notices = $('[data-notices]', photoForm);
  notices.replaceChildren();
  for (const a of d.attention) {
    const notice = fromTemplate(`notice-${a}`);
    if (a === 'duplicate') {
      const others = (d.duplicateOf ?? [])
        .map((x) => photoById(x))
        .filter(Boolean) as Photo[];
      const actions = $('[data-duplicates]', notice);
      for (const other of others) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'bt';
        const where = albumById(other.album)?.title ?? other.album;
        button.textContent = `Open “${other.title}” in ${where}`;
        button.addEventListener('click', () => {
          location.hash = `#/album/${other.album}`;
          void select(other.id);
        });
        actions.append(button);
      }
      if (others.length)
        bound('duplicate-text', notice).textContent =
          'Another photo in the gallery has exactly the same file. If you meant to show it twice, nothing needs to change; otherwise hide one of them.';
    }
    notices.append(notice);
  }

  const inAlbum = Boolean(app.album);
  for (const b of $$<HTMLButtonElement>('[data-action="move"]', photoForm))
    b.hidden = !inAlbum;
}

/** The overrides the form asks for that differ from what the .md holds now. */
function changedOverrides() {
  if (!detail) return {};
  const out: Record<string, unknown> = {};
  const ov = detail.overrides;
  const same = (a: unknown, b: unknown) =>
    JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  for (const name of TEXT) {
    const input = control<HTMLInputElement>(photoForm, name);
    const text = input.value.trim();
    const next =
      text && text !== input.dataset.extracted ? fromText(name, text) : null;
    const now =
      ov[name] === undefined ? null : fromText(name, asText(name, ov[name]));
    if (!same(next, now)) out[name] = next;
  }
  const place: Record<string, string | null> = {};
  for (const key of PLACE) {
    const input = control<HTMLInputElement>(photoForm, `place.${key}`);
    const text = input.value.trim();
    const next = text && text !== input.dataset.extracted ? text : null;
    if (!same(next, ov.place?.[key])) place[key] = next;
  }
  if (Object.keys(place).length) out.place = place;
  const gpsInput = control<HTMLInputElement>(photoForm, 'gps');
  const gpsText = gpsInput.value.trim();
  const nextGps =
    gpsText && gpsText !== gpsInput.dataset.extracted
      ? (parseGps(gpsText) ?? gpsText)
      : null;
  if (!same(nextGps, ov.gps)) out.gps = nextGps;
  const hidden = control<HTMLInputElement>(photoForm, 'hidden').checked;
  const nextHidden =
    hidden === Boolean(detail.extracted.hidden) ? null : hidden;
  if (!same(nextHidden, ov.hidden)) out.hidden = nextHidden;
  return out;
}

photoForm.addEventListener('input', (event) => {
  photoForm.dataset.dirty = '';
  status(photoForm, 'Not saved yet.');
  if ((event.target as HTMLElement).id === 'p-gps') updateMapLink();
});

photoForm.addEventListener('click', (event) => {
  const target = event.target as HTMLElement;
  const entry = target.closest('.entry');
  const input = entry ? $<HTMLInputElement>('.entry_control', entry) : null;
  if (target.closest('.entry_action-edit') && input) {
    input.value = input.dataset.extracted ?? '';
    input.focus();
    input.dispatchEvent(new Event('input', { bubbles: true }));
  } else if (target.closest('.entry_action-reset') && input) {
    input.value = '';
    input.focus();
    input.dispatchEvent(new Event('input', { bubbles: true }));
  } else if (target.closest('[data-action="close"]')) {
    const id = app.selected;
    void select(null);
    focusTile(tiles.get(id ?? ''));
  } else if (target.closest('[data-action="move"]') && app.selected) {
    const by = Number(target.closest<HTMLElement>('[data-by]')!.dataset.by);
    const ids = [...grid.children].map((el) => (el as HTMLElement).dataset.id);
    move(app.selected, ids.indexOf(app.selected) + by);
  }
});

photoForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!detail) return;
  const date = control<HTMLInputElement>(photoForm, 'date');
  if (!date.checkValidity()) {
    status(
      photoForm,
      'The date needs to look like 2005-02-27 or 2005-02-27 14:30.'
    );
    date.focus();
    return;
  }
  const gps = control<HTMLInputElement>(photoForm, 'gps');
  if (gps.value.trim() && !parseGps(gps.value)) {
    status(
      photoForm,
      'The map location needs a latitude and a longitude, like 35.0116, 135.7681.'
    );
    gps.focus();
    return;
  }
  const changes = changedOverrides();
  if (!Object.keys(changes).length) {
    status(photoForm, 'Nothing to save.');
    return;
  }
  const id = detail.id;
  const submit = $<HTMLButtonElement>('[type="submit"]', photoForm);
  submit.setAttribute('aria-busy', 'true');
  try {
    const result = await api<{
      overrides: Detail['overrides'];
      overridesFile: string | null;
    }>('PUT', `/photos/${encodeURIComponent(id)}/overrides`, changes);
    if (detail?.id === id) {
      detail.overrides = result.overrides;
      detail.overridesFile = result.overridesFile;
      fillPhoto();
      status(
        photoForm,
        result.overridesFile
          ? `Saved to ${result.overridesFile}.`
          : 'Saved. The file’s own values apply again.'
      );
    }
  } catch (error) {
    status(photoForm, `Not saved: ${(error as Error).message}`);
  } finally {
    submit.removeAttribute('aria-busy');
  }
});

/** A photo's manifest changed: refresh the inspector if it shows that photo. */
export function photoUpdated(id: string) {
  if (app.selected === id && photoForm.dataset.dirty === undefined)
    void select(id);
}

/* album inspector */

function fillAlbum() {
  const album = albumById(app.album);
  if (!album) return;
  delete albumForm.dataset.dirty;
  status(albumForm, '');
  const photos = (app.state?.photos ?? []).filter((p) => p.album === album.id);
  // The album's first photo stands for it, as in the gallery.
  const first = photos[0];
  const preview = bound<HTMLImageElement>('album-preview');
  if (first) {
    showImage(preview, first.thumb);
    preview.style.setProperty(
      '--inspector-ratio',
      `${first.width} / ${first.height}`
    );
  } else {
    delete preview.dataset.src;
    preview.removeAttribute('src');
  }
  bound('album-title').textContent = album.title;
  bound('album-path').textContent = `photos/${album.path}/`;
  const title = control<HTMLInputElement>(albumForm, 'title');
  title.value = album.title;
  title.placeholder = autoTitle(album.path.split('/').pop() ?? album.path);
  control<HTMLTextAreaElement>(albumForm, 'description').value =
    album.description ?? '';
  for (const radio of $$<HTMLInputElement>('[name="sort"]', albumForm))
    radio.checked = radio.value === album.sort;
  control<HTMLInputElement>(albumForm, 'hidden').checked = album.hidden;
}

albumForm.addEventListener('input', () => {
  albumForm.dataset.dirty = '';
  status(albumForm, 'Not saved yet.');
});

albumForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const album = albumById(app.album);
  if (!album) return;
  const changes: Record<string, unknown> = {};
  const title = control<HTMLInputElement>(albumForm, 'title').value.trim();
  if (title !== album.title) changes.title = title || null;
  const description = control<HTMLTextAreaElement>(
    albumForm,
    'description'
  ).value.trim();
  if (description !== (album.description ?? '').trim())
    changes.description = description || null;
  const sort = $<HTMLInputElement>('[name="sort"]:checked', albumForm)?.value;
  if (sort && sort !== album.sort) changes.sort = sort;
  const hidden = control<HTMLInputElement>(albumForm, 'hidden').checked;
  if (hidden !== album.hidden) changes.hidden = hidden;
  if (!Object.keys(changes).length) {
    status(albumForm, 'Nothing to save.');
    return;
  }
  const submit = $<HTMLButtonElement>('[type="submit"]', albumForm);
  submit.setAttribute('aria-busy', 'true');
  try {
    const result = await api<{ album: Album }>(
      'PUT',
      `/albums/${encodeURIComponent(album.id)}`,
      changes
    );
    replaceAlbum(result.album);
    status(albumForm, `Saved to photos/${result.album.path}/_album.md.`);
  } catch (error) {
    status(albumForm, `Not saved: ${(error as Error).message}`);
  } finally {
    submit.removeAttribute('aria-busy');
  }
});

function replaceAlbum(album: Album) {
  const state = app.state;
  if (!state) return;
  const i = state.albums.findIndex((a) => a.id === album.id);
  if (i === -1) state.albums.push(album);
  else state.albums[i] = { ...state.albums[i], ...album };
  renderTree();
  renderGrid();
  if (panel.dataset.inspector === 'album') fillAlbum();
}

/** Which form the inspector shows, if any. */
export function showInspector() {
  if (app.route === 'photos' && app.selected) {
    panel.dataset.inspector = 'photo';
  } else if (app.route === 'photos' && app.album && albumById(app.album)) {
    panel.dataset.inspector = 'album';
    if (albumForm.dataset.dirty === undefined) fillAlbum();
  } else {
    delete panel.dataset.inspector;
  }
}

/* ------------------------------------------------------------------ */
/* NEW ALBUM                                                           */
/* ------------------------------------------------------------------ */

/**
 * Create an album folder. `segments` are folder names under `parent`; the
 * API slugs each one, and the title is written only when the folder's
 * own name would not give it back.
 */
export async function createAlbum(parent: string | null, name: string) {
  const id = [parent, slugify(name)].filter(Boolean).join('/');
  const path = [parent, name].filter(Boolean).join('/');
  const title = autoTitle(slugify(name)) === autoTitle(name) ? undefined : name;
  try {
    const { album } = await api<{ album: Album }>('POST', '/albums', {
      path,
      ...(title ? { title } : {}),
    });
    if (app.state && !albumById(album.id)) app.state.albums.push(album);
    return album.id;
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) return id;
    throw error;
  }
}

const newAlbum = $<HTMLFormElement>('[data-form="new-album"]');
const newAlbumSheet = $('#new-album');

newAlbumSheet.addEventListener('toggle', (event) => {
  if ((event as ToggleEvent).newState !== 'open') return;
  control<HTMLSelectElement>(newAlbum, 'parent').value = app.album ?? '';
  control<HTMLInputElement>(newAlbum, 'title').focus();
});

newAlbum.addEventListener('submit', async (event) => {
  event.preventDefault();
  const name = control<HTMLInputElement>(newAlbum, 'title').value.trim();
  const parent = control<HTMLSelectElement>(newAlbum, 'parent').value || null;
  if (!name) return;
  if (albumById([parent, slugify(name)].filter(Boolean).join('/'))) {
    status(newAlbum, 'There is already an album with that name here.');
    return;
  }
  try {
    const id = await createAlbum(parent, name);
    newAlbum.reset();
    status(newAlbum, '');
    newAlbumSheet.hidePopover();
    renderTree();
    location.hash = `#/album/${id}`;
    announce(`Album ${name} created.`);
  } catch (error) {
    status(newAlbum, `Not created: ${(error as Error).message}`);
  }
});

/** After a reload of the state: drop a selection that no longer exists. */
export function afterRefresh() {
  if (app.selected && !photoById(app.selected)) app.selected = null;
  emit('inspector');
}

/** Escape closes the photo in the inspector. */
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || app.route !== 'photos' || !app.selected) return;
  if ((event.target as Element).closest('dialog, [popover]')) return;
  const id = app.selected;
  void select(null);
  focusTile(tiles.get(id));
});
