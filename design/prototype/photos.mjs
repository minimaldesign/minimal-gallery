// Stand-in for the v2 pipeline: copies the chosen demo photos, reads EXIF
// with exiftool, computes the dominant color and a luminance histogram,
// and writes photos.json. Run once: `node photos.mjs`.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const SRC = '../../examples/demo/photos';
const PICKS = {
  colors: [
    'Au_Port',
    'Haleakala',
    'Kaiona_Cafe',
    'blue_door',
    'lazy-sunday-afternoons',
    'noguchi',
    'Takayama',
    'Sakura_Impression',
  ],
  light: [
    'Bamboo_forest',
    'Kyoto_Night',
    'Prayers',
    'Soba_ya',
    'Books_and_streetlight',
    'Towards_the_sun',
    'Real_Life_Sandbox',
  ],
  people: [
    'Mort_pour_la_France',
    'Double_Player',
    'Arashiyama Smile',
    'Kyoto_Bikers',
    'Mister_Clean',
    'Saxophonist',
    'Gion_crowd',
  ],
  feelings: ['Montauk', 'Greenport', 'Itchy', 'Shirakawa-Go', 'Tea_in_Kyoto'],
  shapes: ['Coney_Island_Tower', 'Chocolate_DNA', 'Coquillage'],
  motion: ['Hanami_fire', 'Wave'],
};

const slugify = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
const trimNum = (n) => String(+n.toFixed(1));

// sRGB 8-bit to OKLab (Björn Ottosson's matrices)
const lin = (c) =>
  (c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
function oklab(r, g, b) {
  [r, g, b] = [lin(r), lin(g), lin(b)];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817104123 * g + 0.6299787162 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

// Dominant color: k-means (k=5) in OKLab over a 48px sample, then the
// cluster with the best size-times-chroma score, so a large neutral area
// does not beat the color the eye remembers; near-black and near-white
// clusters count for a quarter.
function dominant(px) {
  let cs = [0, 0.2, 0.4, 0.6, 0.8].map((f) => px[Math.floor(f * px.length)]);
  for (let it = 0; it < 12; it++) {
    const acc = cs.map(() => [0, 0, 0, 0]);
    for (const p of px) {
      let bi = 0,
        bd = Infinity;
      cs.forEach((c, i) => {
        const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2;
        if (d < bd) ((bd = d), (bi = i));
      });
      const a = acc[bi];
      a[0] += p[0];
      a[1] += p[1];
      a[2] += p[2];
      a[3]++;
    }
    cs = acc.map((a, i) =>
      a[3] ? [a[0] / a[3], a[1] / a[3], a[2] / a[3], a[3]] : cs[i]
    );
  }
  const score = (c) =>
    (c[3] || 0) *
    (0.15 + Math.hypot(c[1], c[2]) * 8) *
    (c[0] > 0.18 && c[0] < 0.92 ? 1 : 0.25);
  const [L, a, b] = cs.sort((x, y) => score(y) - score(x))[0];
  const C = Math.hypot(a, b),
    H = ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
  return `oklch(${L.toFixed(3)} ${C.toFixed(3)} ${H.toFixed(1)})`;
}

const focalBucket = (f) =>
  f <= 24 ? 'wide' : f <= 50 ? 'normal' : f <= 105 ? 'short-tele' : 'tele';
const shutter = (t) =>
  t >= 0.5 ? `${trimNum(t)} s` : `1/${Math.round(1 / t)} s`;
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

const files = Object.entries(PICKS).flatMap(([album, names]) =>
  names.map((n) => ({ album, name: n, src: path.join(SRC, album, `${n}.jpg`) }))
);
const tags = [
  '-json',
  '-Make',
  '-Model',
  '-LensID',
  '-DateTimeOriginal',
  '-ExposureTime#',
  '-FNumber#',
  '-FocalLength#',
  '-ISO#',
  '-Keywords',
  '-ImageWidth',
  '-ImageHeight',
  '-City',
  '-Country',
  '-Sub-location',
];
const exif = JSON.parse(
  execFileSync('exiftool', [...tags, ...files.map((f) => f.src)], {
    encoding: 'utf8',
  })
);

fs.mkdirSync('img/t', { recursive: true });
const photos = [];
for (const [i, f] of files.entries()) {
  const x = exif[i];
  const slug = slugify(f.name);
  // sharp converts embedded profiles (several are Adobe RGB) to sRGB on output
  await sharp(f.src)
    .jpeg({ quality: 84, mozjpeg: true })
    .toFile(`img/${slug}.jpg`);
  await sharp(f.src)
    .resize({ height: 240 })
    .jpeg({ quality: 78, mozjpeg: true })
    .toFile(`img/t/${slug}.jpg`);
  const { data, info } = await sharp(f.src)
    .resize(48, 32, { fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const px = [],
    bins = new Array(48).fill(0);
  for (let p = 0; p < data.length; p += info.channels) {
    const lab = oklab(data[p], data[p + 1], data[p + 2]);
    px.push(lab);
    bins[Math.min(47, Math.floor(lab[0] * 48))]++;
  }
  const max = Math.max(...bins);
  const hist =
    'M0 24' +
    bins
      .map((v, b) => `H${b}V${(24 - (v / max) * 23).toFixed(1)}H${b + 1}`)
      .join('') +
    'V24Z';

  const camera = x.Model
    ? /nikon/i.test(x.Model)
      ? 'Nikon ' + x.Model.replace(/nikon\s*/i, '')
      : x.Model
    : null;
  const lens = x.LensID
    ? x.LensID.replace(/\.0/g, '')
        .replace(/(\d)-(\d)/g, '$1–$2')
        .replace(/mm/, ' mm')
    : null;
  let date = null,
    dateText = null,
    year = null,
    month = null;
  if (x.DateTimeOriginal) {
    const [d, t] = x.DateTimeOriginal.split(' ');
    const [Y, M, D] = d.split(':').map(Number);
    year = Y;
    month = M;
    date = `${d.replace(/:/g, '-')}T${t.slice(0, 8)}`;
    dateText =
      `${D} ${MONTHS[M - 1]} ${Y}` +
      (t.startsWith('00:00:00') ? '' : `, ${t.slice(0, 5)}`);
  }
  const keywords = x.Keywords ? [].concat(x.Keywords).map(String) : [];
  // Place from IPTC: city and country make the facet; the sub-location
  // only adds detail to the label.
  const place = x.City ? [x.City, x.Country].filter(Boolean).join(', ') : null;
  const location = x.City
    ? [x['Sub-location'], x.City, x.Country].filter(Boolean).join(', ')
    : null;
  photos.push({
    slug,
    album: f.album,
    file: `${slug}.jpg`,
    title: f.name.replace(/[_-]+/g, ' ').replace(/^./, (c) => c.toUpperCase()),
    width: x.ImageWidth,
    height: x.ImageHeight,
    date,
    dateText,
    year,
    month,
    monthName: month ? MONTHS[month - 1] : null,
    camera,
    lens,
    shutter: x.ExposureTime ? shutter(x.ExposureTime) : null,
    aperture: x.FNumber ? `f/${trimNum(x.FNumber)}` : null,
    focal: x.FocalLength ? `${trimNum(x.FocalLength)} mm` : null,
    focalBucket: x.FocalLength ? focalBucket(x.FocalLength) : null,
    iso: x.ISO ? String(x.ISO) : null,
    // the photo's path inside the gallery: album folder and original file
    source: `${f.album}/${f.name}.jpg`,
    place,
    location,
    keywords,
    color: dominant(px),
    histogram: hist,
  });
  process.stdout.write('.');
}
fs.writeFileSync('photos.json', JSON.stringify(photos, null, 1) + '\n');
console.log(`\n${photos.length} photos`);
