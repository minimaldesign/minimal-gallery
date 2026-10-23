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

## Docs

The documentation lives at [docs.minimalgallery.net](https://docs.minimalgallery.net): getting started, hosting, the theme and its tokens, and the reference for the configuration, sidecars and command line. Its source is `apps/docs`, a Starlight site in the gallery’s own theme; run it with `pnpm --filter minimalgallery-docs dev` and build it with `pnpm --filter minimalgallery-docs build`.

## Running the demo

Node 24 and pnpm 10.

```sh
pnpm install
pnpm build                                        # build the packages
node packages/pipeline/dist/cli.js examples/demo  # process the demo photos
pnpm demo:build                                   # build the site into examples/demo/dist
```

`pnpm test` runs every package’s tests and `pnpm format:check` checks formatting; CI runs both, plus the demo build, on every push.

## Releases

Package versions and changelogs come from [changesets](https://changesets.dev). Describe a change with `pnpm changeset`, apply the pending ones with `pnpm version`, and publish with `pnpm release`. The four public packages share one version number.

## Plan

The design brief and prototype are in `design/`. The work is split into phases: design, then the core (pipeline, astro package, CLI and scaffold, with the demo live on Cloudflare Workers static assets), then the rest of the viewer, then the browser admin for adding photos, then the other hosts, the docs site and the launch.
