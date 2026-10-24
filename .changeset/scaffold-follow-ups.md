---
'@minimalgallery/astro': minor
'create-minimalgallery': minor
---

Scaffold follow-ups from the Phase 2 to 4 reviews.

- `create-minimalgallery`: a new gallery gets the routes the demo has: `/feed.xml`, `/feed.json`, `/sitemap.xml`, `/robots.txt`, `/random/` and a 404 page. The feeds and the sitemap write no file while the site has no address, so a new gallery builds before it has one.
- `create-minimalgallery`: the GitHub Pages workflow builds with `withastro/action` and gets the site’s address and base path from `actions/configure-pages`, passed to `astro build` as `--site` and `--base`: a project site at `https://<user>.github.io/<repo>/`, a user site and a custom domain all work without editing `astro.config.mjs`. It runs on pushes to `main` or `master`, with the current majors of the GitHub actions.
- `create-minimalgallery`: with pnpm or Yarn, `package.json` pins the package manager (`packageManager`), from the version running the scaffold or `<pm> --version`, so GitHub, Netlify and Cloudflare install the same major. When the first commit was made before the install, the next steps say to commit the lockfile.
- `@minimalgallery/astro`: `ViewerPage` shows “No photos yet” for a gallery with no photos instead of failing, with a link to the admin under `astro dev`. `NotFoundPage.astro` is the 404 page, in the theme’s style. Pages link the feeds only when the site has an address. `GalleryLayout` takes `script={false}` for pages with no viewer. `/random/` sends an empty gallery home.
- `@minimalgallery/astro`: the admin can move a duplicate photo to the system Trash, with its sidecars (`POST /photos/:id/trash`, a button in the duplicate notice). The last copy of a photo is never moved.
