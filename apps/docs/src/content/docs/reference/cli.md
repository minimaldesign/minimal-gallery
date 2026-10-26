---
title: Command line
description: The minimalgallery commands, npm create minimalgallery and the mg-pipeline command, with their options and exit codes.
---

This page covers three command-line tools: `minimalgallery`, which you run inside a gallery to add, process, check and publish photos; `npm create minimalgallery@latest`, which creates a gallery; and `mg-pipeline`, which runs the photo processing on its own.

## minimalgallery

```sh
minimalgallery <command> [options] [--dir <folder>]
```

| Command | What it does |
| --- | --- |
| [`add`](#add) | Copies photos into an album folder, then processes the gallery. |
| [`sync`](#sync) | Processes new and changed photos. |
| [`doctor`](#doctor) | Reports counts and sizes against the hosting limits. Changes nothing. |
| [`publish`](#publish) | Processes photos, then uploads the site to Cloudflare or builds it for your own host. |
| [`watch`](#watch) | Processes photos as they are added, changed or removed in `photos/`. |
| [`admin`](#admin) | Starts the Astro dev server and opens the browser admin. |
| [`upgrade`](#upgrade) | Updates the minimal gallery packages, then runs `doctor`. |

The `minimalgallery` package is a dependency of every gallery that `npm create minimalgallery@latest` creates. Run it from the gallery folder with `npx minimalgallery <command>`, or through the `admin`, `publish` and `doctor` scripts of the gallery’s `package.json` (`npm run publish`). It needs Node 22.18 or later.

### Global options

| Option | Meaning |
| --- | --- |
| `--dir <folder>` or `--dir=<folder>` | Look for the gallery from this folder instead of the current one. It can go before or after the command. |
| `--help`, `-h` | Print the usage. After a command, print that command’s usage. |
| `--version`, `-v` | Print the version, in place of a command. |

Set the environment variable `MG_DEBUG` to any value to print a stack trace with unexpected errors.

### How the gallery is found

Starting from the current folder, or from `--dir`, each folder upward is checked. The first one that holds a config file (`minimalgallery.config.ts`, `.mts`, `.js` or `.mjs`) or a `photos/` folder is the gallery. You can run any command from a subfolder, such as `photos/japan-2025/`.

When no folder matches, the command stops with exit code 1 and says how to create a gallery.

### Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Success. `doctor` exits 0 whatever it finds, and `watch` exits 0 when you stop it. |
| `1` | A failure: no gallery found, an unknown command or option, a missing argument, a photo that failed to process in `add` or `sync`, an upload to photo storage that failed or had no access key, or no Cloudflare login for `publish --deploy`. Running `minimalgallery` with no command prints the usage and exits 1. |
| `130` | You declined or canceled `publish`’s confirmation. |
| any other | The exit code of a program that failed: `astro`, `wrangler` or the package manager. `admin` exits with the dev server’s code. |

### add

```sh
minimalgallery add <folder | files...> [--album <name>]
```

| Option | Meaning |
| --- | --- |
| `--album <name>`, `-a <name>` | The album to add to. Default: the name of the folder you give, or of the folder that holds the first file. |

```sh
npx minimalgallery add ~/Pictures/Export/japan --album "Japan 2025"
```

`add` copies photos into `photos/<album>/` and then processes the whole gallery, as `sync` does:

1. It collects the photos. A folder is read with all its subfolders; names that start with `.` are skipped. An `.xmp` sidecar named after a photo (`DSC_0412.jpg.xmp` or `DSC_0412.xmp`) is copied with it. HEIC files from an iPhone are photos too. Other files are listed as skipped, RAW files with the advice to export a JPEG.
2. It turns the album name into a folder name with the same rule as album ids: `"Japan 2025"` gives `photos/japan_2025/`. A `/` in the name makes a nested album: `--album family/birthdays`.
3. It leaves out duplicates: a photo whose content matches a photo anywhere in `photos/`, or one earlier in the same batch, is listed as already in the gallery and not copied.
4. It renames on a clash: a file name already used in the album, or one that would give the same photo id, gets `-2`, `-3` and so on (`DSC_0412.jpg` becomes `DSC_0412-2.jpg`). Its sidecars are renamed to match.
5. It copies the files and keeps their modification times, as a Finder copy does.

The photos of every subfolder go into the one album; the subfolders are not kept as nested albums.

`add` exits 1 when you give no folder or file, or when any photo in the gallery fails to process, including photos that were already there. When there is nothing new to add, it processes nothing and exits 0.

### sync

```sh
minimalgallery sync [--prune] [--force] [--no-upload] [--yes]
```

| Option | Meaning |
| --- | --- |
| `--prune` | Also remove the manifests and resized copies of photos deleted on this computer, then empty folders and interrupted writes. A photo whose original was never on this computer is kept. With [photo storage](/hosting/photo-storage/), also list the files in the bucket that no photo uses and delete them after asking. |
| `--force` | Encode every photo again. |
| `--no-upload` | With photo storage, keep the new copies on this computer; the next `sync` or `publish` uploads them. |
| `--yes`, `-y` | Do not ask before deleting files from the bucket. |

`sync` processes every photo in `photos/` that is new or changed:

- A photo with the same size, modification time, sidecars and settings as at the last run on this computer, whose resized copies are all present, is skipped. The first run in a fresh copy of the gallery (a clone, another computer) reads every photo once, but writes no manifest that has not changed.
- A photo whose file content is unchanged, for example when only a sidecar was edited, gets a new manifest without being encoded again. Metadata edited inside the photo file changes its content, so that photo is encoded again.
- Any other photo is encoded, and the resized copies of its earlier version are removed.

It prints a summary: albums, photos, encoded, metadata only, unchanged, failed, bytes written and time, and how many photos have no original on this computer when some do. Without `--prune`, it also says how many deleted photos still have resized copies.

With photo storage, `sync` then uploads the new copies to the bucket, using the access key in `.env`. Without the key it keeps them on this computer and exits 1.

`sync` exits 1 when any photo fails, which includes a RAW file with no JPEG next to it. Every other photo is still processed.

### doctor

```sh
minimalgallery doctor [--bucket]
```

| Option | Meaning |
| --- | --- |
| `--bucket` | With photo storage, also check the bucket end to end: upload a small test file, find it in a listing, read it back through `publicUrl` with its cache header, then delete it. Each step says what to fix when it fails. |

`doctor` reads the manifests and the `photos/` folder, encodes nothing and changes nothing. It prints:

- the storage mode and the `originals` setting;
- photo, album and undated counts (with the photos whose originals are not on this computer), the number of resized copies and their total size, and published originals when there are any;
- the number of photo sets with a page of their own: all photos, each album and every filter value, such as a year or a camera;
- with photo storage, the files waiting for upload and whether the access key is set;
- the projected site: one page per visible photo, one page and one JSON file per photo set, the resized copies in site mode and about 20 other files, against Cloudflare’s limit of 20,000 files, and about how many more photos fit before it;
- the bytes of photos published with the site;
- a recommendation: site mode is fine; plan to add photo storage (past 16,000 files); or add photo storage (over the limit). For a gallery built for your own host (`"publish": "build"`), Cloudflare’s limit does not apply and the recommendation says so;
- issues: photos with no manifest (run `sync`), manifests of photos deleted on this computer (run `sync --prune`), RAW files with no JPEG, and, with photo storage, a missing access key or a value `npm create minimalgallery` left as a stand-in.

A photo whose original is not on this computer and never was, as in a copy of the gallery made without its originals, is not an issue. `doctor` counts those photos and does not ask to prune them.

`doctor` exits 0, and `doctor --bucket` exits 1 when a step of the check fails.

### publish

```sh
minimalgallery publish [--deploy | --build] [--yes]
```

| Option | Meaning |
| --- | --- |
| `--deploy` | Process photos, build the site and upload it to Cloudflare Workers with `wrangler deploy`. |
| `--build` | Process photos and build the site into `dist/`, for [your own host](/hosting/your-own-host/). |
| `--yes`, `-y` | Do not ask before deploying. |

Without a flag, the method comes from the gallery’s `package.json`, which `npm create minimalgallery` sets for your host:

```json title="package.json"
{
  "minimalgallery": { "publish": "deploy" }
}
```

The value is `"deploy"` or `"build"`. When neither a flag nor that field is set, `publish` uses `--deploy` if the gallery has a `wrangler.jsonc` file, and `--build` otherwise. A gallery from an earlier version with `"git"` there stops with a message: publishing with git is gone, and the gallery can keep its repository, committed and pushed by hand. See [Backups](/backups/#keeping-the-gallery-in-git).

With [photo storage](/hosting/photo-storage/), both methods upload the new photos to the bucket before they build the site. If the upload fails, nothing else is published.

Before it deploys, `publish` lists the steps and asks you to confirm. In a shell with no terminal attached it stops instead, unless you pass `--yes`. Photos that fail to process are reported with a warning, and `publish` goes on without them. Every method needs Astro installed in the gallery (`npm install`).

#### `--deploy`

1. Reads the Worker’s `name` from `wrangler.jsonc` or `wrangler.json`. `npm create minimalgallery` writes this file for the Cloudflare host.
2. Runs `wrangler whoami`, with the gallery’s own wrangler or else `npx wrangler`. When you are not logged in, it prints `npx wrangler login` and exits 1. You log in once per computer.
3. Processes the photos, asks to confirm, runs `astro build`, then `wrangler deploy`.

#### `--build`

Processes the photos and runs `astro build`. The site is in `dist/`, ready to upload to your host. It does not ask for confirmation.

### watch

```sh
minimalgallery watch [--delay <ms>]
```

| Option | Meaning |
| --- | --- |
| `--delay <ms>` | How long to wait after the last change before processing. Default: `1500`. |

`watch` processes the gallery once when it starts, then again after each batch of changes in `photos/`:

- It waits until each file has finished writing, so a copy from Finder or an export from your photo editor is read once it is complete.
- The first run, and any run after files were deleted, also prunes the manifests and resized copies of photos deleted on this computer.
- Changes that arrive during a run start another run when it finishes.
- Files and folders whose name starts with `.` are ignored.

It prints one line per run, with the counts and the time. An error is printed and watching goes on. Press Ctrl+C to stop; the exit code is 0.

### admin

```sh
minimalgallery admin [--port <number>] [-- <astro dev options>]
```

`admin` runs `astro dev` and opens the browser admin at `/admin/`. From it you add photos by dropping them in, edit titles, captions and albums, change the settings and publish. It processes photos as they land in `photos/`, including files you copy there in Finder, and the preview reloads as they do. It runs only on this computer and is never part of the built site.

The admin is at `http://localhost:4800/admin/` on every start, so you can bookmark it. When an album or a page of the site already uses `/admin/`, the admin is at `/mg/admin/` instead, and the dev server says so. While the dev server runs, the gallery’s header has an Admin link. `--port` chooses another port for one start; to change it for good, set `server.port` in `astro.config.mjs` ([Changing the port](/reference/configuration/#changing-the-port)). When the port is taken, `admin` stops with an error instead of moving to the next free port.

Options after `--` go to `astro dev`:

```sh
npx minimalgallery admin -- --host
```

Ctrl+C stops the dev server. `admin` exits with the dev server’s exit code, and needs Astro installed in the gallery.

### upgrade

```sh
minimalgallery upgrade
```

`upgrade` updates the minimal gallery packages of the gallery to their latest versions, then runs `doctor`:

1. It reads `package.json` and picks `minimalgallery` and every `@minimalgallery/*` package from `dependencies` and `devDependencies`. Packages linked with `workspace:` are skipped.
2. It finds the package manager from the lockfile (`pnpm-lock.yaml`, `yarn.lock`, `bun.lock` or `bun.lockb`, `package-lock.json`), looking from the gallery upward, else the package manager that runs the command, else npm.
3. It installs each package at `@latest`: `npm install`, or `pnpm add`, `yarn add`, `bun add`, with `-D` (`--dev` for yarn) for development dependencies.
4. It runs `doctor` from the version it installed.

`upgrade` does not change `minimalgallery.config.ts`. It exits 0, or with the package manager’s exit code when the install fails.

## npm create minimalgallery

```sh
npm create minimalgallery@latest
```

This creates a gallery folder, installs its packages and prints the next steps. It asks for what it needs; options answer the questions ahead of time. With npm, put `--` before the options:

```sh
npm create minimalgallery@latest mg -- --host cloudflare --name "Kyoto" --yes
```

With pnpm, yarn or bun, pass them directly: `pnpm create minimalgallery mg --host local`.

| Option | Meaning |
| --- | --- |
| `[folder]` | Where to create the gallery. The folder must not exist, or hold nothing but `.DS_Store` or `.git`. |
| `--name <text>` | The gallery’s name. Default: `Photos`. |
| `--author <text>` | Your name. Default: none. |
| `--host <host>` | `cloudflare` (the default) publishes to Cloudflare from your computer. `local` builds a folder to upload to [your own host](/hosting/your-own-host/). |
| `--storage <mode>` | Cloudflare only. `site` (the default) publishes the resized photos with the site. `bucket` sets up [photo storage](/hosting/photo-storage/) on R2. `--size small` and `--size large` are older spellings of the two. |
| `--bucket <name>` | Photo storage: the bucket’s name. Default: `<folder>-media`. |
| `--media-domain <domain>` | Photo storage: the address the photos are served from, such as `media.example.com`. |
| `--account-id <id>` | Photo storage: the Cloudflare account id. Default: from `wrangler whoami`, when you are logged in. |
| `--access-key-id <id>`, `--secret-access-key <key>` | Photo storage: the R2 access key, written to `.env` only. |
| `--pm <name>` | `npm`, `pnpm`, `yarn` or `bun`. Default: the package manager that runs the command, else npm. |
| `--yes`, `-y` | Use the default for anything not given, without asking. |
| `--no-install` | Do not install the packages. |
| `--help`, `-h` | Print the usage. |

### Prompts

Each question is asked only when its option is missing. With `--yes`, or when no terminal is attached, the defaults are used without asking.

| Question | Choices | Default |
| --- | --- | --- |
| Where should the gallery go? | a folder name | `mg` |
| Gallery name | text | `Photos` |
| Your name | text, or empty to skip | empty |
| Where will it live? | Cloudflare, My own host | Cloudflare |
| How big is your photo library? | Up to about 3,000 photos, More than that. Cloudflare only. | Up to about 3,000 photos |
| Bucket name, Media domain, R2 access key id, R2 secret access key | text, each optional but the name | Photo storage only |
| Package manager | npm, pnpm, yarn, bun | the detected one |

With photo storage, the create command also reads your account id with `wrangler whoami` and creates the bucket when you are logged in to Cloudflare. Whatever it could not do (log in, create the bucket, connect the media domain, create the access key) is listed in the next steps. It never makes the folder a git repository.

The command exits 0 when the gallery is created, 1 for an unknown option, an option value it does not accept or a folder that is not empty, and 130 when you cancel a question. A failed install does not stop it: it prints the end of the install’s output and adds the install command to the next steps.

### Files it writes

Every gallery gets these files:

| File | Contents |
| --- | --- |
| `package.json` | The scripts `dev`, `build`, `preview`, `admin`, `publish` and `doctor`; the `minimalgallery.publish` method for your host; `@minimalgallery/astro`, `@minimalgallery/pipeline`, `astro` and `minimalgallery` as dependencies; Node 22.18 or later; with pnpm or Yarn, `packageManager` with the version on your computer, so every computer installs the same one. |
| `minimalgallery.config.ts` | `name`, `author` when you gave one, `storage` (`{ mode: 'site' }`, or the bucket for photo storage), and a commented `site`. See [Configuration](/reference/configuration/). |
| `astro.config.mjs` | Static output, trailing slashes, the minimal gallery integration, incremental builds, and a commented `site`. |
| `.env.example` | The photo storage access key, commented out in site mode. With photo storage and a key given, `.env` holds the key. |
| `.gitignore` | For a repository you may make yourself: `node_modules`, `dist`, `.astro`, `.env` files, `.minimalgallery/cache`, and every file under `photos/` except the sidecars and `_album.md`. See [Backups](/backups/#keeping-the-gallery-in-git). |
| `tsconfig.json` | Astro’s strict TypeScript settings. |
| `photos/README.md` | How to organize photos. |
| `src/content.config.ts` | The `albums` and `photos` collections. |
| `src/pages/index.astro`, `src/pages/[...context]/index.astro`, `src/pages/[...context].json.ts`, `src/pages/[...album]/[photo].astro`, `src/pages/random.astro` | The gallery’s routes. See [Theme and tokens](/theme/). |
| `src/pages/feed.xml.ts`, `src/pages/feed.json.ts`, `src/pages/sitemap.xml.ts`, `src/pages/robots.txt.ts` | The RSS and JSON feeds, the sitemap and `robots.txt`. The feeds and the sitemap need the site’s address (`site`); until it is set, the build leaves them out. |
| `src/pages/404.astro` | The page for an address the gallery does not have, which every host serves as `404.html`. |

Then, by host:

| Host | Also writes | `publish` method |
| --- | --- | --- |
| Cloudflare | `wrangler.jsonc`, which names the Worker after the folder and serves `./dist`; `public/_headers`, which caches `/_mg/*` and `/_astro/*` for a year (only `/_astro/*` with photo storage). `package.json` gets a `deploy` script and `wrangler` as a development dependency, and `.env.example` lists `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` for deploying from an automated build service. | `deploy` |
| My own host | nothing more | `build` |

The `deploy` script runs `astro build && wrangler deploy`; unlike `npm run publish`, it does not process photos first.

On macOS, every gallery also gets `Open minimalgallery.command`. Double-click it to install the packages when they are missing and run `admin`. Publishing is covered step by step in [Putting it online](/hosting/).

## mg-pipeline

```sh
mg-pipeline <gallery folder> [--prune] [--force] [--concurrency N] [--threads N] [--quiet] [--json summary.json]
mg-pipeline doctor <gallery folder> [--json report.json]
```

`mg-pipeline` comes with `@minimalgallery/pipeline`, installed with every gallery. It runs the same processing and the same `doctor` as `minimalgallery`, with these differences:

- It takes the gallery folder as an argument and does not look upward for one.
- It never uploads: with photo storage, the new copies wait on this computer for `minimalgallery sync` or `publish`.
- It prints a longer summary: workers and threads, manifests and files written, the number of resized copies and their total size, and encode times per photo.
- It can write the summary, or the doctor report, to a JSON file.

| Option | Meaning |
| --- | --- |
| `--prune` | Remove the manifests, resized copies and empty folders of photos deleted from this folder, and interrupted writes. Photos whose originals this folder never had are kept. |
| `--force` | Encode every photo again. |
| `--concurrency N` | The number of encoding workers. Default: the number of CPUs or the number of photos to encode, whichever is smaller. |
| `--threads N` | libvips threads per worker. Default: the number of CPUs divided by the number of workers, at least 1. |
| `--quiet`, `-q` | Print only the summary. |
| `--json <file>` | Also write the summary, or the doctor report, to this file as JSON. |
| `--help`, `-h` | Print the usage. |

With the defaults, a full gallery gets one thread per worker, and a single new photo gets every core.

`mg-pipeline` exits 1 when any photo fails, when the number of arguments is wrong, when `--concurrency` or `--threads` is not a whole number of 1 or more, or on any other error. `mg-pipeline doctor` exits 0.
