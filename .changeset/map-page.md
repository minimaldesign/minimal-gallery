---
'@minimalgallery/pipeline': minor
'@minimalgallery/astro': minor
'create-minimalgallery': minor
---

A map of the photos, at `/map/`.

- `@minimalgallery/astro`: `MapPage.astro` puts every photo with GPS coordinates on a map, as thumbnails that open their pages; nearby photos are grouped, with a count, and a group zooms in when chosen. The map is MapLibre on OpenFreeMap’s vector tiles, drawn in the theme’s `--mg-map-*` colors, and loads only on that page. The header of the photo grid gets a Map button, and `m` opens the map, when some photos have a location. Photos carry `gps` (`{ lat, lon }` or `null`).
- `@minimalgallery/pipeline`: the config’s `map` key: `tiles` (a TileJSON URL, or `pmtiles://` and a PMTiles file’s URL, in the OpenMapTiles schema) and `glyphs` (the label font URL), both OpenFreeMap by default, or `false` to turn the map off. `MAP_TILES` and `MAP_GLYPHS` export the defaults.
- `create-minimalgallery`: a new gallery gets `src/pages/map.astro`.
