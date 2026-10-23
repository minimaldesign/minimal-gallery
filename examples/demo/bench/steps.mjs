#!/usr/bin/env node
// Viewer step benchmark, the regression check for next and previous.
//
// A step happens inside the page (no navigation): mg.js fades a second
// image in over the old one. For each engine (Chromium, WebKit, Firefox)
// and each scenario (a photo in the middle of a 70-photo album, home with
// all 241 photos, a photo page in `?in=grid`) it opens the page, lets it
// settle, steps ten times with ArrowRight and ten times with a click on the
// photo, then goes back three times and forward three times. It runs that
// twice in one browser context: a cold pass, then a warm pass over the same
// photos.
//
// Per step, from the key or click (a capture-phase timestamp):
//   start   the new image's opacity transition starts (transitionrun)
//   opaque  the new image is fully opaque (its transitionend)
// and the requests the step made (hero, neighbor preloads, strip frames,
// anything else; a strip frame must never be fetched again), whether the
// URL is the photo's, whether the document is the same one, console
// errors. Back and forward must step in place the same way.
//
// Usage (against `astro preview` of the built demo, or any server):
//   node bench/steps.mjs [--url http://localhost:4421] [--engines webkit]
//     [--scenarios album,home,grid] [--strip on|off] [--blur on|off]
//     [--out results.json] [--verbose]
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
    steps: { type: 'string', default: '10' },
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
  const B = (window.__bench = { doc: Math.random(), cur: null });
  if (strip) localStorage['mg-strip'] = strip;
  if (blur === 'off')
    document.addEventListener('DOMContentLoaded', () =>
      document.head.append(
        Object.assign(document.createElement('style'), {
          textContent: '.surface { backdrop-filter: none !important; }',
        })
      )
    );
  const mark = () => (B.cur = { t0: performance.now() });
  addEventListener(
    'keydown',
    (e) => /^Arrow(Left|Right)$/.test(e.key) && mark(),
    true
  );
  addEventListener('click', mark, true);
  B.mark = mark;
  // the entering image is the stage photo without is-hidden
  const entering = (e) =>
    e.propertyName === 'opacity' &&
    e.target.matches?.('.stage_photo') &&
    !e.target.classList.contains('is-hidden');
  addEventListener(
    'transitionrun',
    (e) => entering(e) && B.cur && (B.cur.start ??= performance.now()),
    true
  );
  addEventListener(
    'transitionend',
    (e) => entering(e) && B.cur && (B.cur.end ??= performance.now()),
    true
  );
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

  // requests and errors, attributed to the step that was running
  let current = null;
  let inflight = 0;
  let lastNet = Date.now();
  const reqs = [];
  const errors = [];
  context.on('request', (r) => {
    inflight++;
    lastNet = Date.now();
    reqs.push({ step: current, url: r.url(), type: r.resourceType() });
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
  const quiet = async (ms = 300, cap = 5000) => {
    const t = Date.now();
    while (Date.now() - t < cap) {
      if (inflight <= 0 && Date.now() - lastNet > ms) return;
      await page.waitForTimeout(50);
    }
  };
  // the step is done when the new image is opaque (or 4s passed)
  const settled = async () => {
    const t = Date.now();
    while (Date.now() - t < 4000) {
      const c = await page.evaluate(() => window.__bench.cur);
      if (c?.end) return c;
      await page.waitForTimeout(25);
    }
    return page.evaluate(() => window.__bench.cur);
  };
  const state = () =>
    page.evaluate(() => ({
      doc: window.__bench.doc,
      url: location.pathname + location.search,
      hero: [...document.querySelectorAll('.stage_photo')].at(-1)?.alt,
      // strip frames already loaded: fetching one again is a reload
      strip: [...document.querySelectorAll('.strip_image')]
        .filter((i) => i.complete && i.naturalWidth)
        .map((i) => i.src),
      near: [...document.querySelectorAll('link[data-near]')].map((l) =>
        l.getAttribute('href')
      ),
    }));

  const rows = [];
  const opened = {};
  for (const pass of ['cold', 'warm']) {
    current = `${pass} open`;
    await page.goto(url + SCENARIOS[name], { waitUntil: 'load' });
    await page.waitForTimeout(1200); // the context JSON loads after load
    await quiet();
    opened[pass] = await page.evaluate(
      () => performance.getEntriesByType('navigation')[0]?.decodedBodySize
    );
    const doc = (await state()).doc;
    const visited = [];
    const run = async (kind, i, act) => {
      const before = await state();
      const target = await page
        .$eval('.stage_next', (a) => a.pathname + a.search)
        .catch(() => null);
      current = `${pass} ${kind} ${i}`;
      const from = reqs.length;
      await act();
      const c = await settled();
      await quiet();
      const after = await state();
      const mine = reqs.slice(from).filter((r) => r.step === current);
      const strips = new Set(before.strip);
      const kindOf = (u) =>
        strips.has(u)
          ? 'strip'
          : after.near.some((n) => u.endsWith(n))
            ? 'preload'
            : /\/_mg\/.*(jpeg|w\d|h\d)/.test(u) && !/-grid\./.test(u)
              ? 'hero'
              : /-grid\./.test(u)
                ? 'lazy'
                : 'other';
      const k = mine.map((r) => kindOf(r.url));
      rows.push({
        pass,
        kind,
        i,
        start: c?.start ? Math.round(c.start - c.t0) : null,
        opaque: c?.end ? Math.round(c.end - c.t0) : null,
        requests: mine.length,
        hero: k.filter((x) => x === 'hero').length,
        preload: k.filter((x) => x === 'preload').length,
        strip: k.filter((x) => x === 'strip').length,
        lazy: k.filter((x) => x === 'lazy').length,
        other: mine.filter((r, n) => k[n] === 'other').map((r) => r.url),
        urlOk: kind === 'key' || kind === 'click' ? after.url === target : null,
        url: after.url,
        hero_alt: after.hero,
        same: after.doc === doc,
        errors: errors.filter((e) => e.step === current).length,
      });
      return after;
    };
    for (const kind of ['key', 'click'])
      for (let i = 1; i <= STEPS; i++) {
        visited.push((await state()).url);
        await run(kind, i, () =>
          kind === 'key'
            ? page.keyboard.press('ArrowRight')
            : page.mouse.click(1440 * 0.72, 900 * 0.5)
        );
      }
    // back and forward: the same in-place step, to the URL before
    const end = (await state()).url;
    for (let i = 1; i <= 3; i++) {
      const want = visited[visited.length - i];
      const a = await run('back', i, () =>
        page.evaluate(() => {
          window.__bench.mark();
          history.back();
        })
      );
      rows.at(-1).urlOk = a.url === want;
    }
    for (let i = 1; i <= 3; i++) {
      const want = i === 3 ? end : visited[visited.length - 3 + i];
      const a = await run('forward', i, () =>
        page.evaluate(() => {
          window.__bench.mark();
          history.forward();
        })
      );
      rows.at(-1).urlOk = a.url === want;
    }
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
for (const engine of opt.engines.split(',')) {
  const rs = results.filter((r) => r.engine === engine);
  console.log(`\n## ${engine} ${rs[0]?.version ?? ''}\n`);
  console.log(
    '| scenario | pass | start ms (max) | opaque ms (max) | requests/step | hero, preload, other | strip reloads (first loads) | URL ok | same document | back/forward in place | errors |'
  );
  console.log('|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of rs) {
    if (r.failed) {
      console.log(`| ${r.name} | failed: ${r.failed} |`);
      continue;
    }
    for (const pass of ['cold', 'warm']) {
      const s = r.rows.filter((x) => x.pass === pass);
      const st = s.filter((x) => x.kind === 'key' || x.kind === 'click');
      const bf = s.filter((x) => x.kind === 'back' || x.kind === 'forward');
      const col = (k, xs = st) => xs.map((x) => x[k]);
      const sum = (k, xs = st) => xs.reduce((a, x) => a + x[k], 0);
      const other = st.reduce((a, x) => a + x.other.length, 0);
      console.log(
        `| ${r.name} | ${pass} | ${median(col('start'))} (${max(col('start'))}) | ${median(col('opaque'))} (${max(col('opaque'))}) | ${median(col('requests'))} | ${sum('hero')}, ${sum('preload')}, ${other} | ${sum('strip', s)} (${sum('lazy', s)}) | ${st.filter((x) => x.urlOk).length}/${st.length} | ${s.every((x) => x.same) ? 'yes' : 'no'} | ${bf.filter((x) => x.urlOk && x.same && x.start != null).length}/${bf.length} | ${sum('errors', s)} |`
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
          x.start,
          x.opaque,
          x.requests,
          x.hero,
          x.preload,
          x.strip,
          x.other.join(' '),
          x.urlOk,
          x.same,
        ].join('\t')
      );
for (const r of results)
  for (const e of r.errors ?? [])
    console.log(`error ${r.engine} ${r.name} [${e.step}]: ${e.text}`);
if (opt.out) writeFileSync(opt.out, JSON.stringify(results, null, 2));
