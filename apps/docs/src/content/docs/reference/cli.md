---
title: Command line
description: The minimalgallery commands, npm create minimalgallery and the mg-pipeline binary, with their options and exit codes.
---

This page covers three command-line tools: `minimalgallery`, which you run inside a gallery to add, process, check and publish photos; `npm create minimalgallery@latest`, which creates a gallery; and `mg-pipeline`, the processing binary of `@minimalgallery/pipeline`.

## minimalgallery

```sh
minimalgallery <command> [options] [--dir <folder>]
```

| Command | What it does |
| --- | --- |
| [`add`](#add) | Copies photos into an album folder, then processes the gallery. |
| [`sync`](#sync) | Processes new and changed photos. |
| [`doctor`](#doctor) | Reports counts and sizes against the hosting limits. Changes nothing. |
| [`publish`](#publish) | Processes photos, then commits and pushes, deploys to Cloudflare, or builds. |
| [`watch`](#watch) | Processes photos as they are added, changed or removed in `photos/`. |
| [`admin`](#admin) | Starts the Astro dev server with `watch` running. The browser admin is not built yet. |
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
| `1` | A failure: no gallery found, an unknown command or option, a missing argument, a gallery in bucket mode, a photo that failed to process in `add` or `sync`, or no Cloudflare login for `publish --deploy`. Running `minimalgallery` with no command prints the usage and exits 1. |
| `130` | You declined or canceled `publish`’s confirmation. |
| any other | The exit code of a program that failed: `git`, `astro`, `wrangler` or the package manager. `admin` exits with the dev server’s code. |

:::caution[Bucket mode]

In bucket mode (`storage: { mode: 's3' }`), `add`, `sync`, `watch`, `admin` and `publish` stop before processing anything, because the s3 adapter is not built yet. See [Storage modes](/reference/configuration/#storage-modes).

:::

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

1. It collects the photos. A folder is read with all its subfolders; names that start with `.` are skipped. A `.xmp`, `.md` or `.json` file with the same name as a photo is copied with it. Other files are listed as skipped, HEIC and RAW files with the advice to export a JPEG.
2. It turns the album name into a folder name with the same rule as album ids: `"Japan 2025"` gives `photos/japan_2025/`. A `/` in the name makes a nested album: `--album family/birthdays`.
3. It leaves out duplicates: a photo whose content matches a photo anywhere in `photos/`, or one earlier in the same batch, is listed as already in the gallery and not copied.
4. It renames on a clash: a file name already used in the album, or one that would give the same photo id, gets `-2`, `-3` and so on (`DSC_0412.jpg` becomes `DSC_0412-2.jpg`). Its sidecars are renamed to match.
5. It copies the files and keeps their modification times, which the pipeline uses for photos with no capture date.

The photos of every subfolder go into the one album; the subfolders are not kept as nested albums.

`add` exits 1 when you give no folder or file, or when any photo in the gallery fails to process, including photos that were already there. When there is nothing new to add, it processes nothing and exits 0.

### sync

```sh
minimalgallery sync [--prune] [--force]
```

| Option | Meaning |
| --- | --- |
| `--prune` | Also remove the manifests and derivatives of photos that no longer exist, then empty folders and interrupted writes. |
| `--force` | Encode every photo again. |

`sync` processes every photo in `photos/` that is new or changed:

- A photo with the same size, modification time, sidecars and settings, whose derivatives are all present, is skipped.
- A photo whose file content is unchanged, for example when only a sidecar was edited, gets a new manifest without being encoded again. Metadata edited inside the photo file changes its content, so that photo is encoded again.
- Any other photo is encoded, and the derivatives of its earlier version are removed.

It prints a summary: albums, photos, encoded, metadata only, unchanged, failed, bytes written and time. Without `--prune`, it also says how many deleted photos still have derivatives.

`sync` exits 1 when any photo fails, which includes a HEIC or RAW file with no JPEG next to it. Every other photo is still processed.

### doctor

```sh
minimalgallery doctor
```

`doctor` reads the manifests and the `photos/` folder, encodes nothing and changes nothing. It prints:

- the storage mode and the `originals` setting;
- photo, album and undated counts, derivative files and bytes, and published originals when there are any;
- the number of contexts: the archive, the albums and every facet value;
- the projected deploy: one page per visible photo, one page and one JSON file per context, the derivatives in repo mode and about 20 other files, against Cloudflare’s limit of 20,000 files;
- the media bytes in the repository against 1 GB, and about how many more photos fit before each limit;
- a recommendation: repo mode is fine; plan bucket mode (past 500 photos or 500 MB); or move to bucket mode (over a limit);
- issues: photos with no manifest (run `sync`), manifests with no photo (run `sync --prune`), and HEIC or RAW files with no JPEG.

`doctor` can recommend bucket mode, which is not built yet. It exits 0.

### publish

```sh
minimalgallery publish [--git | --deploy | --build] [--yes]
```

| Option | Meaning |
| --- | --- |
| `--git` | Process photos, commit the gallery’s changed files and push. Your host builds the site from the repository. |
| `--deploy` | Process photos, build the site and upload it to Cloudflare Workers with `wrangler deploy`. |
| `--build` | Process photos and build the site into `dist/`. |
| `--yes`, `-y` | Do not ask before committing, pushing or deploying. |

Without a flag, the method comes from the gallery’s `package.json`, which the scaffold sets for your host:

```json title="package.json"
{
  "minimalgallery": { "publish": "deploy" }
}
```

The value is `"git"`, `"deploy"` or `"build"`. When neither a flag nor that field is set, `publish` uses `--deploy` if the gallery has a `wrangler.jsonc` file, and otherwise stops and asks you to choose.

Before it commits, pushes or deploys, `publish` lists the steps and asks you to confirm. In a shell with no terminal attached it stops instead, unless you pass `--yes`. Photos that fail to process are reported with a warning, and `publish` goes on without them. Every method needs Astro installed in the gallery (`npm install`).

#### `--git`

1. Checks that the gallery is in a git repository.
2. Processes the photos.
3. Commits the changes under `photos/`, `.minimalgallery/`, `public/`, `custom.css` and the config file, with the message “Update gallery, YYYY-MM-DD”. Other changes in the repository are left alone.
4. Pushes to the branch’s upstream. A branch with no upstream is pushed with `git push -u origin HEAD`; with no `origin` remote, `publish` stops and says how to add one.

When nothing has changed and nothing is waiting to be pushed, it says so and exits 0.

#### `--deploy`

1. Reads the Worker’s `name` from `wrangler.jsonc` or `wrangler.json`. The scaffold writes this file for the Cloudflare host.
2. Runs `wrangler whoami`, with the gallery’s own wrangler or else `npx wrangler`. When you are not logged in, it prints `npx wrangler login` and exits 1. You log in once per computer.
3. Processes the photos, asks to confirm, runs `astro build`, then `wrangler deploy`.

#### `--build`

Processes the photos and runs `astro build`. The site is in `dist/`, ready to upload to any static host. It does not ask for confirmation.

### watch

```sh
minimalgallery watch [--delay <ms>]
```

| Option | Meaning |
| --- | --- |
| `--delay <ms>` | How long to wait after the last change before processing. Default: `1500`. |

`watch` processes the gallery once when it starts, then again after each batch of changes in `photos/`:

- It waits until each file has finished writing, so a copy from Finder or an export from Lightroom is read once it is complete.
- The first run, and any run after files were deleted, also prunes the manifests and derivatives of deleted photos.
- Changes that arrive during a run start another run when it finishes.
- Files and folders whose name starts with `.` are ignored.

It prints one line per run, with the counts and the time. An error is printed and watching goes on. Press Ctrl+C to stop; the exit code is 0.

### admin

```sh
minimalgallery admin [-- <astro dev options>]
```

:::note[Not built yet]

The browser admin, with drag and drop, editing and a publish button, is not built. For now, `minimalgallery admin` runs `watch` and the Astro dev server: add photos to `photos/<album>/` in Finder or with `minimalgallery add`, and the preview updates.

:::

`admin` starts the same watcher as `minimalgallery watch`, then runs `astro dev --open`, which opens the gallery in your browser. Options after `--` go to `astro dev`:

```sh
npx minimalgallery admin -- --port 4400
```

Ctrl+C stops the dev server and the watcher. `admin` exits with the dev server’s exit code, and needs Astro installed in the gallery.

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
npm create minimalgallery@latest my-gallery -- --host cloudflare --name "Kyoto" --yes
```

With pnpm, yarn or bun, pass them directly: `pnpm create minimalgallery my-gallery --host github`.

| Option | Meaning |
| --- | --- |
| `[folder]` | Where to create the gallery. The folder must not exist, or hold nothing but `.DS_Store` or `.git`. |
| `--name <text>` | The gallery’s name. Default: `Photos`. |
| `--author <text>` | Your name. Default: none. |
| `--host <host>` | `cloudflare` (the default), `github`, `netlify` or `local`. |
| `--size <size>` | `small` (under 500 photos, the default) or `large`. |
| `--pm <name>` | `npm`, `pnpm`, `yarn` or `bun`. Default: the package manager that runs the command, else npm. |
| `--yes`, `-y` | Use the default for anything not given, without asking. |
| `--no-install` | Do not install the packages. |
| `--help`, `-h` | Print the usage. |

### Prompts

Each question is asked only when its option is missing. With `--yes`, or when no terminal is attached, the defaults are used without asking.

| Question | Choices | Default |
| --- | --- | --- |
| Where should the gallery go? | a folder name | `my-gallery` |
| Gallery name | text | `Photos` |
| Your name | text, or empty to skip | empty |
| Where will it live? | Cloudflare, GitHub Pages, Netlify, Just build it locally | Cloudflare |
| Roughly how many photos? | Under 500, More than 500 | Under 500 |
| Package manager | npm, pnpm, yarn, bun | the detected one |

:::note[More than 500 photos]

Choosing more than 500 photos prints a note about bucket mode and adds a comment to the config, but the gallery starts in repo mode: bucket mode is not built yet.

:::

The command exits 0 when the gallery is created, 1 for an unknown option, an option value it does not accept or a folder that is not empty, and 130 when you cancel a question. A failed install does not stop it: it prints the end of the install’s output and adds the install command to the next steps.

### Files it writes

Every gallery gets these files:

| File | Contents |
| --- | --- |
| `package.json` | The scripts `dev`, `build`, `preview`, `admin`, `publish` and `doctor`; the `minimalgallery.publish` method for your host; `@minimalgallery/astro`, `@minimalgallery/pipeline`, `astro` and `minimalgallery` as dependencies; Node 22.18 or later. |
| `minimalgallery.config.ts` | `name`, `author` when you gave one, `storage: { mode: 'repo' }`, and a commented `site`. See [Configuration](/reference/configuration/). |
| `astro.config.mjs` | Static output, trailing slashes, the minimal gallery integration, incremental builds, and a commented `site`. |
| `.env.example` | The bucket credentials, commented out. |
| `.gitignore` | `node_modules`, `dist`, `.astro`, `.env` files and `.minimalgallery/cache`. Manifests and `public/_mg` are committed, since hosts build the site from them. |
| `tsconfig.json` | Astro’s strict TypeScript settings. |
| `photos/README.md` | How to organize photos. |
| `src/content.config.ts` | The `albums` and `photos` collections. |
| `src/pages/index.astro`, `src/pages/[...context]/index.astro`, `src/pages/[...context].json.ts`, `src/pages/[...album]/[photo].astro` | The gallery’s routes. See [Theme and tokens](/theme/). |

Then, by host:

| Host | Also writes | `publish` method |
| --- | --- | --- |
| Cloudflare | `wrangler.jsonc`, which names the Worker after the folder and serves `./dist`; `public/_headers`, which caches `/_mg/*` and `/_astro/*` for a year. `package.json` gets a `deploy` script and `wrangler` as a development dependency, and `.env.example` lists `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` for deploying from CI. | `deploy` |
| GitHub Pages | `.github/workflows/deploy.yml`, which builds the site on each push to `main` and publishes it to GitHub Pages. `astro.config.mjs` gets commented `site` and `base` lines for a project site. | `git` |
| Netlify | `netlify.toml`, with the build command, `dist` as the publish folder, Node 24 and the same cache headers. | `git` |
| Just build it locally | nothing more | `build` |

The `deploy` script runs `astro build && wrangler deploy`; unlike `npm run publish`, it does not process photos first.

On macOS, every gallery also gets `Open minimalgallery.command`. Double-click it to install the packages when they are missing and run `admin`. Hosting is covered step by step in [Cloudflare](/hosting/cloudflare/), [GitHub Pages](/hosting/github-pages/) and [Netlify](/hosting/netlify/).

## mg-pipeline

```sh
mg-pipeline <gallery folder> [--prune] [--force] [--concurrency N] [--threads N] [--quiet] [--json summary.json]
mg-pipeline doctor <gallery folder> [--json report.json]
```

`mg-pipeline` is the binary of `@minimalgallery/pipeline`, installed with every gallery. It runs the same processing and the same `doctor` as `minimalgallery`, with these differences:

- It takes the gallery folder as an argument and does not look upward for one.
- It does not check for bucket mode first, so a gallery in s3 mode fails while processing.
- It prints a longer summary: workers and threads, manifests and files written, the total derivative files and bytes, and encode times per photo.
- It can write the summary, or the doctor report, to a JSON file.

| Option | Meaning |
| --- | --- |
| `--prune` | Remove the manifests, derivatives and empty folders of deleted photos, and interrupted writes. |
| `--force` | Encode every photo again. |
| `--concurrency N` | The number of encoding workers. Default: the number of CPUs or the number of photos to encode, whichever is smaller. |
| `--threads N` | libvips threads per worker. Default: the number of CPUs divided by the number of workers, at least 1. |
| `--quiet`, `-q` | Print only the summary. |
| `--json <file>` | Also write the summary, or the doctor report, to this file as JSON. |
| `--help`, `-h` | Print the usage. |

With the defaults, a full gallery gets one thread per worker, and a single new photo gets every core.

`mg-pipeline` exits 1 when any photo fails, when the number of arguments is wrong, when `--concurrency` or `--threads` is not a whole number of 1 or more, or on any other error. `mg-pipeline doctor` exits 0.
