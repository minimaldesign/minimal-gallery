# minimalgallery

A free, open-source photo gallery toolkit for photo enthusiasts: drop photos into folders, get a fast, EXIF-organized gallery, published to free hosting in one command. It’s an Astro integration plus a local processing pipeline. The 2005 PHP original is kept in `legacy/`.

## Get started

```sh
npm create minimalgallery@latest
```

The first release is in preparation, so until it’s out this command doesn’t work yet and the packages are only in this repository. The [documentation](https://docs.minimalgallery.net) covers everything else: [getting started](https://docs.minimalgallery.net/getting-started/), hosting, the theme and its tokens, and the reference for the configuration, sidecars and command line.

## Packages

| Package | Folder | Role |
| --- | --- | --- |
| `@minimalgallery/pipeline` | `packages/pipeline` | Reads `photos/`, writes resized copies and one JSON manifest per photo. Pure Node. |
| `@minimalgallery/astro` | `packages/astro` | Astro integration, content loader and the default theme. |
| `minimalgallery` | `packages/cli` | The command line: `add`, `sync`, `doctor`, `publish`, `watch`, `admin`, `upgrade`. |
| `create-minimalgallery` | `packages/create` | `npm create minimalgallery@latest`: scaffolds a gallery that publishes to Cloudflare Workers (static assets), with photo storage on R2 for a large library, or builds a folder for your own host. |

Also here: `examples/demo/` (my own gallery at [minimalgallery.net](https://minimalgallery.net), whose photos are also the test fixture), `apps/docs/` (the product site and the docs) and `design/` (the brief and the clickable prototype).

## Working on minimalgallery

```sh
pnpm install  # install every workspace package: packages, gallery and docs
pnpm build    # build the packages into their dist folders
```

Needs Node 24 and pnpm 10. Run `pnpm build` again after changing the pipeline or the CLI, since the gallery runs their built output. `pnpm test` runs every package’s tests and `pnpm format:check` checks formatting; CI runs both, plus the gallery build, on every push.

## Gallery (minimalgallery.net)

```sh
node packages/pipeline/dist/cli.js examples/demo  # process the photos into public/_mg
pnpm --filter minimalgallery-demo dev             # serve the gallery with live reload
pnpm demo:build                                   # build the site into examples/demo/dist
pnpm demo:publish                                 # process, build and upload to minimalgallery.net
```

`examples/demo` is my photo gallery, at [minimalgallery.net](https://minimalgallery.net). The original photos are in `examples/demo/photos`, one folder per album, and they are committed. The pipeline reads them and writes two things: the resized copies the site serves, in `examples/demo/public/_mg`, and the manifests in `examples/demo/.minimalgallery/manifest` (one JSON file per photo with its size, EXIF data, album and the date it was added, plus `_albums.json` for the albums). The manifests are committed so each photo keeps its added date; the resized copies are not, so run the pipeline once before the first `dev` or build, and again after changing photos or the pipeline. Commit the updated manifests.

It publishes the way any gallery does: `pnpm demo:publish` runs `minimalgallery publish` in `examples/demo`, which processes new photos, builds the site and uploads it to Cloudflare with `wrangler deploy` from my computer. Pushing to `master` does not deploy it.

## Admin

```sh
pnpm --filter minimalgallery-demo admin  # start astro dev and open /admin/
```

The browser admin works on the gallery: drop photos in, edit titles, captions and albums, change the settings and publish. It processes photos as they land in `photos/` and the preview reloads as they do. It exists only under `astro dev`, so a built site holds none of it. Its local HTTP API is described in `packages/astro/src/admin/README.md`.

## Docs

```sh
pnpm --filter minimalgallery-docs dev    # serve the docs on port 4801
pnpm --filter minimalgallery-docs build  # build the docs into apps/docs/dist
```

The source of [docs.minimalgallery.net](https://docs.minimalgallery.net) is `apps/docs`, a Starlight site in the gallery’s own theme.

## License

MIT.
