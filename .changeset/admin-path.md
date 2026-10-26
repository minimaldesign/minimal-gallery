---
'@minimalgallery/pipeline': minor
'@minimalgallery/astro': minor
'minimalgallery': minor
---

The admin moves from `/_mg/admin/` to `/admin/`, and its API to `/admin/api`. When a top-level album slugs to `admin` or the site has its own `admin` page, the admin is at `/mg/admin/` instead, so it never hides a page of the gallery.

- `@minimalgallery/pipeline`: `adminPath(galleryDir, root?)`, `ADMIN_PATH` and `ADMIN_FALLBACK_PATH`, from the main entry and from `@minimalgallery/pipeline/admin`.
- `@minimalgallery/astro`: under `astro dev`, the HUD and the panel header show an Admin link.
- `minimalgallery`: `admin` opens whichever of the two paths the gallery uses.
