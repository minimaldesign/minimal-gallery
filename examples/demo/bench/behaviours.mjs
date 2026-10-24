#!/usr/bin/env node
// Behaviour check for the viewer, in Chromium, WebKit and Firefox: the
// signed-off behaviours that the performance work must not break (`?in=`
// context, no wrap, panel keys, toggles, panes, palette, sort, settings
// before first paint, the strip and list built on demand, and the
// no-script fallbacks), and the Phase 2 additions (slideshow, random,
// feeds, sitemap, link previews, the credit). Prints one line per check
// and exits non-zero on a failure.
//
//   node bench/behaviours.mjs [--url http://localhost:4421] [--engines webkit]

import { chromium, firefox, webkit } from 'playwright';
import { parseArgs } from 'node:util';

const { values: opt } = parseArgs({
  options: {
    url: { type: 'string', default: 'http://localhost:4421' },
    engines: { type: 'string', default: 'chromium,webkit,firefox' },
  },
});
const ENGINES = { chromium, webkit, firefox };
const ALBUM = '/feelings/oppressive_cuteness/';
const GRID = '/feelings/down_the_drain/?in=grid';

let failed = 0;
const check = (engine, name, ok, detail = '') => {
  if (!ok) failed++;
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${engine}: ${name}${detail ? ` (${detail})` : ''}`
  );
};
const json = async (path) => (await fetch(opt.url + path)).json();

// what the page had before the deferred theme script ran
function early() {
  document.addEventListener('readystatechange', () => {
    if (document.readyState === 'interactive')
      window.__early = { ...document.documentElement.dataset };
  });
}

async function run(engine) {
  const browser = await ENGINES[engine].launch();
  const ok = (name, cond, detail) => check(engine, name, cond, detail);
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  await context.addInitScript(early);
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  const go = async (path) => {
    await page.goto(opt.url + path, { waitUntil: 'load' });
    await page.waitForTimeout(400);
  };
  const $eval = (sel, fn, arg) => page.$eval(sel, fn, arg);
  const count = (sel) => page.$$eval(sel, (x) => x.length);
  const html = () =>
    page.evaluate(() => ({ ...document.documentElement.dataset }));

  // ALBUM: neighbors from the HTML, no strip or list rows in it
  const album = await json('/feelings.json');
  const ai = album.photos.findIndex((p) => p.href === ALBUM);
  await go(ALBUM);
  ok(
    'album next is the next album photo',
    (await $eval('.stage_next', (a) => a.pathname + a.search)) ===
      album.photos[ai + 1].href
  );
  ok('strip off: no frames built', (await count('.strip_item')) === 0);
  ok('list not shown: no rows built', (await count('.ledger tbody tr')) === 0);
  ok(
    'grid has the album',
    (await count('.thumbs_link')) === album.photos.length
  );
  ok('data-script set', (await html()).script === '');

  // TOGGLES
  await page.keyboard.press('s');
  await page.waitForTimeout(200);
  ok('s: strip built', (await count('.strip_item')) === album.photos.length);
  ok(
    's: strip shown',
    await $eval('.strip', (e) => getComputedStyle(e).display !== 'none')
  );
  ok('s: data-strip on', (await html()).strip === 'on');
  const centered = await $eval('.strip_link[aria-current]', (a) => {
    const r = a.getBoundingClientRect();
    const l = a.closest('.strip_list').getBoundingClientRect();
    return Math.abs(r.left + r.width / 2 - (l.left + l.width / 2)) < 40;
  });
  ok('s: current frame centered', centered);
  await page.keyboard.press('f');
  ok('f: fit contain', (await html()).fit === 'contain');
  ok(
    'f: photo fits',
    await $eval(
      '.stage_photo',
      (i) => i.getBoundingClientRect().width < innerWidth - 1
    )
  );
  await page.keyboard.press('f');
  await page.keyboard.press('i');
  await page.waitForTimeout(200);
  ok(
    'i: info pane open',
    await $eval('#info', (e) => getComputedStyle(e).display === 'block')
  );
  await page.keyboard.press('i');
  await page.keyboard.press('?');
  await page.waitForTimeout(200);
  ok(
    '?: keys pane open',
    await $eval('#keys', (e) => getComputedStyle(e).display === 'block')
  );
  await page.keyboard.press('?');

  // PANEL KEYS
  await page.keyboard.press('ArrowUp');
  await page.waitForTimeout(900);
  ok('ArrowUp: panel up', (await html()).panel === '');
  ok(
    'ArrowUp: current thumbnail selected',
    await page.evaluate(() =>
      document.activeElement?.matches('.thumbs_link[aria-current]')
    )
  );
  await page.keyboard.press('ArrowRight');
  ok(
    'ArrowRight in panel moves the selection',
    await page.evaluate(() =>
      document.activeElement?.matches('.thumbs_link:not([aria-current])')
    )
  );
  await page.keyboard.press('v');
  await page.waitForTimeout(200);
  ok(
    'v: list rows built',
    (await count('.ledger tbody tr')) === album.photos.length
  );
  ok(
    'v: thumbs hidden',
    await $eval('.thumbs', (e) => getComputedStyle(e).display === 'none')
  );
  ok(
    'v: selection kept on a row',
    await page.evaluate(
      () => !!document.activeElement?.closest('.ledger tbody')
    )
  );
  await page.click('th[data-type] .ledger_sort >> nth=1'); // Date
  const dates = await page.$$eval('.ledger tbody tr td:nth-child(3)', (t) =>
    t.map((x) => x.dataset.sort).filter(Boolean)
  );
  ok(
    'sort: Date ascending',
    (await $eval('th[data-type]:nth-child(3)', (t) =>
      t.getAttribute('aria-sort')
    )) === 'ascending' && dates.every((x, i) => !i || dates[i - 1] <= x)
  );
  await page.keyboard.press('v');
  await page.keyboard.press('t');
  ok('t: crop original', (await html()).crop === 'original');
  await page.keyboard.press('t');
  await page.keyboard.press('1');
  ok('1: small thumbnails', (await html()).size === 'small');
  await page.keyboard.press('2');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(900);
  ok('Escape: back to the viewer', (await html()).panel === undefined);

  // PALETTE
  await page.keyboard.press('/');
  await page.waitForTimeout(200);
  ok('/: palette open', await $eval('#palette', (d) => d.open));
  await page.keyboard.type('nikon');
  const shown = await page.$$eval(
    '.chip',
    (c) => c.filter((x) => x.offsetParent).length
  );
  ok('palette filters', shown > 0 && shown < (await count('.chip')));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  ok(
    'Escape clears the search',
    (await $eval('.palette_search', (i) => i.value)) === ''
  );
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  ok('Escape closes', !(await $eval('#palette', (d) => d.open)));

  // A STEP happens inside the page: same document, everything follows
  await page.evaluate(() => (window.__same = true));
  const next = album.photos[ai + 1];
  const href = () => page.evaluate(() => location.pathname + location.search);
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(1200);
  ok('step: same document', await page.evaluate(() => window.__same === true));
  ok('step: URL pushed', (await href()) === next.href);
  ok('step: title', (await page.title()).startsWith(next.title + ' · '));
  ok(
    'step: crumb',
    (await $eval('.hud_title', (h) => h.textContent)) === next.title
  );
  ok(
    'step: info pane',
    (await $eval('#info-title', (h) => h.textContent.trim())) === next.title
  );
  ok(
    'step: one hero, the new one',
    (await page.$$eval('.stage_photo', (i) => i.map((x) => x.alt))).join() ===
      next.title
  );
  ok('step: strip kept', (await count('.strip_item')) === album.photos.length);
  ok(
    'step: strip selection moved',
    (await $eval('.strip_link[aria-current]', (a) => a.pathname)) === next.href
  );
  ok(
    'step: next link moved',
    (await $eval('.stage_next', (a) => a.pathname)) ===
      album.photos[ai + 2].href
  );
  await page.mouse.click(1000, 450);
  await page.waitForTimeout(1200);
  ok(
    'click step: in place',
    (await href()) === album.photos[ai + 2].href &&
      (await page.evaluate(() => window.__same))
  );
  await page.goBack({ waitUntil: 'commit' }).catch(() => {});
  await page.waitForTimeout(1200);
  ok(
    'back: in place',
    (await href()) === next.href && (await page.evaluate(() => window.__same))
  );
  ok(
    'back: hero',
    (await page.$$eval('.stage_photo', (i) => i.at(-1).alt)) === next.title
  );
  await page.goForward({ waitUntil: 'commit' }).catch(() => {});
  await page.waitForTimeout(1200);
  ok(
    'forward: in place',
    (await href()) === album.photos[ai + 2].href &&
      (await page.evaluate(() => window.__same))
  );
  await page.reload();
  await page.waitForTimeout(400);
  ok(
    'reload of a stepped URL',
    (await $eval('.hud_title', (h) => h.textContent)) ===
      album.photos[ai + 2].title
  );
  const e = await page.evaluate(() => window.__early);
  ok('settings on <html> before mg.js', e?.strip === 'on');

  // ?in=grid: context from the JSON
  const all = await json('/grid.json');
  const gi = all.photos.findIndex((p) => GRID.startsWith(p.href));
  await go(GRID);
  ok(
    '?in=grid next stays in the context',
    (await $eval('.stage_next', (a) => a.pathname + a.search)) ===
      `${all.photos[gi + 1].href}?in=grid`
  );
  ok('?in=grid no album crumb', (await count('.hud_context')) === 0);
  ok(
    '?in=grid count',
    (await $eval('.table_count', (s) => s.textContent.trim())) === '241 photos'
  );
  ok('?in=grid strip in context', (await count('.strip_item')) === 241);
  await page.waitForTimeout(2500);
  ok('?in=grid grid rebuilt when idle', (await count('.thumbs_link')) === 241);
  ok('?in=grid rail built', (await count('.rail_link')) > 1);

  // NO WRAP
  await go(all.photos[240].href + '?in=grid');
  ok(
    'last photo: no next',
    !(await $eval('.stage_next', (a) => a.hasAttribute('href')))
  );
  const at = page.url();
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(500);
  ok('last photo: ArrowRight stays', page.url() === at);
  await go(album.photos[0].href);
  ok(
    'first photo: no previous',
    !(await $eval('.stage_prev', (a) => a.hasAttribute('href')))
  );

  // CONTEXT PAGE, first visit in a new window: opens on the panel
  // (Chrome 156 supports scroll-initial-target and still opened it at the
  // top; the script now checks where the page is)
  const fresh = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const fp = await fresh.newPage();
  await fp.goto(opt.url + '/feelings/', { waitUntil: 'load' });
  await fp.waitForTimeout(600);
  ok(
    'context page, first visit: on the panel',
    await fp.evaluate(
      () =>
        scrollY >= innerHeight - 2 &&
        document.documentElement.hasAttribute('data-panel')
    )
  );
  await fp.$eval('.table_scroller', (s) => (s.scrollTop = s.scrollHeight));
  await fp.waitForTimeout(300);
  // the credit's text: its space above is the credit's own padding
  const gaps = await fp.evaluate(() => {
    const p = document.querySelector('.table_credit');
    const c = p.getBoundingClientRect();
    const top = c.top + parseFloat(getComputedStyle(p).paddingBlockStart);
    const last = [...document.querySelectorAll('.thumbs > li')]
      .at(-1)
      .getBoundingClientRect();
    return [top - last.bottom, innerHeight - c.bottom].map(Math.round);
  });
  ok(
    'credit: the same space above and below',
    Math.abs(gaps[0] - gaps[1]) <= 2,
    `${gaps[0]} and ${gaps[1]} px`
  );
  // a context with few photos: the credit still at the bottom, centered
  await fp.goto(opt.url + '/motion/', { waitUntil: 'load' });
  await fp.waitForTimeout(600);
  const low = await fp.evaluate(() => {
    const c = document.querySelector('.table_credit').getBoundingClientRect();
    const col = document.querySelector('.table_photos').getBoundingClientRect();
    return [
      innerHeight - c.bottom,
      (c.left + c.right) / 2 - (col.left + col.right) / 2,
    ].map(Math.round);
  });
  ok(
    'credit: at the bottom of a short panel, centered',
    Math.abs(low[0] - gaps[1]) <= 2 && Math.abs(low[1]) <= 1,
    `${low[0]} px from the bottom`
  );
  const keysLine = await fp.$eval(
    '.keys_credit',
    (p) => getComputedStyle(p).textAlign
  );
  ok('credit: the keys pane line at the right', keysLine === 'end');
  await fresh.close();

  // CONTEXT PAGE opens on the panel, list rows in its HTML
  await page.evaluate(() => localStorage.setItem('mg-view', 'list'));
  await go('/feelings/');
  ok('context page: panel', (await html()).panel === '');
  ok(
    'context page: static rows',
    (await count('.ledger tbody tr')) === album.photos.length
  );
  ok(
    'context page: list before mg.js',
    (await page.evaluate(() => window.__early))?.view === 'list'
  );
  await page.evaluate(() => localStorage.clear());

  // HOME
  await go('/');
  ok('home: 241 thumbnails', (await count('.thumbs_link')) === 241);
  ok(
    'home: next in grid',
    (await $eval('.stage_next', (a) => a.search)) === '?in=grid'
  );

  // HEAD: feeds and the link preview
  await go(ALBUM);
  const head = await page.evaluate(() => {
    const at = (s, a = 'content') => document.querySelector(s)?.[a];
    return {
      rss: at('link[type="application/rss+xml"]', 'href'),
      json: at('link[type="application/feed+json"]', 'href'),
      image: at('meta[property="og:image"]'),
      url: at('meta[property="og:url"]'),
      title: at('meta[property="og:title"]'),
      card: at('meta[name="twitter:card"]'),
    };
  });
  ok(
    'head: feed links',
    /\/feed\.xml$/.test(head.rss) && /\/feed\.json$/.test(head.json)
  );
  ok(
    'head: og:url is the page',
    head.url && new URL(head.url).pathname === ALBUM
  );
  ok('head: og:title is the photo', head.title === album.photos[ai].title);
  ok('head: large card', head.card === 'summary_large_image');
  const img =
    head.image && (await fetch(opt.url + new URL(head.image).pathname));
  ok(
    'head: og:image is an absolute JPEG',
    /^https?:/.test(head.image ?? '') &&
      img?.ok &&
      img.headers.get('content-type') === 'image/jpeg'
  );
  const feeds = await page.evaluate(async () => {
    const xml = async (u) =>
      new DOMParser().parseFromString(
        await (await fetch(u)).text(),
        'application/xml'
      );
    const rss = await xml('/feed.xml');
    const map = await xml('/sitemap.xml');
    const json = await (await fetch('/feed.json')).json();
    return {
      rss:
        !rss.querySelector('parsererror') &&
        rss.querySelectorAll('item').length,
      enclosure: rss.querySelector('item enclosure')?.getAttribute('length'),
      json:
        json.version === 'https://jsonfeed.org/version/1.1' &&
        json.items.length,
      map:
        !map.querySelector('parsererror') &&
        map.getElementsByTagName('url').length,
    };
  });
  ok('feed.xml: 50 items', feeds.rss === 50);
  ok('feed.xml: enclosure length', +feeds.enclosure > 0);
  ok('feed.json: 50 items', feeds.json === 50);
  ok(
    'sitemap: every photo and context',
    feeds.map > 241 + 6,
    String(feeds.map)
  );

  // CREDIT and the new key rows
  ok(
    'credit: after the photos',
    await page.evaluate(
      () =>
        document
          .querySelector('.table_photos > :last-child')
          ?.matches('.credit') &&
        document.querySelector('.table_credit a').href ===
          'https://docs.minimalgallery.net/'
    )
  );
  ok(
    'credit: version in the keys pane',
    /^minimal gallery \d+\.\d+\.\d+/.test(
      await $eval('.keys_credit', (p) => p.textContent.trim())
    )
  );
  const caps = await page.$$eval('#keys dt kbd', (k) =>
    k.map((x) => x.textContent)
  );
  ok('keys: Space and r rows', caps.includes('Space') && caps.includes('r'));

  // SLIDESHOW: Space or the play button starts a timed step in place,
  // pointer movement does not pause it, it starts over after the last
  // photo; a short interval for the test
  const short = () =>
    page.addStyleTag({ content: ':root { --mg-slideshow: 700ms; }' });
  const index = async () =>
    album.photos.findIndex((p) => p.href === new URL(page.url()).pathname);
  const pressed = () =>
    page.$$eval('.playButton button', (b) => b.map((x) => x.ariaPressed));
  await short();
  await page.evaluate(() => (window.__same = true));
  await page.keyboard.press(' ');
  ok('Space: slideshow on', (await html()).play === '');
  ok(
    'Space: the play icon answers',
    await $eval('.stage_flash', (f) => f.matches('.is-on[data-state="play"]'))
  );
  ok(
    'play buttons pressed',
    (await pressed()).every((x) => x === 'true')
  );
  await page.waitForTimeout(1600);
  const played = await index();
  ok(
    'slideshow: steps in place',
    played > ai && (await page.evaluate(() => window.__same)),
    `${played - ai} steps`
  );
  await page.mouse.move(600, 400);
  await page.mouse.move(640, 430, { steps: 4 });
  const moved = await index();
  await page.waitForTimeout(1600);
  ok(
    'slideshow: pointer movement does not pause it',
    (await index()) > moved &&
      (await $eval(
        '.stage_play',
        (b) => getComputedStyle(b).animationPlayState
      )) === 'running'
  );
  await page.keyboard.press(' ');
  ok(
    'Space again: off, the pause icon answers',
    (await html()).play === undefined &&
      (await $eval('.stage_flash', (f) => f.dataset.state)) === 'pause' &&
      (await pressed()).every((x) => x === 'false')
  );
  const held = await index();
  await page.waitForTimeout(1600);
  ok('slideshow off: no more steps', (await index()) === held);
  await go(album.photos.at(-2).href);
  await short();
  // the HUD is hidden after the keys above, and WebKit's synthetic pointer
  // moves cannot show it: the button is clicked from script
  const playClick = () =>
    page.$eval('.hud .playButton button', (b) => b.click());
  await playClick();
  await page.waitForTimeout(2600);
  const looped = await index();
  ok(
    'play button: starts, and the slideshow starts over after the last photo',
    (await html()).play === '' && looped >= 0 && looped < 3,
    `at ${looped}`
  );
  await playClick();
  ok('play button again: off', (await html()).play === undefined);
  await page.keyboard.press('ArrowUp');
  await page.waitForTimeout(900);
  await page.keyboard.press(' ');
  ok('Space in the panel: no slideshow', (await html()).play === undefined);
  await page.click('.table_head .playButton button');
  await page.waitForTimeout(1200);
  ok(
    'panel play button: back to the viewer, playing',
    (await html()).play === '' && (await html()).panel === undefined
  );
  await page.keyboard.press('Escape');
  ok('Escape: slideshow off', (await html()).play === undefined);

  // FIT PHOTO with the strip: the photo is sized above the strip
  await go(ALBUM);
  await page.keyboard.press('f');
  await page.keyboard.press('s');
  await page.waitForTimeout(400);
  const clear = await page.evaluate(() => {
    const ph = document.querySelector('.stage_photo').getBoundingClientRect();
    const st = document.querySelector('.strip').getBoundingClientRect();
    return [ph.bottom, st.top, ph.left, ph.right, st.width].map(Math.round);
  });
  ok(
    'fit photo: above the strip, inside the window',
    clear[0] <= clear[1] + 1 &&
      clear[2] >= 0 &&
      clear[3] <= 1440 &&
      clear[4] <= 1440,
    `photo ${clear[2]}–${clear[3]} ending at ${clear[0]}, strip from ${clear[1]}`
  );
  await page.keyboard.press('s');
  await page.keyboard.press('f');

  // PALETTE: Tab goes from the search field to the first chip, and round
  await page.keyboard.press('/');
  await page.waitForTimeout(300);
  await page.keyboard.press('Tab');
  const first = await page.evaluate(
    () =>
      document.activeElement ===
      [...document.querySelectorAll('#palette .chip')].find(
        (c) => !c.closest('[hidden]')
      )
  );
  await page.keyboard.press('Shift+Tab');
  const back = await page.evaluate(() =>
    document.activeElement.matches('.palette_search')
  );
  await page.keyboard.press('Shift+Tab');
  const last = await page.evaluate(
    () =>
      document.activeElement ===
      [...document.querySelectorAll('#palette .chip')].at(-1)
  );
  ok('palette: Tab to the first chip, Shift+Tab round', first && back && last);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  // RANDOM: r steps in place inside the context; /random/ redirects
  await go(GRID);
  await page.evaluate(() => (window.__same = true));
  await page.keyboard.press('r');
  await page.waitForTimeout(1200);
  const r = new URL(page.url());
  ok(
    'r: random photo in place, in the context',
    r.search === '?in=grid' &&
      r.pathname !== GRID.split('?')[0] &&
      all.photos.some((p) => p.href === r.pathname) &&
      (await page.evaluate(() => window.__same))
  );
  // r leaves out the photos already shown until all have been
  const motion = await json('/motion.json');
  await page.evaluate(() => sessionStorage.removeItem('mgSeen'));
  await go(motion.photos[0].href);
  const seenAll = [new URL(page.url()).pathname];
  for (let n = 1; n < motion.photos.length; n++) {
    await page.keyboard.press('r');
    await page.waitForTimeout(300);
    seenAll.push(new URL(page.url()).pathname);
  }
  ok(
    'r: no photo twice until all were shown',
    new Set(seenAll).size === motion.photos.length,
    seenAll.map((x) => x.split('/').at(-2)).join(', ')
  );
  await page.keyboard.press('r');
  await page.waitForTimeout(300);
  ok('r: then it starts over', new URL(page.url()).pathname !== seenAll.at(-1));
  const landed = async (path) => {
    await page.goto(opt.url + path);
    await page
      .waitForURL((u) => u.pathname !== '/random/', { timeout: 5000 })
      .catch(() => {});
    return new URL(page.url());
  };
  const r1 = await landed('/random/');
  ok(
    '/random/: a photo page',
    all.photos.some((p) => p.href === r1.pathname) && !r1.search
  );
  const r2 = await landed('/random/?in=feelings');
  ok(
    '/random/?in=: keeps the context',
    album.photos.some((p) => p.href === r2.pathname) &&
      r2.search === '?in=feelings'
  );

  // ?in= takes context ids only: no other host's JSON
  const foreign = [];
  const spy = (q) =>
    new URL(q.url()).hostname === 'example.com' && foreign.push(q.url());
  page.on('request', spy);
  await go(`${ALBUM}?in=//example.com/x`);
  page.off('request', spy);
  ok(
    '?in=//host: ignored',
    !foreign.length &&
      (await $eval('.stage_next', (a) => a.pathname + a.search)) ===
        album.photos[ai + 1].href
  );
  ok('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await context.close();

  // TOUCH: a swipe steps in place (no touch emulation in Firefox)
  if (engine !== 'firefox') {
    const touch = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
    });
    const t = await touch.newPage();
    await t.goto(opt.url + ALBUM, { waitUntil: 'load' });
    await t.waitForTimeout(600);
    await t.evaluate(() => (window.__same = true));
    await t.evaluate(() => {
      const f = document.querySelector('.stage_frame');
      const ev = (type, x) =>
        f.dispatchEvent(
          new PointerEvent(type, {
            clientX: x,
            clientY: 400,
            bubbles: true,
            pointerType: 'touch',
          })
        );
      ev('pointerdown', 300);
      ev('pointerup', 120);
    });
    await t.waitForTimeout(1200);
    ok(
      'touch: swipe steps in place',
      (await t.evaluate(() => location.pathname)) ===
        album.photos[ai + 1].href && (await t.evaluate(() => window.__same))
    );
    await touch.close();
  }

  // NO SCRIPT: the grid stands in for the list, no strip toggle
  const bare = await browser.newContext({ javaScriptEnabled: false });
  const p2 = await bare.newPage();
  await p2.goto(opt.url + ALBUM);
  const hidden = (sel) =>
    p2.$eval(sel, (e) => getComputedStyle(e).display === 'none');
  ok('no script: strip toggle hidden', await hidden('.hud_strip'));
  ok('no script: grid/list pair hidden', await hidden('.table_view'));
  ok(
    'no script: grid links',
    (await p2.$$eval('.thumbs_link', (x) => x.length)) === album.photos.length
  );
  ok(
    'no script: next link',
    (await p2.$eval('.stage_next', (a) => a.pathname)) ===
      album.photos[ai + 1].href
  );
  await p2.goto(opt.url + '/feelings/');
  ok(
    'no script: context page grid/list pair shown',
    !(await hidden('.table_view'))
  );
  await bare.close();
  await browser.close();
}

for (const e of opt.engines.split(',')) await run(e);
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
