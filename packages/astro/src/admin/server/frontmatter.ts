/**
 * Edit a markdown file with YAML frontmatter (`<name>.md`, `_album.md`) in
 * place: keys and comments the admin does not manage are kept as written.
 *
 * The pipeline reads these files with gray-matter (js-yaml, YAML 1.1 rules).
 * New values are written under YAML 1.1 too, so a string that 1.1 would read
 * as something else (`yes`, `12:30`, a date) is quoted.
 */
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { isMap, parseDocument, type Document } from 'yaml';

export interface MarkdownFile {
  path: string;
  exists: boolean;
  doc: Document;
  /** Everything after the closing `---`, as written. */
  body: string;
}

const OPEN = /^---[ \t]*\r?\n/;
const CLOSE = /^---[ \t]*(\r?\n|$)/m;

export async function readMarkdown(path: string): Promise<MarkdownFile> {
  let text: string | undefined;
  try {
    text = await readFile(path, 'utf8');
  } catch (e: any) {
    if (e?.code !== 'ENOENT') throw e;
  }
  if (text === undefined)
    return { path, exists: false, doc: newDoc(''), body: '' };
  const open = OPEN.exec(text);
  if (!open) return { path, exists: true, doc: newDoc(''), body: text };
  const rest = text.slice(open[0].length);
  const close = CLOSE.exec(rest);
  if (!close)
    // No closing line: gray-matter reads the whole file as frontmatter.
    return { path, exists: true, doc: newDoc(rest), body: '' };
  return {
    path,
    exists: true,
    doc: newDoc(rest.slice(0, close.index)),
    body: rest.slice(close.index + close[0].length),
  };
}

function newDoc(source: string): Document {
  const doc: Document = parseDocument(source, { version: '1.1' });
  if (doc.errors.length)
    throw new Error(`cannot read the frontmatter: ${doc.errors[0].message}`);
  // An empty document has no map yet; one made by `setIn` would print as `!!omap`.
  if (doc.contents == null) doc.contents = doc.createNode({});
  if (!isMap(doc.contents))
    throw new Error('the frontmatter is not a list of keys');
  return doc;
}

/** Set a key, or remove it when `value` is null. Nested paths for maps (`['place', 'city']`). */
export function setValue(doc: Document, path: string[], value: unknown): void {
  if (value === null || value === undefined) {
    if (doc.hasIn(path)) doc.deleteIn(path);
    // Drop a map left empty by the removal (`place:` with no fields).
    for (let n = path.length - 1; n > 0; n--) {
      const parent = doc.getIn(path.slice(0, n), true);
      if (isMap(parent) && parent.items.length === 0)
        doc.deleteIn(path.slice(0, n));
    }
    return;
  }
  for (let n = 1; n < path.length; n++)
    if (!isMap(doc.getIn(path.slice(0, n), true)))
      doc.setIn(path.slice(0, n), doc.createNode({}));
  doc.setIn(path, value);
}

export function getValue(doc: Document, path: string[]): unknown {
  const v = doc.getIn(path);
  return v && typeof v === 'object' && 'toJSON' in (v as object)
    ? (v as { toJSON(): unknown }).toJSON()
    : v;
}

/** The frontmatter as plain values. */
export function toPlain(doc: Document): Record<string, unknown> {
  const v = doc.toJS();
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
}

export function isEmpty(file: MarkdownFile): boolean {
  return Object.keys(toPlain(file.doc)).length === 0 && !file.body.trim();
}

/** The markdown body for a caption or description: a blank line after the frontmatter. */
export const bodyOf = (text: string | null) =>
  text && text.trim() ? `\n${text.trim()}\n` : '';

/**
 * Write the file, or delete it when nothing is left. Returns false when the
 * file was deleted (or never existed).
 */
export async function writeMarkdown(file: MarkdownFile): Promise<boolean> {
  if (isEmpty(file)) {
    if (file.exists) await rm(file.path, { force: true });
    return false;
  }
  const keys = Object.keys(toPlain(file.doc)).length > 0;
  const yaml = keys ? file.doc.toString({ lineWidth: 0 }) : '';
  const text = keys
    ? `---\n${yaml}---\n${file.body}`
    : file.body.replace(/^\n+/, '');
  const tmp = `${file.path}.${process.pid}.tmp`;
  await writeFile(tmp, text);
  await rename(tmp, file.path);
  return true;
}
