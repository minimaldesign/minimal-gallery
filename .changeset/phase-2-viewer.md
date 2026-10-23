---
'@minimalgallery/astro': minor
---

Viewer completion (Phase 2):

- Feeds and a sitemap: `@minimalgallery/astro/feeds` builds RSS 2.0 (`/feed.xml`) and JSON Feed 1.1 (`/feed.json`) with the 50 newest photos, each with its JPEG as image and enclosure, a sitemap of every context and photo page with the photo’s image, and `robots.txt`. Every page links both feeds.
- Link previews: with a `site`, every page carries Open Graph and Twitter card tags, with the photo’s `jpeg1600` (or largest JPEG) as `og:image`. A photo page with a caption uses it as its description; the home page uses the gallery’s description.
- Slideshow: Space starts and stops a timed step through the context (`--mg-slideshow`, 5s). Pointer movement, an open dialog or zoom pauses it; it stops at the last photo, on Escape and when the panel opens.
- Random: `r` steps to a random photo of the context inside the page, and `/random/` (with `RandomPage.astro`) sends a link to a random photo, inside `?in=` when given.
- Credit: “Powered by minimal gallery” after the last grid or list row and the version in the keyboard shortcuts pane, linking to https://docs.minimalgallery.net/. Turn it off with `minimalgallery({ credit: false })`.
- Phone: the panel header gives the breadcrumb its own row (it was squeezed to nothing), and the chrome keeps clear of the notch, island and home indicator.
- Security: `?in=` accepts only context ids, so a crafted link can no longer make the theme load another site’s JSON into the page.
- `feed` and `random` are now reserved album names. The README documents the token contract by group, the cascade order and `custom.css`, and the theme contract for a second theme.
