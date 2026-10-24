---
'create-minimalgallery': patch
---

New galleries get the feed (`/feed.xml`, `/feed.json`), sitemap, `robots.txt` and `/random/` routes the theme links to. The feeds and the sitemap are built once the gallery’s public address (`site`) is set, so a new gallery still builds before it has one.
