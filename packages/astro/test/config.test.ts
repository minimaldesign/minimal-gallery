import { describe, expect, it } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inlineLogo, resolveConfig } from '../src/config.ts';

const EXPORTED = `<?xml version="1.0" encoding="UTF-8" standalone="no"?><!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd"><svg width="100%" height="100%" viewBox="0 0 10 10" xmlns="http://www.w3.org/2000/svg"><!-- mark --><path d="M0 0h10v10z"/></svg>`;

describe('logo', () => {
  it('inlines an exported SVG as a decorative mark sized by CSS', () => {
    expect(inlineLogo(EXPORTED, 'logo.svg')).toBe(
      '<svg class="logo_mark" aria-hidden="true" focusable="false" viewBox="0 0 10 10" xmlns="http://www.w3.org/2000/svg"><path d="M0 0h10v10z"/></svg>'
    );
  });

  it('refuses a file that is not an SVG', () => {
    expect(() => inlineLogo('<html></html>', 'logo.svg')).toThrow(/not an SVG/);
  });

  it('reads the file the config names, relative to the gallery', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mg-logo-'));
    await writeFile(join(dir, 'logo.svg'), EXPORTED);
    const config = await resolveConfig(dir, { logo: './logo.svg' });
    expect(config.logo?.file).toBe(join(dir, 'logo.svg'));
    expect(config.logo?.svg).toMatch(/^<svg class="logo_mark"/);
    expect((await resolveConfig(dir)).logo).toBeNull();
    await expect(resolveConfig(dir, { logo: './gone.svg' })).rejects.toThrow(
      /cannot read/
    );
  });
});
