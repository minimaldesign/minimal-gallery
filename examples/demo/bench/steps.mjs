#!/usr/bin/env node
// Viewer step benchmark, the regression check for stepping between photos.
//
// For each engine (Chromium, WebKit, Firefox) and each scenario (a photo in
// the middle of a 70-photo album, home with all 241 photos, a photo page in
// `?in=grid`), it opens the page, lets it settle, then steps with ArrowRight
// five times and with a click on the photo five times. It runs that twice
// in one browser context: a cold pass, then a warm pass over the same pages.
//
// Per step, from the key or click (a capture-phase timestamp the old page
// writes to sessionStorage) to, on the new page:
//   dcl    its DOMContentLoaded
//   hero   the hero <img> complete and decoded
//   paint  its first paint (first-contentful-paint, else the first frame)
//   shown  the hero on screen: the later of hero and paint
// For a prerendered page every time is at least its activation.
// Also: whether a view transition ran (pagereveal's viewTransition where the
// event exists, else the ::view-transition animations on the first frame),
// what the old strip snapshot did (fade = the flicker, hidden = none),
// navigation.activation, console errors, and bytes on the wire per step
// (Resource Timing transferSize on the new page, so cache hits count 0).
//
// Usage (against `astro preview` of the built demo, or any server):
//   node bench/steps.mjs [--url http://localhost:4421] [--engines webkit]
//     [--scenarios album,home,grid] [--strip on|off] [--out results.json]
//     [--blur on|off] [--verbose]
// With `--latency <ms> --dist <dir>` it puts a proxy in front of --url that
// delays every response by that much and sets Cache-Control the way the
// host does: the rules in <dir>/_headers, else max-age=0, must-revalidate.

import { chromium, firefox, webkit } from 'playwright';
import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

const { values: opt } = parseArgs({
  options: {
    url: { type: 'string', default: 'http://localhost:4421' },
    engines: { type: 'string', default: 'chromium,webkit,firefox' },
    scenarios: { type: 'string', default: 'album,home,grid' },
    strip: { type: 'string', default: 'on' },
    blur: { type: 'string', default: 'on' },
    steps: { type: 'string', default: '5' },
    out: { type: 'string' },
    verbose: { type: 'boolean', default: false },
    headed: { type: 'boolean', default: false },
    latency: { type: 'string' },
    dist: { type: 'string' },
    port: { type: 'string', default: '4429' },
  },
});

const ENGINES = { chromium, webkit, firefox };
const SCENARIOS = {
  album: '/feelings/oppressive_cuteness/',
  home: '/',
  grid: '/feelings/down_the_drain/?in=grid',
};
const STEPS = +opt.steps;

// Runs in every document before its own scripts.
function probe([strip, blur]) {
  const now = () => performance.timeOrigin + performance.now();
  const B = (window.__bench = { at: now() });
  const nav = performance.getEntriesByType('navigation')[0];
  B.prerendered = !!(document.prerendering || nav?.activationStart > 0);
  if (strip) localStorage['mg-strip'] = strip;
  if (blur === 'off')
    document.addEventListener('DOMContentLoaded', () =>
      document.head.append(
        Object.assign(document.createElement('style'), {
          textContent: '.surface { backdrop-filter: none !important; }',
        })
      )
    );

  const mark = (e) => (sessionStorage.benchT0 = now());
  addEventListener(
    'keydown',
    (e) => /^Arrow(Left|Right)$/.test(e.key) && mark(),
    true
  );
  addEventListener('click', mark, true);

  document.addEventListener('DOMContentLoaded', () => (B.dcl = now()));
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries())
        B[e.name] ??= performance.timeOrigin + e.startTime;
    }).observe({ type: 'paint', buffered: true });
  } catch {}

  // the view transition, by the event where it exists and by its
  // animations on the first frames everywhere
  B.revealEvent = 'onpagereveal' in window;
  const snap = () => {
    const anims = document
      .getAnimations()
      .filter((a) => a.effect?.pseudoElement?.startsWith('::view-transition'));
    if (!anims.length) return;
    B.vtAnims ??= anims.map((a) => {
      const t = a.effect.getComputedTiming();
      return `${a.effect.pseudoElement} ${a.animationName || ''} ${Math.round(t.duration)}`;
    });
    const root = document.documentElement;
    const cs = (p) => {
      try {
        const s = getComputedStyle(root, p);
        return `${s.animationName}/${s.opacity}`;
      } catch {
        return '';
      }
    };
    B.stripOldStyle ??= cs('::view-transition-old(strip)');
  };
  addEventListener('pagereveal', (e) => {
    const t = e.viewTransition;
    B.reveal = now();
    B.vt = t ? 'yes' : 'no';
    if (!t) return;
    setTimeout(() => (B.types = [...(t.types ?? [])].join(' ')));
    t.ready.then(
      () => {
        B.vtReady = now();
        snap();
      },
      () => (B.vt = 'skipped')
    );
    t.finished.finally(() => (B.vtDone = now()));
    // frame intervals while the transition runs: long ones are jank
    const gaps = (B.gaps = []);
    let last;
    const tick = (ts) => {
      if (last) gaps.push(ts - last);
      last = ts;
      if (!B.vtDone) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  let frames = 0;
  const frame = () => {
    if (!B.frame) {
      B.frame = now();
      // frames on screen at the first frame: 0 with the strip on is a flash
      B.stripFrames = document.querySelectorAll('.strip_item').length;
    }
    snap();
    if (++frames < 4) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  const hero = () => {
    const img = document.querySelector('.stage_photo');
    if (!img) return;
    const done = () =>
      img
        .decode()
        .catch(() => (B.heroError = true))
        .finally(() => {
          B.hero = now();
          B.heroSrc = img.currentSrc.split('/').pop();
        });
    img.complete && img.naturalWidth
      ? done()
      : img.addEventListener('load', done, { once: true });
  };
  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', hero)
    : hero();

  addEventListener('load', () => (B.load = now()));
}

// What the new page measured, relative to the key or click.
async function collect(page) {
  return page.evaluate(() => {
    const B = window.__bench;
    const nav = performance.getEntriesByType('navigation')[0];
    const act = performance.timeOrigin + (nav?.activationStart || 0);
    const t0 = +sessionStorage.benchT0 || null;
    const rel = (t) => (t && t0 ? Math.round(Math.max(t, act) - t0) : null);
    const paint = B['first-contentful-paint'] ?? B['first-paint'] ?? B.frame;
    const a = globalThis.navigation?.activation;
    return {
      dcl: rel(B.dcl),
      hero: rel(B.hero),
      paint: rel(paint),
      shown: rel(Math.max(B.hero ?? 0, paint ?? 0)),
      vtEnd: rel(B.vtDone),
      vt: B.vt ?? (B.vtAnims ? 'yes' : B.revealEvent ? 'no' : 'none'),
      types: B.types ?? '',
      stripOld: !B.vtAnims
        ? ''
        : B.vtAnims.find((s) => s.startsWith('::view-transition-old(strip)'))
          ? 'fade'
          : B.vtAnims.some((s) => s.includes('(strip)'))
            ? 'hidden'
            : 'none',
      stripOldStyle: B.stripOldStyle ?? '',
      stripFrames: B.stripFrames,
      longFrames: B.gaps ? B.gaps.filter((g) => g > 25).length : null,
      worstFrame: B.gaps?.length ? Math.round(Math.max(...B.gaps)) : null,
      anims: B.vtAnims ?? [],
      activation: a ? `${a.navigationType}${a.from ? '' : ' (no from)'}` : '',
      prerendered: B.prerendered,
      heroSrc: B.heroSrc,
      heroError: !!B.heroError,
      url: location.pathname + location.search,
    };
  });
}

const median = (xs) => {
  const v = xs.filter((x) => x != null).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : Math.round((v[m - 1] + v[m]) / 2);
};
const max = (xs) => {
  const v = xs.filter((x) => x != null);
  return v.length ? Math.max(...v) : null;
};

// What the current page moved over the network: its document and every
// resource it loaded (cache hits are 0; a revalidation is its headers).
const weigh = (page) =>
  page.evaluate(() => {
    const e = [
      ...performance.getEntriesByType('navigation'),
      ...performance.getEntriesByType('resource'),
    ];
    const net = e.filter((x) => x.transferSize > 0);
    return {
      bytes: net.reduce((a, x) => a + x.transferSize, 0),
      requests: net.length,
      revalidated: net.filter((x) => x.encodedBodySize === 0).length,
      images: e.filter((x) => x.initiatorType === 'img').length,
      html: e[0]?.transferSize ?? 0,
      htmlSize: e[0]?.decodedBodySize ?? 0,
    };
  });

async function runScenario(browser, engine, name, url) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });
  await context.addInitScript(probe, [
    opt.strip === 'on' ? 'on' : 'off',
    opt.blur,
  ]);
  const page = await context.newPage();

  // in-flight requests (to let a page settle) and errors per step
  let current = null;
  let inflight = 0;
  let lastNet = Date.now();
  const errors = [];
  context.on('request', () => {
    inflight++;
    lastNet = Date.now();
  });
  const done = () => {
    inflight--;
    lastNet = Date.now();
  };
  context.on('requestfinished', done);
  context.on('requestfailed', done);
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push({ step: current, text: m.text() });
  });
  page.on('pageerror', (e) =>
    errors.push({ step: current, text: String(e.message ?? e) })
  );

  const quiet = async (ms = 400, cap = 6000) => {
    const t = Date.now();
    while (Date.now() - t < cap) {
      if (inflight <= 0 && Date.now() - lastNet > ms) return;
      await page.waitForTimeout(100);
    }
  };
  // the new page is done when the hero is decoded, it has painted and any
  // view transition has finished
  const arrived = async (target) => {
    const t = Date.now();
    while (Date.now() - t < 15000) {
      try {
        if (page.url() === target) {
          const ok = await page.evaluate(() => {
            const B = window.__bench;
            return !!(
              B?.hero &&
              B.frame &&
              B.dcl &&
              (B.vtDone || B.vt !== 'yes')
            );
          });
          if (ok) return true;
        }
      } catch {} // the context went away mid-navigation
      await page.waitForTimeout(25);
    }
    return false;
  };

  const rows = [];
  const opened = {};
  const open = async (pass) => {
    current = `${pass} open`;
    await page.goto(url + SCENARIOS[name], { waitUntil: 'load' });
    await arrived(page.url());
    await page.waitForTimeout(800);
    await quiet();
    opened[pass] = await weigh(page);
  };
  const step = async (pass, kind, i) => {
    const target = await page.$eval('.stage_next', (a) => a.href);
    if (!target) throw new Error(`no next on ${page.url()}`);
    current = `${pass} ${kind} ${i}`;
    await page.evaluate(() => delete sessionStorage.benchT0);
    if (kind === 'key') await page.keyboard.press('ArrowRight');
    else await page.mouse.click(1440 * 0.72, 900 * 0.5);
    const ok = await arrived(target);
    const r = ok ? await collect(page) : { timeout: true, url: target };
    await page.waitForTimeout(300);
    await quiet();
    const w = ok ? await weigh(page) : {};
    const errs = errors.filter((e) => e.step === current).length;
    rows.push({ pass, kind, i, ...r, ...w, errors: errs });
  };

  for (const pass of ['cold', 'warm']) {
    await open(pass);
    for (const kind of ['key', 'click'])
      for (let i = 1; i <= STEPS; i++) await step(pass, kind, i);
  }
  await context.close();
  return { engine, name, rows, opened, errors };
}

// PROXY: latency and the host's caching rules in front of --url
async function proxy() {
  const http = await import('node:http');
  const { readFileSync } = await import('node:fs');
  const rules = [];
  try {
    let cur;
    for (const line of readFileSync(`${opt.dist}/_headers`, 'utf8').split(
      '\n'
    )) {
      if (/^\s*#/.test(line) || !line.trim()) continue;
      if (!/^\s/.test(line)) rules.push((cur = { path: line.trim(), h: {} }));
      else {
        const [k, ...v] = line.trim().split(':');
        cur.h[k.toLowerCase()] = v.join(':').trim();
      }
    }
  } catch {}
  const match = (p, path) =>
    new RegExp(
      '^' + p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$'
    ).test(path);
  const up = new URL(opt.url);
  const server = http.createServer((req, res) => {
    setTimeout(() => {
      const f = http.request(
        {
          host: up.hostname,
          port: up.port,
          path: req.url,
          method: req.method,
          headers: { ...req.headers, host: up.host },
        },
        (r) => {
          const h = { ...r.headers };
          const path = req.url.split('?')[0];
          h['cache-control'] = 'public, max-age=0, must-revalidate';
          for (const rule of rules)
            if (match(rule.path, path)) Object.assign(h, rule.h);
          res.writeHead(r.statusCode, h);
          r.pipe(res);
        }
      );
      f.on('error', () => res.destroy());
      req.pipe(f);
    }, +opt.latency);
  });
  await new Promise((ok) => server.listen(+opt.port, ok));
  return server;
}

const server = opt.latency ? await proxy() : null;
const URL_ = server ? `http://localhost:${opt.port}` : opt.url;
const results = [];
for (const engine of opt.engines.split(',')) {
  const browser = await ENGINES[engine].launch({ headless: !opt.headed });
  const version = browser.version();
  for (const name of opt.scenarios.split(',')) {
    process.stderr.write(`${engine} ${version}: ${name}…\n`);
    try {
      results.push({
        version,
        ...(await runScenario(browser, engine, name, URL_)),
      });
    } catch (e) {
      process.stderr.write(`  failed: ${e.message}\n`);
      results.push({ engine, version, name, failed: e.message, rows: [] });
    }
  }
  await browser.close();
}
server?.close();

// TABLES: one per engine; medians (and max) per scenario and pass
const kb = (b) => (b / 1024).toFixed(1);
for (const engine of opt.engines.split(',')) {
  const rs = results.filter((r) => r.engine === engine);
  console.log(`\n## ${engine} ${rs[0]?.version ?? ''}\n`);
  console.log(
    '| scenario | pass | dcl | hero | paint | shown (max) | vt ran | old strip | strip at 1st frame | long frames in vt (worst ms) | activation | errors | KB/step (requests, 304s) | images | open HTML KB |'
  );
  console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of rs) {
    if (r.failed) {
      console.log(`| ${r.name} | failed: ${r.failed} |`);
      continue;
    }
    for (const pass of ['cold', 'warm']) {
      const s = r.rows.filter((x) => x.pass === pass);
      const ok = s.filter((x) => !x.timeout);
      const col = (k) => ok.map((x) => x[k]);
      const vt = ok.filter((x) => x.vt === 'yes').length;
      const strips = [...new Set(ok.map((x) => x.stripOld).filter(Boolean))];
      const acts = [...new Set(ok.map((x) => x.activation || 'none'))];
      const errs = s.reduce((a, x) => a + (x.errors || 0), 0);
      const timeouts = s.length - ok.length;
      console.log(
        `| ${r.name} | ${pass} | ${median(col('dcl'))} | ${median(col('hero'))} | ${median(col('paint'))} | ${median(col('shown'))} (${max(col('shown'))}) | ${vt}/${ok.length}${timeouts ? `, ${timeouts} timeouts` : ''} | ${strips.join(', ') || '-'} | ${opt.strip === 'on' ? `${ok.filter((x) => x.stripFrames > 0).length}/${ok.length}` : '-'} | ${median(col('longFrames')) ?? '-'} (${max(col('worstFrame')) ?? '-'}) | ${acts.join(', ')} | ${errs} | ${kb(median(col('bytes')))} (${median(col('requests'))}, ${median(col('revalidated'))}) | ${median(col('images'))} | ${kb(r.opened.cold?.htmlSize ?? 0)} |`
      );
    }
  }
}
if (opt.verbose)
  for (const r of results)
    for (const x of r.rows)
      console.log(
        [
          r.engine,
          r.name,
          x.pass,
          x.kind,
          x.i,
          x.url,
          x.dcl,
          x.hero,
          x.paint,
          x.shown,
          x.vt,
          x.types,
          x.stripOld,
          x.stripOldStyle,
          x.prerendered ? 'pre' : '',
          x.requests,
          x.revalidated,
          x.bytes,
          x.htmlSize,
          x.errors,
        ].join('\t')
      );
for (const r of results)
  for (const e of r.errors ?? [])
    console.log(`error ${r.engine} ${r.name} [${e.step}]: ${e.text}`);
if (opt.out) writeFileSync(opt.out, JSON.stringify(results, null, 2));
