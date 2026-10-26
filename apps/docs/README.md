# minimalgallery-docs

docs.minimalgallery.net: the product site. The home page is a one-pager in the gallery’s own design; the docs behind it are [Starlight](https://starlight.astro.build), restyled with the gallery’s tokens.

```sh
pnpm --filter minimalgallery-docs dev       # http://localhost:4801
pnpm --filter minimalgallery-docs build     # into apps/docs/dist
pnpm --filter minimalgallery-docs preview
```

Nothing needs `pnpm build` first: the theme CSS is read from `packages/astro/src`, and the version history from the packages’ `CHANGELOG.md` files.

## Where things are

| Path | What |
| --- | --- |
| `src/pages/index.astro` | The one-pager (`src/layouts/Home.astro`, `src/components/home/`, `src/styles/home.css`). |
| `src/content/docs/` | The docs pages, in Markdown. The sidebar is set in `astro.config.mjs`. |
| `src/pages/versions.astro` | The version history, from the changesets changelogs (`src/lib/changelog.ts`). |
| `src/styles/starlight.css` | Starlight’s custom CSS: the gallery’s tokens, then `site/patch.starlight.css`, which maps Starlight onto them. |
| `src/styles/site/theme.docs.css` | What the product site adds to the gallery’s theme, shared by both. |
| `src/components/starlight/` | Starlight overrides: the fonts in the head, and no light theme. |
| `wrangler.jsonc` | The Cloudflare Worker that serves `dist/` at docs.minimalgallery.net. |

## Styles

The CSS is mCSS, as in the gallery. Every value comes from the gallery’s theme in `@minimalgallery/astro` (`theme.mg.tokens.css`, `theme.mg.ui.css`, `global.surface.css`), imported rather than copied, so a change to the gallery’s look reaches the docs. The hero photos are read from `examples/demo/photos` (the list is in `src/components/home/Mosaic.astro`). The screenshots in `src/assets` are 1280 × 800 captures at 2x, taken under `astro dev` with Astro’s dev toolbar and the gallery’s Admin link removed: `admin.jpg` is the admin with a photo selected, `filters.jpg` the filter panel open on `/colors/sakura_impression/`. Retake them when the admin or the panel changes. The keyboard section’s card (`src/components/home/KeysCard.astro`) copies its rows from the theme’s `KeysPane.astro`.

## Deploying

Cloudflare Workers Builds builds this site from `master` and deploys it as the Worker `minimalgallery-docs`, served at docs.minimalgallery.net. Every push to `master` publishes it. Do not deploy the docs from a computer.

minimalgallery.net is different on purpose: it publishes from a computer with `pnpm demo:publish`, the way a user’s gallery does, and Workers Builds is disconnected from its Worker (`minimalgallery-demo`).

### How the Worker was set up

Set up on October 25, 2026, in the Cloudflare account that holds the minimalgallery.net zone:

1. **Workers & Pages** (under **Compute**), **Create**, **Import a repository**, then GitHub and `minimaldesign/minimal-gallery`.
2. The form, top to bottom:

   | Field | Value |
   | --- | --- |
   | Project name | `minimalgallery-docs`. It must match `name` in `wrangler.jsonc`, or the build fails. |
   | Build command | `cd ../.. && pnpm install --frozen-lockfile && pnpm --filter minimalgallery-docs build`. Cloudflare prefills `pnpm run build`, which would build the packages at the root instead of the docs. |
   | Deploy command | `npx wrangler deploy`, the default. |
   | Preview command | `npx wrangler preview`, the default. It builds the other branches and needs the empty `previews` block in `wrangler.jsonc`. |
   | Enable Preview builds | On by default: every branch builds a preview version and adds a check to its PR. |
   | Protect with Cloudflare Access | Off. |
   | Advanced settings, Path | `apps/docs`: the root directory, where `wrangler.jsonc` is. The build command’s `cd ../..` assumes it. |
   | API token | The existing **Workers Builds** token, made on October 23, 2026 for the gallery’s builds. |

3. **Deploy.** The form has no production branch field: Cloudflare uses the repository’s default branch, `master`. It shows under **Settings**, **Build**, **Branch control**.

The custom domain needs no DNS work by hand. `routes` in `wrangler.jsonc` declares `docs.minimalgallery.net` with `custom_domain: true`, and since the zone is in the same account, the first deploy creates the DNS record and the certificate. The address can take a few minutes to answer after that.

Optional, under **Settings**, **Build**, **Build cache**: **Enable** keeps Astro’s cache between builds, so unchanged pages are not rendered again.

### If it needs redoing

- A failed build’s log is under the Worker’s **Deployments** tab.
- To stop the builds, open the Worker, **Settings**, **Build**, and **Disconnect** the repository. The live site stays as it is; the **Overview** keeps showing the GitHub commit of the live deployment until another one replaces it.
- Renaming the Worker means changing `name` in `wrangler.jsonc` in the same push.
