# The browser admin

The admin exists only under `astro dev`. In `astro:config:setup`, when `command === 'dev'`, the integration (`inject.ts`):

- injects the page `/_mg/admin/` (entrypoint `ui/AdminPage.astro`, `prerender: false`; the UI routes with the hash: `#/`, `#/album/<id>`, `#/settings`, `#/publish`);
- watches the gallery’s config file, so a settings edit restarts the dev server and the theme reads the new values;
- adds a dev-only Vite plugin that mounts the API (`server/`) at the front of the dev server’s middleware stack, ahead of Astro’s base and trailing-slash handling.

`astro build` loads none of it: the built site holds no `_mg/admin` string and no admin file.

The API is a framework-free Node handler, so a test (plain `http.createServer`) or a desktop shell can host it:

```ts
import { createAdminApi } from './server/index.ts';

const api = await createAdminApi({ galleryDir, base: '/', watcher });
http.createServer(async (req, res) => {
  if (!(await api.handle(req, res))) res.writeHead(404).end();
});
// later: await api.close();
```

The UI talks to it over HTTP only, never to Node.

## For the page: the token and the API address

```astro
---
import { getAdminInfo } from '../token.ts';
const { token, api } = getAdminInfo();
---
<meta name="mg-admin-token" content={token} />
<meta name="mg-admin-api" content={api} />
```

`getAdminInfo()` returns `{ token, api }`: the per-process token and the API base URL (`<base>_mg/admin/api`, no trailing slash). `getAdminToken()` returns the token alone. Both read a `globalThis` registry, so they work from the page’s module, which Vite loads separately from the integration. They throw when the admin is not running (outside `astro dev`).

## State that survives a dev-server restart

A settings edit rewrites `minimalgallery.config.ts`, and Astro restarts the dev server. The token, the run queue (and a run in progress), uploads in progress and the publish job live in a `globalThis` registry keyed by gallery directory, so they carry over. Open event streams and in-flight requests are dropped by the restart. So the UI should:

- refetch `GET /state` on every `open` event of its `EventSource` (the browser reconnects by itself);
- retry an upload chunk that fails with a network error (`PUT /uploads/:id` accepts the same offset again).

## Security

- Every request to `<base>_mg/admin*` (the page and the API) gets `403` unless the socket’s remote address is loopback and the `Host` header is `localhost`, `127.0.0.1` or `[::1]`, with any port. This stops other machines on the network and DNS rebinding.
- Every API call needs the header `x-mg-admin: <token>`. `GET /events` (EventSource cannot send headers) takes `?token=<token>` instead.
- A present `Origin` header must be the same origin as `Host`; no CORS headers are ever sent, and `OPTIONS` gets `403`.
- Ids, album paths and file names are validated: no `..`, no separators in names, no dotfiles.

## HTTP API

Base: `<base>_mg/admin/api` (with Astro’s default base, `/_mg/admin/api`). Request and response bodies are JSON unless noted. Errors are `{ "error": "<message>" }` with status `400` (bad input, including unknown keys), `403` (refused), `404` (unknown id or route), `405` (known route, other method), `409` (conflict, state given in the body), `413` (body too large) or `500`.

An album id in a path is one URL segment: encode it with `encodeURIComponent` (`japan_2025/kyoto` becomes `japan_2025%2Fkyoto`).

### Shared shapes

**Photo summary** (in `/state`, and in `photo` events):

```ts
{
  id: string;            // 'colors__red_door'
  album: string;         // album id
  file: string;          // 'Red_door.jpg'
  source: string;        // 'colors/Red_door.jpg', relative to photos/
  slug: string;
  title: string;
  date: string;          // 'YYYY-MM-DDTHH:MM:SS', wall clock
  dateSource: 'sidecar' | 'album' | 'xmp' | 'iptc' | 'exif' | 'mtime';
  width: number;
  height: number;
  hidden: boolean;
  rating: number | null; // 1 to 5
  color: string;         // dominant color, 'oklch(0.512 0.084 41.2)'
  thumb: string;         // grid variant, '<base>_mg/<key>'
  attention: ('date-from-mtime' | 'no-exif' | 'duplicate')[];
  duplicateOf?: string[]; // ids with the same content, when 'duplicate'
}
```

`no-exif`: camera, lens and every exposure field are null. `duplicate`: another photo has the same `sourceHash`.

**Album summary** (in `/state`, in `albums` events, and returned by album edits):

```ts
{
  id: string;            // slugged folder path, 'japan_2025/kyoto'
  path: string;          // folder path under photos/, 'Japan 2025/Kyoto'
  parent: string | null;
  title: string;
  description: string | null; // markdown
  sort: 'date' | 'name' | 'manual';
  order: string[];       // file names, for sort: 'manual'
  cover: string | null;  // photo id
  hidden: boolean;
  date: string | null;
  count: number;         // photos in this album (not in its children)
  children: string[];    // album ids
}
```

Albums come from `_albums.json` (written at the end of each run) plus album folders the last run has not seen yet (`count: 0`), in tree order. Photos are listed album by album, in each album’s display order; photos written during a run that `_albums.json` does not list yet follow their album’s listed photos.

**Queue**:

```ts
{
  running: boolean;      // a pipeline run is in progress
  queued: boolean;       // another run will follow (changes arrived during this one, or the debounce is waiting)
  paused: boolean;       // a publish holds the queue
  total: number;         // photos this run encodes or re-reads (0 when idle)
  done: number;          // of those, finished (processed or failed)
  pending: number;       // total - done
  current: string | null;// source path of the photo finished last in this run
  errors: number;        // photos that failed in this run
  last: { at: string, seconds: number, photos: number, encoded: number, metadataOnly: number, errors: number } | null;
}
```

**Gallery**:

```ts
{
  name: string;
  description: string | null;
  author: string | null;
  site: string | null;
  storage: { mode: 'repo' } | { mode: 's3', bucket: string, publicUrl: string, credentials: boolean };
  originals: 'none' | 'repo' | 'bucket';
  albumsSort: 'date' | 'name' | 'manual';
  defaults: { fit, strip, crop, view, size, backdrop };
}
```

`credentials`: `MG_S3_ACCESS_KEY_ID` and `MG_S3_SECRET_ACCESS_KEY` are set, in the environment or in the gallery’s `.env`.

### State

`GET /state` → `{ gallery, albums, photos, firstRun, queue, bucket }`

- `firstRun`: `{ photos, named, previewed, published }`, booleans. `photos`: at least one photo has a manifest. `named`: the config’s `name` is not the default “Photos”. `previewed` and `published` persist in `.minimalgallery/cache/admin.json`.
- `bucket`: `{ pending }` in bucket mode, the number of staged files that wait for an upload; else `null`.

`POST /first-run/previewed` → `{ firstRun }`. The UI calls it when the Preview button is used.

`POST /queue/run` `{ prune?: boolean }` → `202 { queue }`: starts a run now (after the one in progress, if any). Not needed in normal use; every change below queues a run by itself.

### Photos

`GET /photos/:id` → the inspector’s data:

```ts
{
  ...summary,            // the photo summary above
  caption: string | null; tz?: string; camera: string | null; lens: string | null;
  exposure: { shutter, shutterSeconds, aperture, focal, focal35, iso, ev, metering, flash };
  gps: { lat, lon, alt? } | null;
  place: { city, state, country, location } | null; placeLabel: string | null;
  keywords: string[]; copyright: string | null; author: string | null;
  original: { bytes, width, height, relativePath, icc };
  variants: { name, width, height, bytes, format, url }[]; // url under '<base>_mg/'
  preview: string;       // the variant closest to 1280 px, for the inspector
  extracted: {           // every layer below the photo’s own sidecar, merged
    title, caption, date, dateSource, camera, lens, exposure, gps, place, placeLabel,
    keywords, rating, copyright, author, hidden,
    from: { [field]: 'album' | 'xmp-sidecar' | 'xmp' | 'iptc' | 'exif' | 'filename' | 'mtime' };
  };
  overrides: { title?, caption?, date?, keywords?, rating?, place?, hidden?, copyright?, author?, ... }; // what <name>.md sets now
  overridesFile: string | null;  // 'photos/colors/Red_door.md' when it exists
  jsonSidecar: object | null;    // fields a <name>.json sets (the admin never edits it; .md wins field by field)
}
```

`extracted` is what the photo shows when its `.md` sets nothing: the album’s `photos:` map in `_album.md`, the `.xmp` sidecar, embedded XMP, IPTC, EXIF, then the file name and modification time. Show these values greyed; the override affordance writes `overrides`.

`PUT /photos/:id/overrides` `{ title?, caption?, date?, keywords?, rating?, place?: { city?, state?, country?, location? }, hidden?, copyright?, author? }` → `{ overrides, overridesFile }`

- A key that is absent is left as it is; a key set to `null` is removed (in `place`, per sub-field; an empty `place` is removed).
- `caption` is the markdown body of `<name>.md`. `date`: `YYYY-MM-DD`, `YYYY-MM-DDTHH:MM` or `YYYY-MM-DDTHH:MM:SS`. `rating`: 0 to 5 (0 is “unrated”). `keywords`: an array of strings.
- `<name>.md` holds only the overridden fields. Keys and comments the admin does not manage are kept. The file is deleted when nothing is left. The original photo is never touched.
- A run is queued; the photo comes back through a `photo` event.
- `404` when the photo has no manifest (an unknown id, or a photo the pipeline has not processed yet).

### Albums

`POST /albums` `{ path, title? }` → `201 { album }`. `path` is the album folder under `photos/`, `/` between nested folders; each segment is slugged (`Japan 2025/Kyoto` creates `photos/japan_2025/kyoto/`), so the folder path is also the id. With `title`, `_album.md` is written with it. `409` when the folder exists.

`PUT /albums/:id` `{ title?, description?, sort?, cover?, hidden?, date? }` → `{ album }`. Writes `_album.md`: `description` is its markdown body, `null` removes a key, other keys (`photos:`, `order:`) and comments are kept. `cover` takes a photo id or a file name of the album; it is written as the file name. `sort`: `'date' | 'name' | 'manual'`. A run is queued.

`PUT /albums/:id/order` `{ order: string[] }` → `{ album }`. File names of photos in the album, in display order. Sets `sort: manual` and `order`. Unknown names give `400`. A run is queued.

The returned `album` reflects the file just written; the run then sends an `albums` event with the processed tree.

### Uploads

Chunked, deduplicated by content hash (xxhash64, the pipeline’s `sourceHash`).

1. `POST /uploads` `{ album, name, size, lastModified, sidecarOf? }` →
   - `201 { id, chunkSize }`, or
   - `200 { status: 'skipped', reason }` right away for a HEIC or RAW name (“HEIC: export a JPEG instead”) or an unsupported format, so its bytes are never sent.

   `album`: an album id; its folder is created when it does not exist. `name`: the file name, no folders. `size` in bytes. `lastModified`: milliseconds since the epoch (`File.lastModified`); it becomes the file’s mtime, which the pipeline uses when a photo has no capture date. `sidecarOf`: for an `.xmp`, `.md` or `.json` dropped with its photo, the upload id of that photo; the sidecar follows the photo’s final name.

2. `PUT /uploads/:id?offset=<n>`, body the raw bytes of one chunk (at most `chunkSize`, 4 MiB) → `{ received }`. Chunks go in order. Sending an offset already received again (a retry) rewrites from there; an offset past `received` gives `409 { error, received }`, so the client can resume from `received`.
3. `POST /uploads/:id/complete` → one of:
   - `{ status: 'added', photoId, path }`: moved into `photos/<album>/` (`path` is relative to the gallery, `photos/colors/Red_door.jpg`). A name or photo id already used in the album gets `-2`, `-3`. A run is queued; the thumbnail arrives as a `photo` event.
   - `{ status: 'duplicate', sameAs, path }`: the same content is already a photo (`sameAs` is its photo id, `path` its file) or was uploaded earlier in this session. Nothing is written.
   - `{ status: 'skipped', reason }`: HEIC content under another extension, or a sidecar whose photo was not added.
   - for a sidecar: `{ status: 'added', path }`, or `{ status: 'waiting' }` when its photo is not complete yet (it is moved when the photo completes).

   `409 { error, received }` when bytes are missing.

4. `DELETE /uploads/:id` → `204`, discards it.

Chunks are kept in `.minimalgallery/cache/uploads/`; uploads left there for a day are removed when the admin starts.

### Events

`GET /events?token=<token>`: Server-Sent Events. Each event has a name and a JSON `data`:

| Event | Data |
| --- | --- |
| `queue` | the queue object; sent on connect and on every change |
| `photo` | a photo summary, when its manifest is written |
| `photo-removed` | `{ id }`, when a run prunes a photo whose file is gone |
| `albums` | the albums array, after each run |
| `error` | `{ path, message }`: a photo that failed (`path` relative to the gallery), or a run that failed (`path: null`) |
| `log` | `{ job, line }`: a line of a publish or connect job’s output |
| `job` | `{ job: 'publish' \| 'connect', id, state: 'running' \| 'done' \| 'failed', url?, code? }` |
| `settings` | the gallery object, after a settings edit |

A comment line is sent every 15 s to keep the connection open.

### Settings

`GET /settings` → `{ name, description, author, site, albumsSort, defaults: { fit, strip, crop, view, size, backdrop }, about, customCss }`. Values as resolved, defaults filled in; `description`, `author` and `site` are `null` when unset; `about` and `customCss` are `''` when the file does not exist.

`PUT /settings` with any of those keys → the settings object.

- `name`, `description`, `author`, `site`, `albumsSort` (`albums.sort` in the file) and `defaults.*` are edited in `minimalgallery.config.ts` in place: comments and keys the admin does not manage stay as written. `null` removes a key (its default applies). The edit is validated with the pipeline’s schema first; `400` names the bad key. The dev server then restarts (the theme reads the config at startup).
- `about` writes `about.md` at the gallery root (markdown); `null` or `''` removes it.
- `customCss` writes `custom.css`. Vite reloads it in the preview; when the file did not exist before, the dev server restarts once so the theme links it.
- A `settings` event follows. A changed `albumsSort` queues a run.

### Publish

`GET /publish` →

```ts
{
  method: 'git' | 'deploy' | 'build';  // package.json "minimalgallery.publish", else deploy with wrangler.jsonc, else git with a remote, else build
  git: { repo: boolean, remote: string | null, branch: string | null, ghInstalled: boolean, ghAuthed: boolean };
  deploy: { wranglerInstalled: boolean, loggedIn: boolean, worker: string | null };
  bucket: { mode: 's3', credentials: boolean, pending: number } | null;
  site: string | null;
  last: { method, state: 'done' | 'failed', url: string | null, code: number | null, at: string } | null;
  job: { id, job: 'publish' | 'connect', method?, state, lines: string[], url?, code? } | null; // the current or last job of this session, with its log
}
```

The `gh` and `wrangler` checks spawn those tools, so this call can take a second or two; the answer is cached for 30 s, and a connect job clears the cache.

`POST /publish` `{ method }` → `202 { job }` (the job id). Waits for the queue to be idle, pauses it, then runs the gallery’s own `minimalgallery publish --<method> --yes` (from `node_modules/.bin`), streams its output as `log` events and ends with a `job` event: `state: 'done'` with `url` (the last `https://` address it printed, else the config’s `site`), or `state: 'failed'` with the exit `code`. `409` while another job runs.

`POST /connect/cloudflare` → `202 { job }`: runs `wrangler login`, which opens the browser, and streams it the same way. GitHub has no connect call: the UI shows `gh auth login` as guidance.

## The preview while the admin works

The content loader already reloads when a manifest changes, so the preview follows each run. In dev it skips a photo whose album `_albums.json` does not list yet (a new album during its first run) instead of failing the sync; the album and its photos appear when the run writes `_albums.json`. `astro build` still fails on such a photo.

## Media in bucket mode

With `storage: { mode: 's3' }` the dev server serves `<base>_mg/<key>` from the stage (`.minimalgallery/cache/media/<key>`), and redirects (`302`) to `${publicUrl}/<key>` when the key is not staged. The content loader, in dev only, rewrites the photos’ media URLs from `publicUrl` to `<base>_mg/`, so the preview works before anything is uploaded. In repo mode Vite serves `public/_mg` as usual.
