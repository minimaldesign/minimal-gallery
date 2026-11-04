---
'@minimalgallery/astro': minor
'create-minimalgallery': minor
---

Scaffold follow-ups from the Phase 2 to 4 reviews.

- `create-minimalgallery`: a new gallery gets the routes minimalgallery.net has: `/feed.xml`, `/feed.json`, `/sitemap.xml`, `/robots.txt`, `/random/` and a 404 page. The feeds and the sitemap write no file while the site has no address, so a new gallery builds before it has one.
- `create-minimalgallery`: with pnpm or Yarn, `package.json` pins the package manager (`packageManager`), from the version running the scaffold or `<pm> --version`, so every computer that installs the gallery gets the same major.
- `@minimalgallery/astro`: `ViewerPage` shows “No photos yet” for a gallery with no photos instead of failing, with a link to the admin under `astro dev`. `NotFoundPage.astro` is the 404 page, in the theme’s style. Pages link the feeds only when the site has an address. `GalleryLayout` takes `script={false}` for pages with no viewer. `/random/` sends an empty gallery home.
