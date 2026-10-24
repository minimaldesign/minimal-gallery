/**
 * The photo inspector’s writer: `<name>.md` next to the photo holds only the
 * fields the owner overrode. The photo itself is never opened for writing.
 */
import { parseUserDate } from '@minimalgallery/pipeline';
import { badRequest, onlyKeys } from './http.ts';
import {
  bodyOf,
  readMarkdown,
  setValue,
  writeMarkdown,
} from './frontmatter.ts';

const TEXT_KEYS = ['title', 'copyright', 'author'] as const;
const PLACE_KEYS = ['city', 'state', 'country', 'location'] as const;
export const OVERRIDE_KEYS = [
  ...TEXT_KEYS,
  'caption',
  'date',
  'keywords',
  'place',
  'hidden',
] as const;

/** A validated patch: each key present is a value to write, or null to remove. */
export type OverridesPatch = Partial<Record<string, unknown>>;

const text = (key: string, v: unknown): string | null => {
  if (v === null) return null;
  if (typeof v !== 'string')
    throw badRequest(`${key} must be a string or null.`);
  return v.trim() ? v.trim() : null;
};

/** Check a `PUT /photos/:id/overrides` body. Throws 400 with the bad key. */
export function validateOverrides(
  body: Record<string, unknown>
): OverridesPatch {
  onlyKeys(body, OVERRIDE_KEYS);
  const out: OverridesPatch = {};
  for (const key of TEXT_KEYS) if (key in body) out[key] = text(key, body[key]);
  if ('caption' in body) {
    const v = body.caption;
    if (v !== null && typeof v !== 'string')
      throw badRequest('caption must be a string or null.');
    out.caption = v && v.trim() ? v.trim() : null;
  }
  if ('date' in body) {
    const v = text('date', body.date);
    if (
      v !== null &&
      (!/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?)?$/.test(v) ||
        !parseUserDate(v))
    )
      throw badRequest(
        'date must look like 2005-02-27, 2005-02-27T18:16 or 2005-02-27T18:16:10.'
      );
    out.date = v?.replace(' ', 'T') ?? null;
  }
  if ('keywords' in body) {
    const v = body.keywords;
    if (v === null) out.keywords = null;
    else if (Array.isArray(v) && v.every((k) => typeof k === 'string')) {
      const list = [...new Set(v.map((k) => k.trim()).filter(Boolean))];
      out.keywords = list.length ? list : null;
    } else throw badRequest('keywords must be an array of strings or null.');
  }
  if ('hidden' in body) {
    const v = body.hidden;
    if (v !== null && typeof v !== 'boolean')
      throw badRequest('hidden must be true, false or null.');
    out.hidden = v;
  }
  if ('place' in body) {
    const v = body.place;
    if (v === null) out.place = null;
    else if (v && typeof v === 'object' && !Array.isArray(v)) {
      const place = v as Record<string, unknown>;
      const extra = Object.keys(place).filter(
        (k) => !(PLACE_KEYS as readonly string[]).includes(k)
      );
      if (extra.length)
        throw badRequest(`place has unknown keys: ${extra.join(', ')}.`);
      const sub: Record<string, string | null> = {};
      for (const k of PLACE_KEYS)
        if (k in place) sub[k] = text(`place.${k}`, place[k]);
      out.place = sub;
    } else throw badRequest('place must be an object or null.');
  }
  return out;
}

/**
 * Apply a patch to `<absNoExt>.md`. Keys the admin does not manage, and
 * comments, are kept. Returns whether the file exists afterwards.
 */
export async function writeOverrides(
  absNoExt: string,
  patch: OverridesPatch
): Promise<boolean> {
  const file = await readMarkdown(`${absNoExt}.md`);
  for (const [key, value] of Object.entries(patch)) {
    if (key === 'caption') {
      file.body = bodyOf(value as string | null);
      // A caption written in the frontmatter would win over nothing; keep one place.
      setValue(file.doc, ['caption'], null);
    } else if (key === 'place') {
      if (value === null) setValue(file.doc, ['place'], null);
      else
        for (const [sub, v] of Object.entries(value as Record<string, unknown>))
          setValue(file.doc, ['place', sub], v);
    } else setValue(file.doc, [key], value);
  }
  return writeMarkdown(file);
}
