import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Loader } from 'astro/loaders';

/**
 * The four published packages share one version number (a fixed group in
 * .changeset/config.json). Changesets writes one CHANGELOG.md per package;
 * the version history shows them merged, one entry per version.
 */
export const PACKAGES = [
  { name: 'create-minimalgallery', dir: 'create', label: 'Scaffold' },
  { name: 'minimalgallery', dir: 'cli', label: 'Command line' },
  {
    name: '@minimalgallery/astro',
    dir: 'astro',
    label: 'Astro integration and theme',
  },
  {
    name: '@minimalgallery/pipeline',
    dir: 'pipeline',
    label: 'Photo pipeline',
  },
];

export interface PackageChanges {
  name: string;
  label: string;
  /** `### Minor Changes` and the like, with their list items. */
  sections: Array<{ type: string; items: string[] }>;
}

export interface Version {
  version: string;
  packages: PackageChanges[];
}

/**
 * Split one CHANGELOG.md into versions. Drops the commit hash changesets
 * puts before each summary and the “Updated dependencies” items, which
 * say nothing in a fixed group where every package moves together.
 */
export function parseChangelog(markdown: string) {
  const versions = new Map<string, Array<{ type: string; items: string[] }>>();
  let sections: Array<{ type: string; items: string[] }> | undefined;
  let items: string[] | undefined;
  for (const line of markdown.split('\n')) {
    const version = line.match(/^## (\S+)/)?.[1];
    const type = line.match(/^### (.+)/)?.[1];
    if (version) {
      sections = [];
      items = undefined;
      versions.set(version, sections);
    } else if (type && sections) {
      items = [];
      sections.push({ type: type.trim(), items });
    } else if (items && line.startsWith('- ')) {
      items.push(line.slice(2).replace(/^[0-9a-f]{7,40}: /, ''));
    } else if (items?.length && /^\s+\S/.test(line)) {
      // a continuation of the last item (a wrapped line or a nested list)
      items[items.length - 1] += '\n' + line;
    }
  }
  for (const sections of versions.values())
    for (const section of sections)
      section.items = section.items.filter(
        (item) => !item.startsWith('Updated dependencies')
      );
  return versions;
}

/** Newest first; a prerelease sorts below its release. */
export function compareVersions(a: string, b: string) {
  const parse = (v: string) => {
    const [core, pre] = v.split('-', 2);
    return { nums: core.split('.').map(Number), pre };
  };
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < 3; i++)
    if (x.nums[i] !== y.nums[i]) return (y.nums[i] ?? 0) - (x.nums[i] ?? 0);
  if (x.pre === y.pre) return 0;
  if (!x.pre) return -1;
  if (!y.pre) return 1;
  return y.pre.localeCompare(x.pre, 'en', { numeric: true });
}

/** Every package’s changelog, merged by version, newest first. */
export function readVersions(packagesDir: URL): Version[] {
  const merged = new Map<string, PackageChanges[]>();
  for (const pkg of PACKAGES) {
    const file = new URL(`${pkg.dir}/CHANGELOG.md`, packagesDir);
    if (!existsSync(file)) continue;
    for (const [version, sections] of parseChangelog(
      readFileSync(file, 'utf8')
    )) {
      const kept = sections.filter((s) => s.items.length);
      const list = merged.get(version) ?? [];
      if (kept.length)
        list.push({ name: pkg.name, label: pkg.label, sections: kept });
      merged.set(version, list);
    }
  }
  return [...merged]
    .map(([version, packages]) => ({ version, packages }))
    .sort((a, b) => compareVersions(a.version, b.version));
}

/** The markdown of one version: a heading per package with changes. */
export function versionMarkdown({ packages }: Version) {
  if (!packages.length)
    return 'Version bump only: no package has changes of its own.';
  return packages
    .map((pkg) =>
      [
        `### ${pkg.label}`,
        '',
        `\`${pkg.name}\``,
        '',
        ...pkg.sections.flatMap((s) => [
          `#### ${s.type.replace(/ Changes$/, ' changes')}`,
          '',
          ...s.items.map((item) => `- ${item}`),
          '',
        ]),
      ].join('\n')
    )
    .join('\n');
}

/**
 * A content loader over the packages’ changelogs: one entry per version,
 * with its changes rendered as Markdown. In dev the changelogs are watched,
 * so `pnpm changeset version` shows up without a restart.
 */
export function changelogLoader(packagesDir: URL): Loader {
  return {
    name: 'minimalgallery-changelog',
    load: async ({ store, renderMarkdown, watcher, logger }) => {
      const sync = async () => {
        const versions = readVersions(packagesDir);
        store.clear();
        for (const [order, version] of versions.entries())
          store.set({
            id: version.version,
            data: { version: version.version, order },
            rendered: await renderMarkdown(versionMarkdown(version)),
          });
        logger.info(`${versions.length} version(s) in the changelogs`);
      };
      await sync();
      for (const pkg of PACKAGES)
        watcher?.add(
          fileURLToPath(new URL(`${pkg.dir}/CHANGELOG.md`, packagesDir))
        );
      watcher?.on('all', (_, path) => {
        if (path.endsWith('CHANGELOG.md')) void sync();
      });
    },
  };
}
