// Builds the prototype from photos.json: compiles the mCSS theme, writes
// every page and one JSON file per context, formats the output with the
// repo's Prettier config, then checks that every reference resolves.
//   node build.mjs          (run photos.mjs first if photos.json is missing)
//
// One template for every page: the viewer (stage) on top, a context's
// photos below as a grid and as a list. A context is all photos, an album
// or a facet. Photo pages carry their album; ?in=<context id> makes mg.js
// swap in another context from <context id>.json.
import fs from 'node:fs';
import path from 'node:path';
import postcss from 'postcss';
import postcssImport from 'postcss-import';
import postcssMixins from 'postcss-mixins';
import postcssPresetEnv from 'postcss-preset-env';
import * as prettier from 'prettier';

const photos = JSON.parse(fs.readFileSync('photos.json', 'utf8'));
const SITE = 'minimal gallery';
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const ALBUMS = {
  colors: 'Colors',
  light: 'Light',
  people: 'People',
  feelings: 'Feelings',
  shapes: 'Shapes',
  motion: 'Motion',
};
const BUCKETS = {
  wide: 'Wide, up to 24 mm',
  normal: 'Normal, 25 to 50 mm',
  'short-tele': 'Short tele, 51 to 105 mm',
  tele: 'Tele, over 105 mm',
};

const esc = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
const slug = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
const plural = (n, w = 'photo') => `${n} ${w}${n === 1 ? '' : 's'}`;
const byDate = (a, b) =>
  a.date && b.date
    ? a.date.localeCompare(b.date)
    : a.date
      ? -1
      : b.date
        ? 1
        : 0;
const shortDate = (p) =>
  p.date
    ? `${+p.date.slice(8, 10)} ${MONTHS[p.month - 1].slice(0, 3)} ${p.year}`
    : 'Undated';
const seconds = (s) =>
  s.startsWith('1/') ? 1 / parseFloat(s.slice(2)) : parseFloat(s);
const pad = (m) => String(m).padStart(2, '0');

// FACETS: every metadata value is a context with its own page
const FACETS = [
  {
    key: 'year',
    label: 'Years',
    of: (p) => (p.year ? [String(p.year)] : []),
    text: (v) => v,
    sort: (a, b) => b - a,
  },
  {
    key: 'month',
    label: 'Months, any year',
    of: (p) => (p.month ? [pad(p.month)] : []),
    text: (v) => MONTHS[+v - 1],
    sort: (a, b) => a - b,
  },
  {
    key: 'place',
    label: 'Places',
    of: (p) => (p.place ? [p.place] : []),
    text: (v) => v,
  },
  {
    key: 'camera',
    label: 'Cameras',
    of: (p) => (p.camera ? [p.camera] : []),
    text: (v) => v,
  },
  {
    key: 'lens',
    label: 'Lenses',
    of: (p) => (p.lens ? [p.lens] : []),
    text: (v) => v,
  },
  {
    key: 'focal',
    label: 'Focal length',
    of: (p) => (p.focalBucket ? [p.focalBucket] : []),
    text: (v) => BUCKETS[v],
    sort: (a, b) =>
      Object.keys(BUCKETS).indexOf(a) - Object.keys(BUCKETS).indexOf(b),
  },
  {
    key: 'aperture',
    label: 'Aperture',
    of: (p) => (p.aperture ? [p.aperture] : []),
    text: (v) => v,
    sort: (a, b) => parseFloat(a.slice(2)) - parseFloat(b.slice(2)),
  },
  {
    key: 'shutter',
    label: 'Shutter speed',
    of: (p) => (p.shutter ? [p.shutter] : []),
    text: (v) => v,
    sort: (a, b) => seconds(a) - seconds(b),
  },
  {
    key: 'iso',
    label: 'ISO',
    of: (p) => (p.iso ? [p.iso] : []),
    text: (v) => `ISO ${v}`,
    sort: (a, b) => a - b,
  },
  { key: 'keyword', label: 'Keywords', of: (p) => p.keywords, text: (v) => v },
];

// CONTEXTS: all photos (newest first), albums (chronological, like a
// roll), facets (newest first). id is the page path without .html.
const archive = [...photos]
  .sort((a, b) => -byDate(a, b) || 0)
  .sort((a, b) => (a.date ? 0 : 1) - (b.date ? 0 : 1));
const all = {
  id: 'grid',
  kind: 'all',
  title: null,
  label: 'All photos',
  photos: archive,
};
const albums = Object.keys(ALBUMS).map((k) => ({
  id: `a/${k}`,
  kind: 'album',
  title: ALBUMS[k],
  photos: photos.filter((p) => p.album === k).sort(byDate),
}));
for (const f of FACETS) {
  const map = new Map();
  for (const p of photos)
    for (const v of f.of(p)) map.set(v, [...(map.get(v) || []), p]);
  f.values = [...map.keys()]
    .sort(f.sort || ((a, b) => a.localeCompare(b)))
    .map((v) => ({
      id: `f/${f.key}-${slug(v)}`,
      kind: 'facet',
      v,
      title: f.text(v),
      photos: map.get(v).sort((a, b) => -byDate(a, b)),
    }));
}
const contexts = [all, ...albums, ...FACETS.flatMap((f) => f.values)];
for (const c of contexts) {
  c.href = c === all ? 'index.html' : `${c.id}.html`;
  c.label ||= c.title;
}
const facet = (key, v) =>
  FACETS.find((f) => f.key === key).values.find((x) => x.v === v);
const albumOf = (p) => albums.find((a) => a.id === `a/${p.album}`);
const newest = archive[0];

// a photo inside a context: albums need no ?in=, they are the default
const photoHref = (p, ctx) =>
  `p/${p.slug}.html${ctx && ctx.kind !== 'album' ? `?in=${ctx.id}` : ''}`;
const ctxHref = (c) => `${c.href}#grid`;

// LEDGER CELLS, shared by the static list and the context JSON:
// columns Date, Place, Camera, Lens, Shutter, Aperture, Focal, ISO; each
// a list of [text, href] (href relative to the root, absent for plain text)
const cells = (p) => [
  p.date
    ? [
        [
          `${+p.date.slice(8, 10)} ${p.monthName}`,
          facet('month', pad(p.month)).href,
        ],
        [String(p.year), facet('year', String(p.year)).href],
      ]
    : [['Undated']],
  p.place ? [[p.place, facet('place', p.place).href]] : [],
  p.camera ? [[p.camera, facet('camera', p.camera).href]] : [],
  p.lens ? [[p.lens, facet('lens', p.lens).href]] : [],
  p.shutter ? [[p.shutter, facet('shutter', p.shutter).href]] : [],
  p.aperture ? [[p.aperture, facet('aperture', p.aperture).href]] : [],
  p.focal ? [[p.focal, facet('focal', p.focalBucket).href]] : [],
  p.iso ? [[p.iso, facet('iso', p.iso).href]] : [],
];
const tipMeta = (p) => [shortDate(p), p.location].filter(Boolean).join(' · ');
const ratio = (p) => (p.width / p.height).toFixed(4);
const itemStyle = (p) => `--ar: ${ratio(p)}; --photo: ${p.color}`;
const thumbW = (p) => Math.round((240 * p.width) / p.height);

// ICONS: 16px, 1.5px strokes, drawn here
const svg = (d) =>
  `<svg class="toggle_svg" viewBox="0 0 16 16" aria-hidden="true">${d}</svg>`;
const ICONS = {
  square: svg('<rect x="2.75" y="2.75" width="10.5" height="10.5" rx="1"/>'),
  original: svg('<rect x="1.75" y="4" width="12.5" height="8" rx="1"/>'),
  grid: svg(
    '<rect x="2.25" y="2.25" width="4.75" height="4.75" rx=".75"/><rect x="9" y="2.25" width="4.75" height="4.75" rx=".75"/><rect x="2.25" y="9" width="4.75" height="4.75" rx=".75"/><rect x="9" y="9" width="4.75" height="4.75" rx=".75"/>'
  ),
  list: svg(
    '<path d="M6 4h7.5M6 8h7.5M6 12h7.5M2.5 4h.5M2.5 8h.5M2.5 12h.5"/>'
  ),
  small: svg('<rect x="5.25" y="5.25" width="5.5" height="5.5" rx=".75"/>'),
  medium: svg('<rect x="3.75" y="3.75" width="8.5" height="8.5" rx="1"/>'),
  large: svg('<rect x="2.25" y="2.25" width="11.5" height="11.5" rx="1"/>'),
  cover: svg(
    '<rect x="1.75" y="3.25" width="12.5" height="9.5" rx="1"/><path d="M4.5 6.5V5.5h1.5M11.5 6.5V5.5H10M4.5 9.5v1h1.5M11.5 9.5v1H10"/>'
  ),
  contain: svg(
    '<rect x="1.75" y="3.25" width="12.5" height="9.5" rx="1"/><rect x="5.25" y="5.75" width="5.5" height="4.5" rx=".5"/>'
  ),
  info: svg('<circle cx="8" cy="8" r="6.25"/><path d="M8 7.25v4M8 4.75v.25"/>'),
  filter: svg('<path d="M2.25 3.25h11.5l-4.5 5.25v4.25l-2.5 1v-5.25z"/>'),
  strip: svg(
    '<rect x="1.75" y="3.75" width="12.5" height="8.5" rx="1"/><path d="M1.75 6h12.5M1.75 10h12.5M6 6v4M10 6v4"/>'
  ),
};

// PARTIALS. `pre` is the path back to the prototype root ('' or '../').
const head = (pre, { title, description, extra = '' }) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="theme-color" content="#0f0f0f">
<meta name="mg-root" content="${pre}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist+Mono:wght@400..500&amp;family=Geist:wght@300..700&amp;display=swap">
<link rel="stylesheet" href="${pre}mg.css">
<script src="${pre}mg.js" defer blocking="render"></script>
${extra}
</head>`;

const chip = (pre, c, current) =>
  `<li><a class="chip" href="${pre}${ctxHref(c)}"${current === c ? ' aria-current="page"' : ''}>${esc(c.title)} <span class="chip_count">${c.photos.length}</span></a></li>`;
const palette = (pre, { inline = false, current } = {}) => {
  const groups = [
    `<section class="palette_group"><h2 class="palette_heading">Albums</h2><ul class="palette_chips">${albums.map((c) => chip(pre, c, current)).join('')}</ul></section>`,
    ...FACETS.map(
      (f) =>
        `<section class="palette_group"><h2 class="palette_heading">${f.label}</h2><ul class="palette_chips">${f.values.map((c) => chip(pre, c, current)).join('')}</ul></section>`
    ),
  ].join('\n');
  const body = `<form class="palette_bar" method="dialog">
<input class="palette_search" type="search" name="q" placeholder="Filter by place, camera, lens, year, f-number…" aria-label="Filter photos" autocomplete="off"${inline ? '' : ' autofocus'}>
${inline ? '' : '<button class="palette_close" type="submit" formnovalidate value="close" aria-label="Close" tabindex="-1"><kbd>Esc</kbd></button>'}
</form>
<div class="palette_groups">
${groups}
</div>`;
  return inline
    ? `<section class="palette palette-inline surface" id="filter" aria-label="Filter photos">\n${body}\n</section>`
    : `<dialog class="palette surface" id="palette" aria-label="Filter photos" closedby="any">\n${body}\n</dialog>`;
};

// KEYBOARD SHORTCUTS: two sections. In a combination, a string with
// spaces around it is a word (“or”), everything else is a key cap.
const KEYS = [
  [
    'Viewing mode',
    [
      [['←', '→'], 'Previous / next photo'],
      [['↑'], 'Open browsing mode'],
      [['z'], '<b>Z</b>oom to 1:1 and back'],
      [['i'], 'Photo <b>i</b>nformation'],
      [['f'], '<b>F</b>ill window / <b>f</b>it photo'],
      [['s'], 'Film<b>s</b>trip'],
      [['/', ' or ', '⌘K'], 'Filter'],
      [['?'], 'Keyboard shortcuts'],
    ],
  ],
  [
    'Browsing mode',
    [
      [['←', '→', '↑', '↓'], 'Select photo; enter to open it'],
      [['Home', 'End'], 'Select first / last photo'],
      [['Esc'], 'Back to viewing mode'],
      [['1', '2', '3'], 'Thumbnail size'],
      [['t'], 'Crop or original <b>t</b>humbnail'],
      [['v'], 'Grid or list <b>v</b>iew'],
      [['/'], 'Filter'],
    ],
  ],
];
const keysPane = `<aside class="pane pane-keys surface" id="keys" aria-labelledby="keys-title">
<div class="pane_head"><h2 class="pane_title" id="keys-title">Keyboard Shortcuts</h2><label class="pane_close" for="keys-toggle">Close</label></div>
${KEYS.map(
  ([title, rows]) => `<section class="keys_section">
<h3 class="keys_heading">${title}</h3>
<dl class="keys_list">
${rows.map(([k, a]) => `<dt class="keys_combo">${k.map((x) => (x.startsWith(' ') ? `<span class="keys_or">${x.trim()}</span>` : `<kbd>${x}</kbd>`)).join('')}</dt><dd class="keys_action">${a}</dd>`).join('\n')}
</dl>
</section>`
).join('\n')}
</aside>`;

// ICON TOGGLES shared by the HUD and the panel header. Each tooltip
// carries the label and, when there is one, the key. A checkbox's value is
// what it stores when checked; data-off is what it stores otherwise.
const tip = (label, key) =>
  `<span class="toggle_tip surface" aria-hidden="true">${label}${key ? ` <kbd>${key}</kbd>` : ''}</span>`;
const option = (
  type,
  name,
  value,
  label,
  icon,
  { checked, key, off, id, aria } = {}
) =>
  `<label class="toggle_option"><input class="a11y-srOnly" type="${type}" name="${name}"${id ? ` id="${id}"` : ''}${value ? ` value="${value}"` : ''}${off ? ` data-off="${off}"` : ''} aria-label="${aria || label.replace(/<[^>]+>/g, '')}"${checked ? ' checked' : ''}>${icon}${tip(label, key)}</label>`;
const plain = (html, cls = '') =>
  `<div class="toggle toggle-plain${cls}">${html}</div>`;
const filter = (inline) =>
  plain(
    inline
      ? `<a class="toggle_option" href="#filter" aria-label="Filter">${ICONS.filter}${tip('Filter', '/')}</a>`
      : `<button class="toggle_option" type="button" command="show-modal" commandfor="palette" aria-label="Filter">${ICONS.filter}${tip('Filter', '/')}</button>`
  );

// HUD: breadcrumb left; Filter, Info, Filmstrip, Whole photo and help right
const hud = (pre, p, ctx, { inline }) => `<header class="hud surface table_hud">
<nav class="hud_crumbs" aria-label="Breadcrumb"><ol>
<li><a href="${pre}index.html">${SITE}</a></li>
${ctx.title ? `<li><a class="hud_context" href="${pre}${ctxHref(ctx)}">${esc(ctx.title)}</a></li>` : ''}
<li><h1 class="hud_title">${esc(p.title)}</h1></li>
</ol></nav>
<div class="hud_actions">
${filter(inline)}
${plain(option('checkbox', 'info', '', '<b>I</b>nfo', ICONS.info, { key: 'i', id: 'info-toggle' }))}
${plain(option('checkbox', 'strip', '', 'Film<b>s</b>trip', ICONS.strip, { key: 's' }))}
${plain(`<label class="toggle_option"><input class="a11y-srOnly" type="checkbox" name="fit" value="contain" data-off="cover" aria-label="Fit photo"><span class="toggle_off">${ICONS.contain}</span><span class="toggle_on">${ICONS.cover}</span><span class="toggle_tip surface toggle_off" aria-hidden="true"><b>F</b>it photo <kbd>f</kbd></span><span class="toggle_tip surface toggle_on" aria-hidden="true"><b>F</b>ill window <kbd>f</kbd></span></label>`)}
${plain(option('checkbox', 'keys', '', 'Keyboard shortcuts', '<span class="toggle_glyph" aria-hidden="true">?</span>', { key: '?', id: 'keys-toggle' }), ' hud_help')}
</div>
</header>`;

// PANEL HEADER: breadcrumb and count; crop and size (grid only); then the
// grid/list pair and Filter at the right end, so nothing jumps between views
const panelHead = (
  pre,
  ctx,
  { inline, view }
) => `<header class="table_head surface">
<nav class="table_crumbs" aria-label="Context"><ol><li><a href="${pre}index.html">${SITE}</a></li>${ctx.title ? `<li><a class="table_context" href="${pre}${ctxHref(ctx)}">${esc(ctx.title)}</a></li>` : ''}</ol><span class="table_count">${plural(ctx.photos.length)}</span></nav>
<div class="table_tools">
<fieldset class="toggle table_gridOnly"><legend class="a11y-srOnly">Thumbnail shape</legend>
${option('radio', 'crop', 'square', 'Crop or original <b>t</b>humbnail', ICONS.square, { checked: true, key: 't', aria: 'Cropped thumbnails' })}
${option('radio', 'crop', 'original', 'Crop or original <b>t</b>humbnail', ICONS.original, { key: 't', aria: 'Original thumbnails' })}
</fieldset>
<fieldset class="toggle table_gridOnly"><legend class="a11y-srOnly">Thumbnail size</legend>
${option('radio', 'size', 's', 'Small thumbnails', ICONS.small, { key: '1' })}
${option('radio', 'size', 'm', 'Medium thumbnails', ICONS.medium, { checked: true, key: '2' })}
${option('radio', 'size', 'l', 'Large thumbnails', ICONS.large, { key: '3' })}
</fieldset>
<fieldset class="toggle"><legend class="a11y-srOnly">View</legend>
${option('radio', 'view', 'grid', 'Grid or list <b>v</b>iew', ICONS.grid, { checked: view !== 'list', key: 'v', aria: 'Grid view' })}
${option('radio', 'view', 'list', 'Grid or list <b>v</b>iew', ICONS.list, { checked: view === 'list', key: 'v', aria: 'List view' })}
</fieldset>
${filter(inline)}
</div>
</header>`;

// INFO: every value links to its context page
function info(pre, p) {
  const a = (c, text) => `<a href="${pre}${ctxHref(c)}">${esc(text)}</a>`;
  const rows = [];
  const row = (term, value, cls = '') =>
    rows.push(
      `<div class="info_row"><dt class="info_term">${term}</dt><dd class="info_value${cls}">${value}</dd></div>`
    );
  if (p.date) {
    const time = p.date.slice(11, 16);
    row(
      'Date',
      `<span>${+p.date.slice(8, 10)} ${a(facet('month', pad(p.month)), p.monthName)} ${a(facet('year', String(p.year)), p.year)}</span>${time !== '00:00' ? `<span>${time}</span>` : ''}`
    );
  }
  if (p.place)
    row(
      'Place',
      `${p.location !== p.place ? `<span>${esc(p.location.split(', ')[0])},</span> ` : ''}${a(facet('place', p.place), p.place)}`
    );
  if (p.camera) row('Camera', a(facet('camera', p.camera), p.camera));
  if (p.lens) row('Lens', a(facet('lens', p.lens), p.lens));
  const exp = [
    p.shutter && a(facet('shutter', p.shutter), p.shutter),
    p.aperture && a(facet('aperture', p.aperture), p.aperture),
    p.focal && a(facet('focal', p.focalBucket), p.focal),
    p.iso && a(facet('iso', p.iso), `ISO ${p.iso}`),
  ].filter(Boolean);
  if (exp.length) row('Exposure', exp.join(' '), ' info_value-exposure');
  if (p.keywords.length)
    row('Keywords', p.keywords.map((k) => a(facet('keyword', k), k)).join(' '));
  if (!p.camera && !p.date)
    row(
      'Capture',
      '<span class="info_empty">No camera data in this file</span>'
    );
  row('Size', `<span>${p.width} × ${p.height} px</span>`);
  row('File', `<span class="info_path">${esc(p.source)}</span>`);
  return `<aside class="pane pane-info info surface" id="info" aria-labelledby="info-title">
<div class="pane_head"><h2 class="pane_title" id="info-title">${esc(p.title)}</h2><label class="pane_close" for="info-toggle">Close</label></div>
<dl class="info_list">
${rows.join('\n')}
</dl>
</aside>`;
}

// THE CONTEXT'S PHOTOS: strip, grid, list, rail
const strip = (
  pre,
  ctx,
  current
) => `<nav class="strip surface stage_strip" aria-label="${esc(ctx.label)}, ${plural(ctx.photos.length)}">
<ol class="strip_list">
${ctx.photos.map((x) => `<li class="strip_item" style="${itemStyle(x)}"><a class="strip_link" href="${pre}${photoHref(x, ctx)}"${x === current ? ' aria-current="page"' : ''}><img class="strip_image" src="${pre}img/t/${x.file}" width="${thumbW(x)}" height="240" alt="${esc(x.title)}" decoding="async"></a></li>`).join('\n')}
</ol>
</nav>`;
const grid = (pre, ctx, current) => {
  const seen = new Set();
  return `<ol class="thumbs">
${ctx.photos
  .map((p) => {
    const y = p.year || 'undated';
    const id = seen.has(y) ? '' : ` id="y-${slug(y)}"`;
    seen.add(y);
    return `<li class="thumbs_item"${id} style="${itemStyle(p)}"><a class="thumbs_link" href="${pre}${photoHref(p, ctx)}"${p === current ? ' aria-current="page"' : ''}><img class="thumbs_image" src="${pre}img/t/${p.file}" srcset="${pre}img/t/${p.file} ${thumbW(p)}w, ${pre}img/${p.file} ${p.width}w" sizes="(width < 768px) 34vw, 20vw" width="${thumbW(p)}" height="240" alt="${esc(p.title)}" loading="lazy" decoding="async"><span class="thumbs_tip surface" aria-hidden="true"><span class="thumbs_tipTitle">${esc(p.title)}</span><span class="thumbs_tipMeta">${esc(tipMeta(p))}</span></span></a></li>`;
  })
  .join('\n')}
</ol>`;
};
// SORT KEYS for the list, one per sortable column (Title, Date, Place,
// Camera, Lens, Shutter, Aperture, Focal, ISO): real values, not display
// text. Empty string when the photo has no value; those sort last.
const SORT_COLUMNS = [
  ['Title', 'text'],
  ['Date', 'text'],
  ['Place', 'text'],
  ['Camera', 'text'],
  ['Lens', 'text'],
  ['Shutter', 'num'],
  ['Aperture', 'num'],
  ['Focal', 'num'],
  ['ISO', 'num'],
];
const sortKeys = (p) => [
  p.title.toLowerCase(),
  p.date || '',
  (p.place || '').toLowerCase(),
  (p.camera || '').toLowerCase(),
  (p.lens || '').toLowerCase(),
  p.shutter ? +seconds(p.shutter).toPrecision(6) : '',
  p.aperture ? parseFloat(p.aperture.slice(2)) : '',
  p.focal ? parseFloat(p.focal) : '',
  p.iso ? +p.iso : '',
];
const ledger = (pre, ctx, current) => `<div class="ledger">
<table>
<thead><tr><th><span class="a11y-srOnly">Thumbnail</span></th>${SORT_COLUMNS.map(([l, t]) => `<th data-type="${t}"><button class="ledger_sort" type="button">${l}<span class="ledger_dir" aria-hidden="true"></span></button></th>`).join('')}</tr></thead>
<tbody>
${ctx.photos
  .map((p, i) => {
    const k = sortKeys(p);
    return `<tr data-i="${i}"><td><a class="ledger_thumb" href="${pre}${photoHref(p, ctx)}" tabindex="-1" style="${itemStyle(p)}"><img class="ledger_image" src="${pre}img/t/${p.file}" width="${thumbW(p)}" height="240" alt="" loading="lazy"><span class="ledger_preview surface" aria-hidden="true" style="--preview: url('${pre}img/${p.file}')"><span class="ledger_previewImage"></span></span></a></td><td data-sort="${esc(k[0])}"><a href="${pre}${photoHref(p, ctx)}"${p === current ? ' aria-current="page"' : ''}>${esc(p.title)}</a></td>${cells(
      p
    )
      .map(
        (col, n) =>
          `<td data-sort="${esc(k[n + 1])}">${col.map(([t, h]) => (h ? `<a href="${pre}${h}#grid">${esc(t)}</a>` : esc(t))).join(' ')}</td>`
      )
      .join('')}</tr>`;
  })
  .join('\n')}
</tbody>
</table>
</div>`;
const rail = (ctx) => {
  const years = [...new Set(ctx.photos.map((p) => p.year || 'Undated'))];
  return `<div class="table_rail"${years.length < 2 ? ' hidden' : ''}><nav class="rail" aria-label="Years"><ol class="rail_list">${years.map((y) => `<li><a class="rail_link" href="#y-${slug(y)}"><span class="rail_year surface">${y}</span></a></li>`).join('')}</ol></nav></div>`;
};

// THE TEMPLATE
function page({
  file,
  photo: p,
  ctx,
  start = 'view',
  view = 'grid',
  inlinePalette = false,
}) {
  const pre = file.includes('/') ? '../' : '';
  const list = ctx.photos;
  const i = list.indexOf(p),
    n = list.length;
  // no wrapping: the last photo has no next, the first has no previous
  const next = list[i + 1],
    prev = list[i - 1];
  const near = [next, prev]
    .filter(Boolean)
    .map((x) => `${pre}${photoHref(x, ctx)}`);
  const rules = JSON.stringify({
    prerender: [
      ...(near.length ? [{ urls: near }] : []),
      {
        where: { selector_matches: '.thumbs_link, .strip_link' },
        eagerness: 'moderate',
      },
    ],
  });
  const extra = [
    view === 'list' ? '<meta name="mg-view" content="list">' : '',
    next ? `<link rel="next" href="${pre}${photoHref(next, ctx)}">` : '',
    prev ? `<link rel="prev" href="${pre}${photoHref(prev, ctx)}">` : '',
    `<script type="speculationrules">${rules}</script>`,
  ]
    .filter(Boolean)
    .join('\n');
  const title =
    start === 'grid'
      ? `${ctx.label} · ${SITE}`
      : `${p.title} · ${ctx.label} · ${SITE}`;
  const style = `--photo: ${p.color}; --photo-ratio: ${ratio(p)}; --photo-zoom-width: ${p.width * 2}`;
  return `${head(pre, { title, description: start === 'grid' ? `${ctx.label}: ${plural(n)} in the ${SITE} demo.` : `${p.title}, a photograph in ${ctx.label}.`, extra })}
<body class="viewer" style="${style}">
<a class="a11y-skipLink" href="#grid">Skip to the photos</a>
<div class="stage">
<main class="stage_frame" id="main" tabindex="-1">
<div class="stage_scroller">
<a class="stage_next"${next ? ` href="${pre}${photoHref(next, ctx)}" aria-label="Next photo: ${esc(next.title)}"` : ''}><img class="stage_photo" src="${pre}img/${p.file}" width="${p.width}" height="${p.height}" alt="${esc(p.title)}"${start === 'view' ? ' fetchpriority="high"' : ''}></a>
</div>
<a class="stage_prev"${prev ? ` href="${pre}${photoHref(prev, ctx)}" aria-label="Previous photo: ${esc(prev.title)}"` : ''}></a>
<input class="stage_zoom a11y-srOnly" type="checkbox" tabindex="-1" aria-label="Zoom to full size">
</main>
${strip(pre, ctx, p)}
<a class="stage_hint" href="#grid"><span class="a11y-srOnly">Show the photos</span></a>
</div>
<section class="table${start === 'grid' ? ' table-start' : ''}" id="grid" aria-label="${esc(ctx.label)}">
${hud(pre, p, ctx, { inline: inlinePalette })}
<div class="table_scroller">
${panelHead(pre, ctx, { inline: inlinePalette, view })}
${inlinePalette ? palette(pre, { inline: true, current: ctx }) : ''}
<div class="table_body">
<div class="table_photos">
${grid(pre, ctx, p)}
${ledger(pre, ctx, p)}
</div>
${rail(ctx)}
</div>
</div>
${info(pre, p)}
${keysPane}
</section>
${inlinePalette ? '' : palette(pre, { current: ctx })}
</body>
</html>
`;
}

// PAGES
const pages = new Map();
pages.set('index.html', page({ file: 'index.html', photo: newest, ctx: all }));
// grid.html was the all-photos grid: it now redirects to the same view
pages.set(
  'grid.html',
  `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="0; url=index.html#grid">
<link rel="canonical" href="index.html#grid">
<title>All photos · ${SITE}</title>
<link rel="stylesheet" href="mg.css">
</head>
<body>
<p><a href="index.html#grid">All photos</a></p>
</body>
</html>
`
);
pages.set(
  'list.html',
  page({
    file: 'list.html',
    photo: newest,
    ctx: all,
    start: 'grid',
    view: 'list',
  })
);
for (const p of photos)
  pages.set(
    `p/${p.slug}.html`,
    page({ file: `p/${p.slug}.html`, photo: p, ctx: albumOf(p) })
  );
for (const c of contexts.slice(1))
  pages.set(
    c.href,
    page({ file: c.href, photo: c.photos[0], ctx: c, start: 'grid' })
  );
const d200 = facet('camera', 'Nikon D200');
pages.set(
  'filter.html',
  page({
    file: 'filter.html',
    photo: d200.photos[0],
    ctx: d200,
    start: 'grid',
    inlinePalette: true,
  })
);

for (const dir of ['p', 'a', 'f'])
  fs.rmSync(dir, { recursive: true, force: true });
const config = await prettier.resolveConfig(path.resolve('index.html'));
for (const [file, html] of pages) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    await prettier.format(html, { ...config, filepath: file })
  );
}

// CONTEXT JSON for ?in=: title (null for all photos), page, and per photo
// slug, title, aspect ratio, color, year, tooltip line, ledger cells
for (const c of contexts) {
  const json = {
    title: c.title,
    href: c.href,
    photos: c.photos.map((p) => ({
      slug: p.slug,
      title: p.title,
      ar: +ratio(p),
      color: p.color,
      year: p.year || 'undated',
      tip: tipMeta(p),
      cells: cells(p),
      sort: sortKeys(p),
    })),
  };
  fs.writeFileSync(
    `${c.id}.json`,
    await prettier.format(JSON.stringify(json), {
      ...config,
      filepath: `${c.id}.json`,
    })
  );
}

// CSS: mCSS source compiled with PostCSS (imports bundled, @custom-media
// resolved, native cascade layers kept)
const entry = 'styles/mg.css';
const css = await postcss([
  postcssImport(),
  // the source keeps its comments; the served file does not need them
  {
    postcssPlugin: 'strip-comments',
    OnceExit: (r) => r.walkComments((c) => c.remove()),
  },
  postcssMixins(),
  postcssPresetEnv({
    stage: 2,
    features: { 'cascade-layers': false, 'random-function': false },
  }),
]).process(fs.readFileSync(entry, 'utf8'), { from: entry, to: 'mg.css' });
fs.writeFileSync(
  'mg.css',
  await prettier.format(css.css, { ...config, filepath: 'mg.css' })
);
fs.writeFileSync(
  'photos.json',
  await prettier.format(JSON.stringify(photos), {
    ...config,
    filepath: 'photos.json',
  })
);

// CHECK: every local href/src/srcset/url(), fragment, prerender URL and
// context JSON reference resolves
const problems = [];
const ids = (html) =>
  new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
const exists = (from, ref) => {
  const [p, hash] = ref.split('#');
  const target = p ? path.join(path.dirname(from), p.split('?')[0]) : from;
  if (!fs.existsSync(target)) return `${from}: missing ${ref}`;
  if (hash && !ids(fs.readFileSync(target, 'utf8')).has(hash))
    return `${from}: no #${hash} in ${target}`;
};
for (const file of pages.keys()) {
  const html = fs.readFileSync(file, 'utf8');
  const refs = [...html.matchAll(/\s(?:href|src)="([^"]+)"/g)].map((m) => m[1]);
  for (const m of html.matchAll(/\ssrcset="([^"]+)"/g))
    refs.push(...m[1].split(',').map((s) => s.trim().split(/\s+/)[0]));
  for (const m of html.matchAll(/url\('([^']+)'\)/g)) refs.push(m[1]);
  for (const m of html.matchAll(/"urls":\s*\[([^\]]*)\]/g))
    refs.push(...JSON.parse(`[${m[1]}]`));
  for (const ref of refs)
    if (!/^(https?:|data:|mailto:)/.test(ref)) problems.push(exists(file, ref));
  for (const id of html.matchAll(/(?:popovertarget|commandfor)="([^"]+)"/g))
    if (!ids(html).has(id[1])) problems.push(`${file}: no target #${id[1]}`);
  for (const m of html.matchAll(/\?in=([^"#]+)/g))
    if (!fs.existsSync(`${m[1]}.json`))
      problems.push(`${file}: no ${m[1]}.json`);
  if (/text-transform|class="stamp/.test(html))
    problems.push(`${file}: uppercase treatment`);
}
for (const c of contexts)
  for (const p of JSON.parse(fs.readFileSync(`${c.id}.json`, 'utf8')).photos) {
    problems.push(
      exists('index.html', `p/${p.slug}.html`),
      exists('index.html', `img/t/${p.slug}.jpg`)
    );
    for (const [, h] of p.cells.flat())
      if (h) problems.push(exists('index.html', `${h}#grid`));
  }
for (const f of fs.readdirSync('styles/site'))
  if (/text-transform/.test(fs.readFileSync(`styles/site/${f}`, 'utf8')))
    problems.push(`styles/site/${f}: text-transform`);
const found = problems.filter(Boolean);
const kb = (f) => (fs.statSync(f).size / 1024).toFixed(1);
console.log(
  `${pages.size} pages, ${contexts.length} context JSON files, mg.css ${kb('mg.css')} KB, mg.js ${kb('mg.js')} KB`
);
console.log(
  found.length
    ? [...new Set(found)].join('\n')
    : 'link check: every href, src, srcset, url(), fragment, prerender URL and context JSON reference resolves'
);
process.exitCode = found.length ? 1 : 0;
