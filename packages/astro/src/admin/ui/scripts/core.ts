/**
 * What every part of the admin's script shares: the API client (HTTP with
 * the per-process token, read from the page), the shapes the API sends,
 * the one state object, and small DOM helpers (templates, announcements,
 * error toasts). Nothing here touches Node: the page could be hosted by
 * anything that serves the same API.
 */

export type Attention = 'date-from-mtime' | 'no-exif' | 'duplicate';

export interface Photo {
  id: string;
  album: string;
  file: string;
  source: string;
  slug: string;
  title: string;
  date: string | null;
  dateSource: string;
  width: number;
  height: number;
  hidden: boolean;
  color?: string;
  thumb: string;
  attention: Attention[];
  duplicateOf?: string[];
}

export interface Album {
  id: string;
  path: string;
  parent: string | null;
  title: string;
  description: string | null;
  sort: 'date' | 'name' | 'manual';
  order: string[];
  hidden: boolean;
  date: string | null;
  count: number;
  children: string[];
}

export interface Queue {
  running: boolean;
  queued: boolean;
  paused: boolean;
  total: number;
  done: number;
  pending: number;
  current: string | null;
  errors: number;
}

export interface Gallery {
  name: string;
  description: string | null;
  author: string | null;
  site: string | null;
  storage: { mode: 'repo' | 's3'; bucket?: string; credentials?: boolean };
  albumsSort: 'date' | 'name' | 'manual';
}

export interface FirstRun {
  photos: boolean;
  named: boolean;
  previewed: boolean;
  published: boolean;
}

export interface State {
  gallery: Gallery;
  albums: Album[];
  photos: Photo[];
  firstRun: FirstRun;
  queue: Queue;
  bucket: { pending: number } | null;
}

/** A photo that was uploaded and waits for its manifest. */
export interface Pending {
  id: string;
  album: string;
  title: string;
  url: string;
}

const meta = (name: string) =>
  document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)?.content ??
  '';

export const TOKEN = meta('mg-admin-token');
export const API = meta('mg-admin-api');
export const ROOT = meta('mg-root') || '/';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body: Record<string, unknown> | null
  ) {
    super(message);
  }
}

/** One API call: JSON in and out, or raw bytes in (an upload chunk). */
export async function api<T = unknown>(
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const headers: Record<string, string> = { 'x-mg-admin': TOKEN };
  let payload: BodyInit | undefined;
  if (body instanceof Blob) {
    payload = body;
    headers['content-type'] = 'application/octet-stream';
  } else if (body !== undefined) {
    payload = JSON.stringify(body);
    headers['content-type'] = 'application/json';
  }
  const res = await fetch(API + path, { method, headers, body: payload });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const obj = (data ?? null) as Record<string, unknown> | null;
    throw new ApiError(
      res.status,
      typeof obj?.error === 'string' ? obj.error : res.statusText,
      obj
    );
  }
  return data as T;
}

/** The admin's state: the API's view of the gallery plus what the UI adds. */
export const app = {
  state: null as State | null,
  route: 'photos' as 'photos' | 'settings' | 'publish',
  /** The album on #/album/<id>; null on #/ (every photo). */
  album: null as string | null,
  /** The photo open in the inspector. */
  selected: null as string | null,
  /** Uploaded photos waiting for their manifest, by photo id. */
  pending: new Map<string, Pending>(),
};

/** A tiny event bus, so the parts can ask for a render without importing each other. */
type Handler = (detail?: unknown) => void;
const handlers = new Map<string, Handler[]>();
export const on = (name: string, fn: Handler) =>
  handlers.set(name, [...(handlers.get(name) ?? []), fn]);
export const emit = (name: string, detail?: unknown) =>
  handlers.get(name)?.forEach((fn) => fn(detail));

export const $ = <T extends Element = HTMLElement>(
  selector: string,
  scope: ParentNode = document
) => scope.querySelector<T>(selector) as T;

export const $$ = <T extends Element = HTMLElement>(
  selector: string,
  scope: ParentNode = document
) => [...scope.querySelectorAll<T>(selector)];

/** The element marked data-bind="<name>". */
export const bound = <T extends Element = HTMLElement>(
  name: string,
  scope: ParentNode = document
) => $<T>(`[data-bind="${name}"]`, scope);

/** A copy of <template data-template="<name>">'s first element. */
export function fromTemplate<T extends Element = HTMLElement>(name: string): T {
  const template = $<HTMLTemplateElement>(`template[data-template="${name}"]`);
  return template.content.firstElementChild!.cloneNode(true) as T;
}

/** Say something to screen readers, through the page's polite live region. */
export function announce(text: string) {
  const region = $('[data-announce]');
  region.textContent = '';
  requestAnimationFrame(() => (region.textContent = text));
}

/** An error the user should see: a toast that stays until it is closed. */
export function toast(title: string, text = '') {
  const item = fromTemplate('toast');
  $('.toasts_title', item).textContent = title;
  $('.toasts_text', item).textContent = text;
  $('.toasts_close', item).addEventListener('click', () => item.remove());
  const list = $('[data-toasts]');
  list.append(item);
  while (list.children.length > 4) list.firstElementChild!.remove();
}

/** “1 photo”, “3 photos”. */
export const count = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

/**
 * The pipeline's slug (packages/pipeline/src/slug.ts), so the UI knows the
 * id of an album folder it is about to create: lowercase, accents dropped,
 * every run of other characters turned into `_`.
 */
export const slugify = (input: string) =>
  input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_');

/** The pipeline's title for a folder or file name with no title of its own. */
export function autoTitle(name: string) {
  const text = name.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return text.charAt(0).toLocaleUpperCase() + text.slice(1);
}

export const stripExtension = (file: string) => {
  const dot = file.lastIndexOf('.');
  return dot > 0 ? file.slice(0, dot) : file;
};

export const albumById = (id: string | null) =>
  app.state?.albums.find((a) => a.id === id) ?? null;

export const photoById = (id: string | null) =>
  app.state?.photos.find((p) => p.id === id) ?? null;

/** “2005-02-27T14:30:00” as typed in the inspector: “2005-02-27 14:30”. */
export const showDate = (date: string | null | undefined) =>
  date ? date.replace('T', ' ').replace(/(\d{2}:\d{2}):00$/, '$1') : '';

/** Put a status line in a form's role=status element. */
export function status(form: Element, text: string) {
  const el = $('[data-status]', form);
  if (el) el.textContent = text;
}

/**
 * Show an image from a URL the dev server may not serve yet (a `photo`
 * event can come a moment before its files): on an error, try again a few
 * times, further apart each time.
 */
export function showImage(image: HTMLImageElement, url: string) {
  if (image.dataset.src === url) return;
  image.dataset.src = url;
  image.dataset.tries = '0';
  image.src = url;
}

document.addEventListener(
  'error',
  (event) => {
    const image = event.target;
    if (!(image instanceof HTMLImageElement) || !image.dataset.src) return;
    const tries = Number(image.dataset.tries ?? 0);
    if (tries >= 6 || image.dataset.src.startsWith('blob:')) return;
    image.dataset.tries = String(tries + 1);
    const url = image.dataset.src;
    setTimeout(
      () => {
        if (image.dataset.src === url) image.src = `${url}?try=${tries + 1}`;
      },
      300 * 2 ** tries
    );
  },
  true
);
