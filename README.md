# minimalgallery

A static photo gallery toolkit for photographers: drop JPGs into folders, get a fast, EXIF-organized gallery on free hosting. v2 is an Astro integration plus a local processing pipeline. The 2005 PHP original lives in `legacy/` for reference during the port.

## Packages

| Package | Folder | Role |
| --- | --- | --- |
| `@minimalgallery/pipeline` | `packages/pipeline` | Reads `photos/`, writes resized copies and one JSON manifest per photo. Pure Node. |
| `@minimalgallery/astro` | `packages/astro` | Astro integration, content loader and the default theme. |
| `minimalgallery` | `packages/cli` | The command line: `add`, `sync`, `doctor`, `publish`, `watch`, `admin`, `upgrade`. |
| `create-minimalgallery` | `packages/create` | `npm create minimalgallery@latest`: scaffolds a gallery for Cloudflare Workers (static assets), GitHub Pages, Netlify or a local build. |

Also here: `examples/demo/` (the demo gallery at [minimalgallery.net](https://minimalgallery.net), whose photos are the test fixture), `apps/docs/` (the product site and the docs) and `design/` (the brief and the clickable prototype).

## Setup

```sh
pnpm install  # install every workspace package: packages, demo and docs
pnpm build    # build the packages into their dist folders
```

Needs Node 24 and pnpm 10. Run `pnpm build` again after changing the pipeline or the CLI, since the demo runs their built output. `pnpm test` runs every package’s tests and `pnpm format:check` checks formatting; CI runs both, plus the demo build, on every push.

## Gallery (demo)

```sh
node packages/pipeline/dist/cli.js examples/demo  # process the demo photos into public/_mg
pnpm --filter minimalgallery-demo dev             # serve the demo with live reload
pnpm demo:build                                   # build the site into examples/demo/dist
pnpm demo:publish                                 # process, build and upload to minimalgallery.net
```

The demo is the gallery at [minimalgallery.net](https://minimalgallery.net). The original photos are in `examples/demo/photos`, one folder per album, and they are committed. The pipeline reads them and writes two things: the resized copies the site serves, in `examples/demo/public/_mg`, and the manifests in `examples/demo/.minimalgallery/manifest` (one JSON file per photo with its size, EXIF data, album and the date it was added, plus `_albums.json` for the albums). The manifests are committed so each photo keeps its added date; the resized copies are not, so run the pipeline once before the first `dev` or build, and again after changing photos or the pipeline. Commit the updated manifests.

The demo publishes the way a user’s gallery does: `pnpm demo:publish` runs `minimalgallery publish` in `examples/demo`, which processes new photos, builds the site and uploads it to Cloudflare with `wrangler deploy` from your computer. Pushing to `master` does not deploy the demo.

## Admin

```sh
pnpm --filter minimalgallery-demo admin  # start astro dev and open /_mg/admin/
```

The browser admin works on the demo gallery: drop photos in, edit titles, captions and albums, change the settings and publish. It processes photos as they land in `photos/` and the preview reloads as they do. It exists only under `astro dev`, so a built site holds none of it. Its local HTTP API is described in `packages/astro/src/admin/README.md`.

## Docs

```sh
pnpm --filter minimalgallery-docs dev    # serve the docs on port 4421
pnpm --filter minimalgallery-docs build  # build the docs into apps/docs/dist
```

The documentation lives at [docs.minimalgallery.net](https://docs.minimalgallery.net): getting started, hosting, the theme and its tokens, and the reference for the configuration, sidecars and command line. Its source is `apps/docs`, a Starlight site in the gallery’s own theme.

## Releases

Package versions and changelogs come from [changesets](https://changesets.dev). Describe a change with `pnpm changeset`, apply the pending ones with `pnpm version`, and publish with `pnpm release`. The four public packages share one version number.

## Plan

The design brief and prototype are in `design/`. The work is split into phases: design, then the core (pipeline, astro package, CLI and scaffold, with the demo live on Cloudflare Workers static assets), then the rest of the viewer, then the browser admin for adding photos, then the other hosts, the docs site and the launch.
