import { XMLParser } from 'fast-xml-parser';
import type { Layer } from './layers.ts';
import {
  parseExifDate,
  parseIsoLikeDate,
  parseXmpGps,
  toKeywords,
} from './normalize.ts';

/** Canonical prefixes by namespace URI. Files use other prefixes (for example `xap:` for `xmp:`). */
const NAMESPACES: Record<string, string> = {
  'http://purl.org/dc/elements/1.1/': 'dc',
  'http://ns.adobe.com/xap/1.0/': 'xmp',
  'http://ns.adobe.com/photoshop/1.0/': 'photoshop',
  'http://ns.adobe.com/exif/1.0/': 'exif',
  'http://ns.adobe.com/tiff/1.0/': 'tiff',
  'http://ns.adobe.com/exif/1.0/aux/': 'aux',
  'http://iptc.org/std/Iptc4xmpCore/1.0/xmlns/': 'Iptc4xmpCore',
  'http://cipa.jp/exif/1.0/': 'exifEX',
  'http://ns.adobe.com/xap/1.0/rights/': 'xmpRights',
};

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: false,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  processEntities: true,
});

type Node = Record<string, unknown>;

/** Text of an XMP value: a plain string, an rdf:Alt (x-default first), or the first item of an rdf:Seq/Bag. */
function text(value: unknown): string | undefined {
  const list = items(value);
  if (list === undefined) return undefined;
  const first = list[0];
  return first && first.trim() !== '' ? first.trim() : undefined;
}

/** Items of an XMP value, as strings. */
function items(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string' || typeof value === 'number')
    return [String(value)];
  if (Array.isArray(value)) return value.flatMap((v) => items(v) ?? []);
  if (typeof value === 'object') {
    const node = value as Node;
    if ('#text' in node) return [String(node['#text'])];
    for (const container of ['rdf:Alt', 'rdf:Seq', 'rdf:Bag']) {
      if (container in node) {
        const li = (node[container] as Node)?.['rdf:li'];
        const list = Array.isArray(li) ? li : li === undefined ? [] : [li];
        if (container === 'rdf:Alt') {
          list.sort(
            (a, b) => (isDefaultLang(b) ? 1 : 0) - (isDefaultLang(a) ? 1 : 0)
          );
        }
        return list.flatMap((v) => items(v) ?? []);
      }
    }
  }
  return undefined;
}

function isDefaultLang(li: unknown): boolean {
  return (
    typeof li === 'object' &&
    li !== null &&
    (li as Node)['@_xml:lang'] === 'x-default'
  );
}

/** Flatten every rdf:Description into one map of `canonicalPrefix:Name` to raw value. */
export function readXmpProperties(xml: string): Map<string, unknown> {
  const out = new Map<string, unknown>();
  let doc: unknown;
  try {
    doc = parser.parse(xml);
  } catch {
    return out;
  }
  const visit = (node: unknown, inherited: Record<string, string>) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const n of node) visit(n, inherited);
      return;
    }
    const obj = node as Node;
    const ns = { ...inherited };
    for (const [k, v] of Object.entries(obj)) {
      if (k.startsWith('@_xmlns:')) ns[k.slice(8)] = String(v);
    }
    const canonical = (qname: string): string | undefined => {
      const [prefix, local] = qname.split(':');
      if (!local) return undefined;
      const uri = ns[prefix];
      const canon = uri ? NAMESPACES[uri] : undefined;
      return canon ? `${canon}:${local}` : undefined;
    };
    for (const [k, v] of Object.entries(obj)) {
      if (k === 'rdf:Description') {
        visit(v, ns);
        continue;
      }
      if (k.startsWith('@_')) {
        const key = canonical(k.slice(2));
        if (key && !k.startsWith('@_xmlns:') && !out.has(key)) out.set(key, v);
        continue;
      }
      const key = canonical(k);
      if (key && !out.has(key)) out.set(key, v);
      if (!key || k.startsWith('rdf:') || k.startsWith('x:')) visit(v, ns);
    }
  };
  visit(doc, {});
  return out;
}

/** Read an XMP packet (embedded or `.xmp` sidecar) into a metadata layer. */
export function xmpToLayer(xml: string): Layer {
  const p = readXmpProperties(xml);
  const get = (k: string) => text(p.get(k));
  const layer: Layer = {};
  const title = get('dc:title');
  if (title) layer.title = title;
  const caption = get('dc:description');
  if (caption) layer.caption = caption;
  const subject = items(p.get('dc:subject'));
  if (subject?.length) layer.keywords = toKeywords(subject);
  const creator = get('dc:creator');
  if (creator) layer.author = creator;
  const rights = get('dc:rights');
  if (rights) layer.copyright = rights;
  const city = get('photoshop:City');
  const state = get('photoshop:State');
  const country = get('photoshop:Country');
  const location = get('Iptc4xmpCore:Location');
  if (city || state || country || location) {
    layer.place = { city, state, country, location };
  }
  const date =
    get('exif:DateTimeOriginal') ??
    get('photoshop:DateCreated') ??
    get('xmp:CreateDate');
  // The offset in an XMP date is the editing computer’s, so only the
  // wall-clock part is kept.
  const parsed = date
    ? (parseIsoLikeDate(date) ?? parseExifDate(date))
    : undefined;
  // A date-only value (no time) is too coarse to override a camera timestamp.
  if (parsed && date && /T\d/.test(date)) layer.date = parsed;
  const lens = get('aux:Lens') ?? get('exifEX:LensModel');
  if (lens) layer.lens = lens;
  const lat = get('exif:GPSLatitude');
  const lon = get('exif:GPSLongitude');
  if (lat && lon) {
    const la = parseXmpGps(lat);
    const lo = parseXmpGps(lon);
    if (la !== undefined && lo !== undefined) layer.gps = { lat: la, lon: lo };
  }
  return layer;
}
