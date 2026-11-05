# Map tiles: OpenFreeMap, the risk, and how to switch

Internal note, written 2026-11-04 when the map was built (now the panel’s map view). The code: `packages/astro/src/theme/components/MapView.astro`, `packages/astro/src/theme/scripts/map.js`, and the `map` key in `packages/pipeline/src/config.ts`.

## What the map depends on

The map view draws a basemap with MapLibre from two things fetched by the visitor’s browser:

| What | Default | Config key |
| --- | --- | --- |
| Vector tiles, OpenMapTiles schema | `https://tiles.openfreemap.org/planet` (a TileJSON) | `map.tiles` |
| Label fonts (glyph PBFs) | `https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf` | `map.glyphs` |

The style itself is not fetched: `map.js` builds it from the `--mg-map-*` tokens, and uses one font, `Noto Sans Regular`. No sprite (icon sheet) is used.

## Why OpenFreeMap

Chosen by Yann on 2026-11-04 over Protomaps (hosted key, or a self-hosted extract), OpenStreetMap’s own raster tiles (usage policy, no restyling), MapTiler, Stadia and Mapbox (a key per gallery, paid past free tiers) and Carto (non-commercial terms). OpenFreeMap needs no key or account, has no usage limits, serves street-level vector tiles, and the tiles are free OpenStreetMap data.

## The risk

As checked on 2026-11-04 (GitHub `hyperknot/openfreemap`): the repository dates from December 2023, has about 6,400 stars and commits every few days, and the planet is rebuilt weekly. But one person, `hyperknot`, made 625 of about 630 commits, and the service runs on donations. There is no SLA. If it stops, or limits third-party use, every gallery’s map shows the photos on an empty background (the markers do not depend on the tiles).

## How to tell it is down

- The map view shows the thumbnails over a plain background color, with no land, roads or labels.
- `curl -s https://tiles.openfreemap.org/planet` does not return TileJSON.
- Its status and announcements: https://openfreemap.org and the GitHub repository.

## How to switch

Every option below uses the OpenMapTiles schema, so `map.js` and its style work unchanged; only the two config values move. For a fix that reaches every gallery, change `MAP_TILES` and `MAP_GLYPHS` in `packages/pipeline/src/config.ts` and release; a single gallery can set `map` in its `minimalgallery.config.ts` at once.

1. **Self-host OpenFreeMap’s planet file.** OpenFreeMap publishes the same tiles weekly as a PMTiles file (see openfreemap.org, “weekly planet downloads”). Put it in an R2 bucket (or any host that answers HTTP range requests, with CORS for the gallery’s origin) and set `tiles: 'pmtiles://https://<host>/planet.pmtiles'`. `map.js` loads the `pmtiles` protocol only when the URL starts with `pmtiles://`. The planet is large (on the order of 100 GB), so this needs R2 (issue #14); a regional extract is far smaller (`pmtiles extract` with a bounding box).
2. **Self-host the fonts.** The glyph PBFs for Noto Sans are in the `openmaptiles/fonts` repository (built files on its releases). Upload the `Noto Sans Regular` folder next to the tiles and set `glyphs: 'https://<host>/fonts/{fontstack}/{range}.pbf'`. Fonts are small (a few MB).
3. **Run OpenFreeMap’s server.** The project is open source (`hyperknot/openfreemap`) and documents self-hosting on one Linux server. More work than option 1, only worth it for many galleries.
4. **A keyed provider in the same schema.** MapTiler’s “OpenMapTiles” tiles (`https://api.maptiler.com/tiles/v3/tiles.json?key=<key>`, fonts at `https://api.maptiler.com/fonts/{fontstack}/{range}.pbf?key=<key>`) need only a key and the two config values. Free tier limits apply per key.

Providers with a different schema (Protomaps basemaps, Mapbox Streets, Esri) would need a second style in `map.js`; avoid them unless all of the above fail.

## Attribution

The TileJSON carries the attribution (OpenFreeMap, OpenMapTiles, OpenStreetMap), and MapLibre shows it in the corner. A replacement source must carry the OpenStreetMap and OpenMapTiles credit too: the data license (ODbL) requires it.
