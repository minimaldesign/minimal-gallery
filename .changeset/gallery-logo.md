---
'@minimalgallery/pipeline': minor
'@minimalgallery/astro': minor
---

A gallery can show a logo before its name in the header.

- `@minimalgallery/pipeline`: the config takes `logo`, the path to an `.svg` file relative to the gallery directory.
- `@minimalgallery/astro`: the theme inlines that file before the name in the viewer’s header, the panel’s header and the message pages, centered on the height of a capital. Shapes without a fill of their own are drawn in `--mg-ink`. The gallery’s name in those headers is now drawn in `--mg-ink` at medium weight, where it was muted.
