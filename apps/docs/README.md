# minimalgallery-docs

docs.minimalgallery.net: the product site. The home page is a one-pager in the gallery’s own design; the docs behind it are [Starlight](https://starlight.astro.build), restyled with the gallery’s tokens.

```sh
pnpm --filter minimalgallery-docs dev       # http://localhost:4421
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

The CSS is mCSS, as in the gallery. Every value comes from the gallery’s theme in `@minimalgallery/astro` (`theme.mg.tokens.css`, `theme.mg.ui.css`, `global.surface.css`), imported rather than copied, so a change to the gallery’s look reaches the docs. The hero photos are read from `examples/demo/photos` (the list is in `src/components/home/Mosaic.astro`).

## Deploying

Cloudflare Workers Builds builds this site from `master`, like the demo: root directory `apps/docs`, build command `cd ../.. && pnpm install --frozen-lockfile && pnpm --filter minimalgallery-docs build`, deploy command `npx wrangler deploy`. Do not deploy from a machine.
