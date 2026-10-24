---
'@minimalgallery/astro': major
---

minimal gallery 2, a rewrite of the 0.8 PHP app, released as 2.0.0 betas until launch. Viewer completion (Phase 2):

- Feeds and a sitemap: `@minimalgallery/astro/feeds` builds RSS 2.0 (`/feed.xml`) and JSON Feed 1.1 (`/feed.json`) with the 50 newest photos (last added first once the manifests carry `added`), each with its JPEG as image and enclosure, a sitemap of every context and photo page with the photo’s image, and `robots.txt`. Every page links both feeds.
- Link previews: with a `site`, every page carries Open Graph and Twitter card tags, with the photo’s `jpeg1600` (or largest JPEG) as `og:image`. A photo page with a caption uses it as its description; the home page uses the gallery’s description.
- Slideshow: Space or the new play button (first in the HUD and the panel header) starts and stops a timed step through the context every `--mg-slideshow` (3s), with a large play or pause icon that fades out and a hairline that fills over the interval. It starts over after the last photo; an open dialog or zoom pauses it; Escape and opening the panel stop it.
- Random: `r` steps to a random photo of the context inside the page, and `/random/` (with `RandomPage.astro`) sends a link to a random photo, inside `?in=` when given. Neither shows a photo twice in a visit until all have been shown.
- Credit: “Powered by minimal gallery” centered after the last grid or list row (at the bottom of the panel when the photos are few) and the version at the right of the keyboard shortcuts pane, linking to https://docs.minimalgallery.net/. Turn both off with `minimalgallery({ credit: false })`.
- Fit photo with the filmstrip on: the photo is sized above the strip instead of under it.
- The next and previous cursors are 0.75 of their old size.
- Phone: the panel header gives the breadcrumb its own row (it was squeezed to nothing), and the chrome keeps clear of the notch, island and home indicator.
- Fixes: album and facet pages open on their photos again in Chrome; Tab in the filter palette goes to the first chip in every engine; `?in=` accepts only context ids, so a crafted link can no longer make the theme load another site’s JSON into the page.
- The grid’s items and images lose their classes (`.thumbs > li`, `.thumbs_link > img`), which takes 2.9 KB off a 70-photo page. `feed` and `random` are now reserved album names. The README documents the token contract by group, the cascade order and `custom.css`, and the theme contract for a second theme.
