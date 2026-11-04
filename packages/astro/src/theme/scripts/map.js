/**
 * The map page (MapPage.astro): MapLibre on vector tiles in the
 * OpenMapTiles schema (OpenFreeMap by default, the config's `map.tiles`),
 * drawn in the theme's colors, with the photos as thumbnails. Nearby
 * photos are grouped (GeoJSON clustering); a group shows its newest photo
 * and a count, and zooms in when chosen. A photo links to its page.
 *
 * Loaded only on /map/. The colors are the `--mg-map-*` tokens, read from
 * the page, so custom.css restyles the basemap too. The view is kept in
 * the URL hash (`#zoom/lat/lon`), so a position can be linked; without
 * one the map opens on all the photos.
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

const root = document.getElementById('map');
const points = JSON.parse(document.getElementById('map-points').textContent);
const { tiles, glyphs } = root.dataset;
// read before MapLibre writes its own hash
const linked = /^#\d/.test(location.hash);
const still = matchMedia('(prefers-reduced-motion: reduce)').matches;

/** A token's value as rgb(), which MapLibre's color parser reads. */
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
    land: token('--mg-map-land'),
    park: token('--mg-map-park'),
    building: token('--mg-map-building'),
    road: token('--mg-map-road'),
    major: token('--mg-map-road-major'),
    boundary: token('--mg-map-boundary'),
    label: token('--mg-map-label'),
    halo: token('--mg-map-label-halo'),
  };
  const label = (id, filter, size, extra = {}) => ({
    id,
    type: 'symbol',
    source: 'base',
    'source-layer': 'place',
    filter,
    layout: {
      'text-field': name,
      'text-font': font,
      'text-size': size,
      'text-max-width': 8,
      ...extra,
    },
    paint: {
      'text-color': c.label,
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
        id: 'park',
        type: 'fill',
        source: 'base',
        'source-layer': 'landcover',
        filter: ['in', ['get', 'class'], ['literal', ['wood', 'grass']]],
        paint: { 'fill-color': c.park, 'fill-opacity': 0.6 },
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

if (tiles.startsWith('pmtiles://')) {
  const { Protocol } = await import('pmtiles');
  addProtocol('pmtiles', new Protocol().tile);
}
setWorkerUrl(workerUrl);

const map = new MapLibre({
  container: root,
  style: style(),
  hash: true,
  attributionControl: false,
  dragRotate: false,
  pitchWithRotate: false,
  touchPitch: false,
  maxPitch: 0,
  renderWorldCopies: false,
  fadeDuration: still ? 0 : 300,
});
map.touchZoomRotate.disableRotation();
map.keyboard.disableRotation();
map.addControl(new AttributionControl({ compact: true }), 'bottom-left');
map.addControl(new NavigationControl({ showCompass: false }), 'bottom-right');

// Open on every photo, unless the URL already says where.
if (!linked && points.length) {
  const bounds = new LngLatBounds();
  for (const p of points) bounds.extend([p.lon, p.lat]);
  map.fitBounds(bounds, { padding: 80, maxZoom: 13, animate: false });
}

map.on('load', () => {
  map.addSource('photos', {
    type: 'geojson',
    data: {
      type: 'FeatureCollection',
      features: points.map((p, i) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
        properties: { i },
      })),
    },
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

const shown = new Map();

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
  img.src = p.src;
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
      map.easeTo({
        center: f.geometry.coordinates,
        zoom,
        duration: still ? 0 : 500,
      });
    });
  } else {
    el.href = p.href;
    el.setAttribute('aria-label', p.title);
    el.title = p.title;
  }
  return new Marker({ element: el }).setLngLat(f.geometry.coordinates);
}
