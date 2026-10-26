---
'@minimalgallery/astro': minor
---

The admin and the preview serve on port 4800 on every start, so their address can be bookmarked. `server.port` in `astro.config.mjs` or `--port` chooses another, and a port that is already taken stops the server with an error instead of moving it to the next free port.
