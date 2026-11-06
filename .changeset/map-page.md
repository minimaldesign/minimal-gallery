---
'@minimalgallery/pipeline': minor
'@minimalgallery/astro': minor
---

A map view in the panel, next to the grid and the list.

- `@minimalgallery/astro`: when some photos have GPS coordinates, the panel header gets a Map view (and `m`): the photos of the page (all, an album or a filter) on a map, as thumbnails that open their pages; nearby photos are grouped, with a count, and a group zooms in when chosen. Scrolling over the map moves between the panel and the photo as in the other views; a pinch or ⌘ + scroll zooms. Moving the map narrows the grid, the list, the strip and next and previous to the photos in the area on screen, with “18 of 96 photos in the map area” and Show all in the header, until Show all or another filter. The map is MapLibre on OpenFreeMap’s vector tiles, drawn in the theme’s `--mg-map-*` colors, and loads only when the map view first opens. Photos carry `gps` (`{ lat, lon }` or `null`), and the context JSON carries each located photo’s `gps`. From a photo, the map view opens around that photo, its thumbnail outlined, as the grid and the list mark it; on the home, album and filter pages it shows every photo. The information pane ends with a small map of where the photo was taken, a link to the map view; it loads with the pane, once the page is idle.
- `@minimalgallery/pipeline`: the config’s `map` key: `tiles` (a TileJSON URL, or `pmtiles://` and a PMTiles file’s URL, in the OpenMapTiles schema) and `glyphs` (the label font URL), both OpenFreeMap by default, or `false` to turn the map off. `MAP_TILES` and `MAP_GLYPHS` export the defaults. `defaults.view` takes `'map'`.
