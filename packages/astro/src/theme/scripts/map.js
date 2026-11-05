/**
 * The panel's map view (MapView.astro): MapLibre on vector tiles in the
 * OpenMapTiles schema (OpenFreeMap by default, the config's `map.tiles`),
 * drawn in the theme's colors, with the context's photos as thumbnails.
 * Nearby photos are grouped (GeoJSON clustering); a group shows its newest
 * photo and a count, and zooms in when chosen. A photo links to its page.
 *
 * Loaded by MapView.astro the first time the view is shown; the theme
 * script (mg.js) sends `show()` the photos with a location and the map
 * area. Moving the map (a drag, a pinch, the buttons, a group) sets the
 * area, which mg.js applies to the grid, the list and the steps. The
 * colors are the `--mg-map-*` tokens, read from the page, so custom.css
 * restyles the basemap too.
 *
 * Scrolling (a mouse wheel, two fingers on a trackpad) is left to the
 * page, so it moves between the panel and the viewer as in the other
 * views; a pinch or ⌘ + scroll zooms (cooperative gestures, on a fine
 * pointer only: phones keep one-finger panning).
 */
import {
  AttributionControl,
  LngLatBounds,
  Map as MapLibre,
  Marker,
  NavigationControl,
  addProtocol,
  setWorkerUrl,
} from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
// MapLibre's CSS and its patch, linked when the map mounts: imported as a
// module, Astro would add it to every page's stylesheet
import cssUrl from '../styles/map.css?url';

const root = document.querySelector('.mapView');
const note = root.querySelector('.mapView_note');
const { tiles, glyphs } = root.dataset;
const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
const fine = matchMedia('(pointer: fine)').matches;

/** A token's value as rgba(), which MapLibre's color parser reads. */
function token(name) {
  const value = getComputedStyle(root).getPropertyValue(name).trim();
  const ctx = document.createElement('canvas').getContext('2d');
  ctx.fillStyle = value || '#000';
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
  return `rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(3)})`;
}

const name = [
  'coalesce',
  ['get', 'name:en'],
  ['get', 'name:latin'],
  ['get', 'name'],
];
const font = ['Noto Sans Regular'];
const zoomed = (stops) => [
  'interpolate',
  ['exponential', 1.5],
  ['zoom'],
  ...stops,
];

function style() {
  const c = {
    water: token('--mg-map-water'),
    waterLabel: token('--mg-map-water-label'),
    land: token('--mg-map-land'),
    park: token('--mg-map-park'),
    parkLabel: token('--mg-map-park-label'),
    sand: token('--mg-map-sand'),
    ice: token('--mg-map-ice'),
    building: token('--mg-map-building'),
    road: token('--mg-map-road'),
    major: token('--mg-map-road-major'),
    boundary: token('--mg-map-boundary'),
    label: token('--mg-map-label'),
    halo: token('--mg-map-label-halo'),
  };
  const label = (id, filter, size, extra = {}, layer = 'place', color) => ({
    id,
    type: 'symbol',
    source: 'base',
    'source-layer': layer,
    filter,
    layout: {
      'text-field': name,
      'text-font': font,
      'text-size': size,
      'text-max-width': 8,
      ...extra,
    },
    paint: {
      'text-color': color ?? c.label,
      'text-halo-color': c.halo,
      'text-halo-width': 1.2,
    },
  });
  return {
    version: 8,
    glyphs,
    sources: { base: { type: 'vector', url: tiles } },
    layers: [
      { id: 'land', type: 'background', paint: { 'background-color': c.land } },
      {
        id: 'landcover-sand',
        type: 'fill',
        source: 'base',
        'source-layer': 'landcover',
        filter: ['==', ['get', 'class'], 'sand'],
        paint: { 'fill-color': c.sand },
      },
      {
        id: 'landcover-ice',
        type: 'fill',
        source: 'base',
        'source-layer': 'landcover',
        filter: ['==', ['get', 'class'], 'ice'],
        paint: { 'fill-color': c.ice },
      },
      {
        id: 'landcover-green',
        type: 'fill',
        source: 'base',
        'source-layer': 'landcover',
        filter: [
          'in',
          ['get', 'class'],
          ['literal', ['wood', 'grass', 'wetland']],
        ],
        paint: {
          'fill-color': c.park,
          'fill-opacity': ['match', ['get', 'class'], 'wood', 0.9, 0.55],
        },
      },
      {
        id: 'park',
        type: 'fill',
        source: 'base',
        'source-layer': 'park',
        paint: { 'fill-color': c.park, 'fill-opacity': 0.7 },
      },
      {
        id: 'park-outline',
        type: 'line',
        source: 'base',
        'source-layer': 'park',
        minzoom: 6,
        paint: {
          'line-color': c.parkLabel,
          'line-opacity': 0.35,
          'line-width': 0.8,
        },
      },
      {
        id: 'water',
        type: 'fill',
        source: 'base',
        'source-layer': 'water',
        filter: ['!=', ['get', 'brunnel'], 'tunnel'],
        paint: { 'fill-color': c.water },
      },
      {
        id: 'waterway',
        type: 'line',
        source: 'base',
        'source-layer': 'waterway',
        paint: { 'line-color': c.water, 'line-width': zoomed([8, 0.5, 16, 3]) },
      },
      {
        id: 'building',
        type: 'fill',
        source: 'base',
        'source-layer': 'building',
        minzoom: 14,
        paint: { 'fill-color': c.building },
      },
      {
        id: 'road',
        type: 'line',
        source: 'base',
        'source-layer': 'transportation',
        filter: [
          'in',
          ['get', 'class'],
          ['literal', ['secondary', 'tertiary', 'minor', 'service', 'street']],
        ],
        minzoom: 10,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': c.road, 'line-width': zoomed([10, 0.4, 18, 8]) },
      },
      {
        id: 'road-major',
        type: 'line',
        source: 'base',
        'source-layer': 'transportation',
        filter: [
          'in',
          ['get', 'class'],
          ['literal', ['motorway', 'trunk', 'primary']],
        ],
        minzoom: 5,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': c.major,
          'line-width': zoomed([5, 0.4, 18, 12]),
        },
      },
      {
        id: 'boundary-state',
        type: 'line',
        source: 'base',
        'source-layer': 'boundary',
        filter: ['==', ['get', 'admin_level'], 4],
        minzoom: 3,
        paint: {
          'line-color': c.boundary,
          'line-width': 0.6,
          'line-dasharray': [2, 2],
        },
      },
      {
        id: 'boundary-country',
        type: 'line',
        source: 'base',
        'source-layer': 'boundary',
        filter: [
          'all',
          ['==', ['get', 'admin_level'], 2],
          ['!=', ['get', 'maritime'], 1],
        ],
        paint: {
          'line-color': c.boundary,
          'line-width': zoomed([0, 0.6, 10, 1.6]),
        },
      },
      label(
        'water-name',
        ['has', 'name'],
        zoomed([4, 10, 14, 14]),
        { 'symbol-placement': 'point' },
        'water_name',
        c.waterLabel
      ),
      {
        ...label(
          'park-name',
          ['has', 'name'],
          zoomed([10, 10, 16, 13]),
          {},
          'park',
          c.parkLabel
        ),
        minzoom: 10,
      },
      {
        ...label(
          'peak-name',
          ['has', 'name'],
          zoomed([10, 10, 16, 12]),
          {},
          'mountain_peak',
          c.parkLabel
        ),
        minzoom: 10,
      },
      label(
        'place-local',
        [
          'in',
          ['get', 'class'],
          ['literal', ['village', 'suburb', 'neighbourhood', 'hamlet']],
        ],
        zoomed([11, 10, 16, 14])
      ),
      label(
        'place-city',
        ['in', ['get', 'class'], ['literal', ['city', 'town']]],
        zoomed([4, 11, 14, 17])
      ),
      label(
        'place-country',
        ['==', ['get', 'class'], 'country'],
        zoomed([1, 10, 6, 15])
      ),
    ],
  };
}

let map;
let points = [];
let onArea = () => {};
const shown = new Map();

/**
 * Shows the map with these photos (`[{ lat, lon, href, thumb, title }]`,
 * newest first) on the area (`[west, south, east, north]`), or on all of
 * them when there is none.
 */
export async function show(detail) {
  onArea = detail.onArea;
  const same =
    points.length === detail.points.length &&
    points.every((p, i) => p.href === detail.points[i].href);
  points = detail.points;
  note.hidden = points.length > 0;
  if (!points.length) return;
  if (!map) await mount();
  else if (!same) {
    map.getSource('photos')?.setData(features());
    for (const m of shown.values()) m.remove();
    shown.clear();
  }
  map.resize();
  fit(detail.area);
}

function fit(area) {
  if (area) return map.fitBounds(area, { padding: 0, animate: false });
  const bounds = new LngLatBounds();
  for (const p of points) bounds.extend([p.lon, p.lat]);
  map.fitBounds(bounds, { padding: 80, maxZoom: 13, animate: false });
}

const features = () => ({
  type: 'FeatureCollection',
  features: points.map((p, i) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
    properties: { i },
  })),
});

async function mount() {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = cssUrl;
  const loaded = new Promise((r) => (link.onload = link.onerror = r));
  document.head.append(link);
  await loaded;
  if (tiles.startsWith('pmtiles://')) {
    const { Protocol } = await import('pmtiles');
    addProtocol('pmtiles', new Protocol().tile);
  }
  setWorkerUrl(workerUrl);
  map = new MapLibre({
    container: root,
    style: style(),
    attributionControl: false,
    cooperativeGestures: fine,
    dragRotate: false,
    pitchWithRotate: false,
    touchPitch: false,
    keyboard: false,
    maxPitch: 0,
    renderWorldCopies: false,
    fadeDuration: still ? 0 : 300,
  });
  map.touchZoomRotate.disableRotation();
  map.addControl(new AttributionControl({ compact: true }), 'bottom-left');
  // the attribution stays folded to its ⓘ until the visitor opens it
  // (MapLibre shows it open until the first drag)
  const fold = () => {
    const a = root.querySelector('.maplibregl-ctrl-attrib.maplibregl-compact');
    if (!a) return;
    a.classList.remove('maplibregl-compact-show');
    a.removeAttribute('open');
    map.off('data', fold);
  };
  map.on('data', fold);
  map.addControl(new NavigationControl({ showCompass: false }), 'bottom-right');
  // the visitor moved the map (not a fit): that is the area
  // the prints' size follows the zoom (component.mapView.css)
  const zoom = () => root.style.setProperty('--mapView-zoom', map.getZoom());
  map.on('zoom', zoom);
  zoom();
  map.on('moveend', (e) => {
    if (!e.originalEvent && !e.user) return;
    const b = map.getBounds();
    onArea([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
  });
  // on the style, not on 'load': 'load' waits for the basemap's tiles,
  // and the photos must show even when the tile server is slow or down
  map.once('style.load', () => {
    map.addSource('photos', {
      type: 'geojson',
      data: features(),
      cluster: true,
      clusterRadius: 64,
      clusterMaxZoom: 17,
      // the newest photo of a group: the list is newest first
      clusterProperties: { first: ['min', ['get', 'i']] },
    });
    // invisible: it makes the source load, the thumbnails are DOM markers
    map.addLayer({
      id: 'photos',
      type: 'circle',
      source: 'photos',
      paint: { 'circle-radius': 0, 'circle-opacity': 0 },
    });
    map.on('render', place);
  });
}

// KEYS in the map view, with the panel up: the arrows move the map, + and
// - zoom (mg.js leaves them alone in this view)
const STEP = 120;
addEventListener('keydown', (e) => {
  const r = document.documentElement;
  if (!map || r.dataset.view !== 'map' || !r.hasAttribute('data-panel')) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.target.closest?.('input, textarea, select, dialog')) return;
  const by = {
    ArrowLeft: [-STEP, 0],
    ArrowRight: [STEP, 0],
    ArrowUp: [0, -STEP],
    ArrowDown: [0, STEP],
  }[e.key];
  const opts = { duration: still ? 0 : 300 };
  const user = { user: true };
  if (by) map.panBy(by, opts, user);
  else if (e.key === '+' || e.key === '=') map.zoomIn(opts, user);
  else if (e.key === '-') map.zoomOut(opts, user);
  else return;
  e.preventDefault();
});

/** One marker per visible group or photo; the ones off screen are removed. */
function place() {
  if (!map.isSourceLoaded('photos')) return;
  const next = new Map();
  for (const f of map.querySourceFeatures('photos')) {
    const props = f.properties;
    const key = props.cluster ? `c${props.cluster_id}` : `p${props.i}`;
    if (next.has(key)) continue;
    const marker = shown.get(key) ?? markerFor(f);
    next.set(key, marker);
    if (!shown.has(key)) marker.addTo(map);
  }
  for (const [key, marker] of shown) if (!next.has(key)) marker.remove();
  shown.clear();
  for (const [key, marker] of next) shown.set(key, marker);
}

function markerFor(f) {
  const props = f.properties;
  const p = points[props.cluster ? props.first : props.i];
  const el = document.createElement(props.cluster ? 'button' : 'a');
  el.className = props.cluster
    ? 'mapView_photo mapView_photo-group'
    : 'mapView_photo';
  const img = document.createElement('img');
  img.src = p.thumb;
  img.alt = '';
  img.decoding = 'async';
  el.append(img);
  if (props.cluster) {
    const n = props.point_count;
    el.type = 'button';
    el.setAttribute('aria-label', `${n} photos here; zoom in`);
    const count = document.createElement('span');
    count.className = 'mapView_groupCount';
    count.textContent = n;
    el.append(count);
    el.addEventListener('click', async () => {
      const zoom = await map
        .getSource('photos')
        .getClusterExpansionZoom(props.cluster_id);
      map.easeTo(
        { center: f.geometry.coordinates, zoom, duration: still ? 0 : 500 },
        { user: true }
      );
    });
  } else {
    el.href = p.href;
    el.setAttribute('aria-label', p.title);
    el.title = p.title;
  }
  return new Marker({ element: el }).setLngLat(f.geometry.coordinates);
}
