/** Helpers that turn raw tag values into the manifest’s shapes. */

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Dates are kept as the camera’s wall-clock time, `YYYY-MM-DDTHH:MM:SS`, with
 * no offset. Offsets written in XMP or IPTC come from the computer that edited
 * the file, not from where the photo was taken, so they are dropped. The only
 * offset kept is EXIF OffsetTimeOriginal, read separately by `parseOffset`.
 */

/** `2005:02:27 18:16:10` to `2005-02-27T18:16:10`. Any offset or subseconds are dropped. */
export function parseExifDate(raw: unknown): string | undefined {
  if (raw instanceof Date)
    return isNaN(raw.getTime()) ? undefined : dateToLocal(raw);
  if (typeof raw !== 'string') return undefined;
  const m = raw
    .trim()
    .match(/^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return undefined;
  const [, y, mo, d, h, mi, s = '00'] = m;
  if (y === '0000' || mo === '00' || d === '00') return undefined;
  return `${y}-${mo}-${d}T${h}:${mi}:${s}`;
}

/** EXIF OffsetTimeOriginal (`+09:00`, `-0500`, `Z`) to `+09:00`, or undefined. */
export function parseOffset(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const t = raw.trim();
  if (t === 'Z') return '+00:00';
  const m = t.match(/^([+-])(\d{2}):?(\d{2})$/);
  if (!m) return undefined;
  const hours = Number(m[2]);
  const minutes = Number(m[3]);
  if (hours > 14 || minutes > 59) return undefined;
  return `${m[1]}${m[2]}:${m[3]}`;
}

/** ISO 8601 as written in XMP: keeps the wall-clock part, drops the offset and subseconds. */
export function parseIsoLikeDate(raw: string): string | undefined {
  const m = raw
    .trim()
    .match(
      /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$/
    );
  if (!m) return undefined;
  const [, y, mo, d, h = '00', mi = '00', s = '00'] = m;
  return `${y}-${mo}-${d}T${h}:${mi}:${s}`;
}

/** IPTC DateCreated `20050201` + TimeCreated `163846-0500` to `2005-02-01T16:38:46`. */
export function parseIptcDate(
  date: unknown,
  time: unknown
): string | undefined {
  if (typeof date !== 'string') return undefined;
  const m = date.match(/^(\d{4})-?(\d{2})-?(\d{2})$/);
  if (!m) return undefined;
  let t = '00:00:00';
  if (typeof time === 'string') {
    const tm = time.match(/^(\d{2}):?(\d{2}):?(\d{2})/);
    if (tm) t = `${tm[1]}:${tm[2]}:${tm[3]}`;
  }
  return `${m[1]}-${m[2]}-${m[3]}T${t}`;
}

/** A JS Date as local wall-clock time of the machine running the pipeline (used for mtime). */
export function dateToLocal(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** A date written by a person in a sidecar: `2005-02-27`, `2005-02-27 18:16`, ISO, or a YAML Date. */
export function parseUserDate(raw: unknown): string | undefined {
  if (raw instanceof Date) {
    // YAML parses `2005-02-27` as midnight UTC; keep the date the person wrote.
    return isNaN(raw.getTime()) ? undefined : raw.toISOString().slice(0, 19);
  }
  if (typeof raw !== 'string') return undefined;
  return parseIsoLikeDate(raw.trim().replace(' ', 'T')) ?? parseExifDate(raw);
}

const BRANDS: Record<string, string> = {
  nikon: 'Nikon',
  canon: 'Canon',
  fujifilm: 'Fujifilm',
  fuji: 'Fujifilm',
  olympus: 'Olympus',
  'om digital': 'OM System',
  sony: 'Sony',
  panasonic: 'Panasonic',
  leica: 'Leica',
  pentax: 'Pentax',
  ricoh: 'Ricoh',
  samsung: 'Samsung',
  apple: 'Apple',
  hasselblad: 'Hasselblad',
  sigma: 'Sigma',
  google: 'Google',
  kodak: 'Kodak',
  minolta: 'Minolta',
  'konica minolta': 'Konica Minolta',
  sanyo: 'Sanyo',
  casio: 'Casio',
};

/** `NIKON CORPORATION` + `NIKON D70` gives `Nikon D70`. */
export function normalizeCamera(
  make: unknown,
  model: unknown
): string | undefined {
  const mk = typeof make === 'string' ? make.replace(/\s+/g, ' ').trim() : '';
  let md = typeof model === 'string' ? model.replace(/\s+/g, ' ').trim() : '';
  if (!mk && !md) return undefined;
  const mkClean = mk
    .replace(
      /\b(corporation|corp\.?|co\.?,? ?ltd\.?|company|inc\.?|optical|imaging|camera|digital solutions)\b/gi,
      ''
    )
    .replace(/[ ,.]+$/, '')
    .trim();
  const key = mkClean.toLowerCase();
  const brand =
    BRANDS[key] ??
    Object.entries(BRANDS).find(
      ([k]) => key.startsWith(k) || md.toLowerCase().startsWith(k)
    )?.[1] ??
    (mkClean
      ? mkClean.charAt(0).toUpperCase() + mkClean.slice(1).toLowerCase()
      : '');
  if (brand && md.toLowerCase().startsWith(brand.toLowerCase())) {
    md = md.slice(brand.length).trim();
  }
  return [brand, md].filter(Boolean).join(' ') || undefined;
}

/** Exposure time in seconds to `1/60` or `2.5`. */
export function formatShutter(t: unknown): string | undefined {
  const s = parseShutter(t);
  if (s === undefined) return undefined;
  if (s >= 1) return String(Math.round(s * 10) / 10);
  return `1/${Math.round(1 / s)}`;
}

/** Exposure time as seconds, from a number or a `1/60` string. */
export function parseShutter(t: unknown): number | undefined {
  if (typeof t === 'string') {
    const m = t.trim().match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/);
    if (m) t = Number(m[1]) / Number(m[2]);
    else t = Number(t);
  }
  return typeof t === 'number' && Number.isFinite(t) && t > 0 ? t : undefined;
}

export function flashFired(raw: unknown): boolean | undefined {
  if (typeof raw === 'number') return (raw & 1) === 1;
  if (typeof raw !== 'string') return undefined;
  if (/did not fire|no flash|^off/i.test(raw)) return false;
  if (/fired|^on/i.test(raw)) return true;
  return undefined;
}

export function toNumber(v: unknown): number | undefined {
  if (Array.isArray(v)) return toNumber(v[0]);
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)))
    return Number(v);
  return undefined;
}

export function toKeywords(v: unknown): string[] {
  const list = Array.isArray(v)
    ? v
    : typeof v === 'string'
      ? v.split(/[,;]/)
      : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const k of list) {
    const s = String(k).trim();
    if (s && !seen.has(s.toLowerCase())) {
      seen.add(s.toLowerCase());
      out.push(s);
    }
  }
  return out;
}

/** XMP GPS coordinates: `40,44.123N` or `40,44,7N`. */
export function parseXmpGps(raw: string): number | undefined {
  const m = raw
    .trim()
    .match(/^(\d+),(\d+(?:\.\d+)?)(?:,(\d+(?:\.\d+)?))?([NSEW])$/i);
  if (!m) return toNumber(raw);
  const v = Number(m[1]) + Number(m[2]) / 60 + (m[3] ? Number(m[3]) / 3600 : 0);
  return /[SW]/i.test(m[4]) ? -v : v;
}

/** Lens description from EXIF LensInfo `[18, 70, 3.5, 4.5]`. */
export function lensFromInfo(info: unknown): string | undefined {
  if (!Array.isArray(info) || info.length < 4) return undefined;
  const [a, b, fa, fb] = info.map(Number);
  if (!(a > 0)) return undefined;
  const focal = a === b ? `${a}mm` : `${a}-${b}mm`;
  const f =
    fa > 0 ? (fa === fb || !(fb > 0) ? ` f/${fa}` : ` f/${fa}-${fb}`) : '';
  return focal + f;
}
