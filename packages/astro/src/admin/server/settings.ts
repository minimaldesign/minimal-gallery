/**
 * The settings page: keys of `minimalgallery.config.ts` edited in place with
 * magicast (comments and keys the admin does not manage stay as written),
 * `about.md` and `custom.css` at the gallery root.
 */
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  findConfigFile,
  GalleryConfigSchema,
  loadConfig,
  type GalleryConfig,
} from '@minimalgallery/pipeline/config';
import { generateCode, parseModule } from 'magicast';
import { getDefaultExportOptions } from 'magicast/helpers';
import { badRequest, HttpError, onlyKeys } from './http.ts';

export interface Settings {
  name: string;
  description: string | null;
  author: string | null;
  site: string | null;
  albumsSort: GalleryConfig['albums']['sort'];
  defaults: GalleryConfig['defaults'];
  about: string;
  customCss: string;
}

const SETTINGS_KEYS = [
  'name',
  'description',
  'author',
  'site',
  'albumsSort',
  'defaults',
  'about',
  'customCss',
] as const;
const DEFAULT_KEYS = ['fit', 'strip', 'crop', 'view', 'size', 'backdrop'];

const NEW_CONFIG = `import { defineConfig } from '@minimalgallery/pipeline/config';

export default defineConfig({});
`;

async function readText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch (e: any) {
    if (e?.code === 'ENOENT') return undefined;
    throw e;
  }
}

async function writeAtomic(path: string, text: string) {
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, text);
  await rename(tmp, path);
}

export async function readSettings(galleryDir: string): Promise<Settings> {
  const [config, about, customCss] = await Promise.all([
    loadConfig(galleryDir),
    readText(join(galleryDir, 'about.md')),
    readText(join(galleryDir, 'custom.css')),
  ]);
  return {
    name: config.name,
    description: config.description ?? null,
    author: config.author ?? null,
    site: config.site ?? null,
    albumsSort: config.albums.sort,
    defaults: config.defaults,
    about: about ?? '',
    customCss: customCss ?? '',
  };
}

/** One edit of the config: a key path and its new value, or null to remove it. */
type ConfigEdit = [path: string[], value: unknown];

function configEdits(body: Record<string, unknown>): ConfigEdit[] {
  const edits: ConfigEdit[] = [];
  if ('name' in body) {
    const v = body.name;
    if (v !== null && (typeof v !== 'string' || !v.trim()))
      throw badRequest('name must be a non-empty string, or null.');
    edits.push([['name'], v === null ? null : (v as string).trim()]);
  }
  for (const key of ['description', 'author', 'site'] as const)
    if (key in body) {
      const v = body[key];
      if (v !== null && typeof v !== 'string')
        throw badRequest(`${key} must be a string or null.`);
      edits.push([[key], v && v.trim() ? v.trim() : null]);
    }
  if ('albumsSort' in body) edits.push([['albums', 'sort'], body.albumsSort]);
  if ('defaults' in body) {
    const d = body.defaults;
    if (!d || typeof d !== 'object' || Array.isArray(d))
      throw badRequest('defaults must be an object.');
    const extra = Object.keys(d).filter((k) => !DEFAULT_KEYS.includes(k));
    if (extra.length)
      throw badRequest(`defaults has unknown keys: ${extra.join(', ')}.`);
    for (const [k, v] of Object.entries(d)) edits.push([['defaults', k], v]);
  }
  // Validate the values with the pipeline’s own schema before touching the file.
  const candidate: Record<string, any> = {};
  for (const [path, value] of edits) {
    if (value === null) continue;
    if (path.length === 1) candidate[path[0]] = value;
    else (candidate[path[0]] ??= {})[path[1]] = value;
  }
  const parsed = GalleryConfigSchema.safeParse(candidate);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const key = issue.path.join('.').replace(/^albums\.sort$/, 'albumsSort');
    throw badRequest(`${key || 'config'}: ${issue.message}`);
  }
  return edits;
}

/** Apply edits to the config source. Exported for tests. */
export function editConfigSource(source: string, edits: ConfigEdit[]): string {
  let mod;
  let options: Record<string, any>;
  try {
    mod = parseModule(source);
    options = getDefaultExportOptions(mod);
    if (!options || typeof options !== 'object') throw new Error('no object');
  } catch {
    throw new HttpError(
      409,
      'The config file cannot be edited here: it must export defineConfig({ ... }) or an object literal.'
    );
  }
  for (const [path, value] of edits) {
    if (path.length === 1) {
      if (value === null) delete options[path[0]];
      else options[path[0]] = value;
      continue;
    }
    const [group, key] = path;
    const parent = options[group];
    if (value === null) {
      if (parent && typeof parent === 'object') {
        delete parent[key];
        if (Object.keys(parent).length === 0) delete options[group];
      }
      continue;
    }
    if (!parent || typeof parent !== 'object') options[group] = {};
    options[group][key] = value;
  }
  return generateCode(mod).code.replace(/\s*$/, '\n');
}

export interface SettingsChange {
  settings: Settings;
  configChanged: boolean;
  sortChanged: boolean;
  /** `custom.css` did not exist before this edit. */
  cssCreated: boolean;
}

export async function writeSettings(
  galleryDir: string,
  body: Record<string, unknown>
): Promise<SettingsChange> {
  onlyKeys(body, SETTINGS_KEYS);
  for (const key of ['about', 'customCss'] as const)
    if (key in body && body[key] !== null && typeof body[key] !== 'string')
      throw badRequest(`${key} must be a string or null.`);
  const edits = configEdits(body);

  let configChanged = false;
  const before = await loadConfig(galleryDir);
  if (edits.length) {
    const existing = await findConfigFile(galleryDir);
    const path = existing ?? join(galleryDir, 'minimalgallery.config.ts');
    const source = existing ? await readFile(existing, 'utf8') : NEW_CONFIG;
    const next = editConfigSource(source, edits);
    if (next !== source || !existing) {
      await writeAtomic(path, next);
      try {
        await loadConfig(galleryDir);
      } catch (e) {
        // Put the file back as it was: the dev server must keep a config it can read.
        if (existing) await writeAtomic(path, source);
        else await rm(path, { force: true });
        throw badRequest((e as Error).message);
      }
      configChanged = true;
    }
  }

  if ('about' in body) {
    const about = join(galleryDir, 'about.md');
    const text = (body.about as string | null) ?? '';
    if (text.trim())
      await writeAtomic(about, text.endsWith('\n') ? text : `${text}\n`);
    else await rm(about, { force: true });
  }

  let cssCreated = false;
  if ('customCss' in body) {
    const css = join(galleryDir, 'custom.css');
    cssCreated = (await readText(css)) === undefined;
    await writeAtomic(css, (body.customCss as string | null) ?? '');
  }

  const settings = await readSettings(galleryDir);
  return {
    settings,
    configChanged,
    sortChanged: settings.albumsSort !== before.albums.sort,
    cssCreated,
  };
}
