#!/usr/bin/env node
// Phone check: the touch behaviours and the phone layout, in WebKit with
// Playwright's iPhone 15 profile and Chromium with its Pixel 7 profile
// (touch, a coarse pointer, no hover, the phone viewport). Taps are real
// touch input; a swipe is synthetic pointer events (Playwright has no
// touch drag in WebKit), so it checks the script, not the gesture
// recognizer. Emulation is not a device: safe areas, the browser's own
// toolbars, momentum scrolling and real gesture timing need a phone.
// Prints one line per check and exits non-zero on a failure.
//
//   node bench/phone.mjs [--url http://localhost:4421] [--devices iphone,pixel]

import { chromium, devices, webkit } from 'playwright';
import { parseArgs } from 'node:util';

const { values: opt } = parseArgs({
  options: {
    url: { type: 'string', default: 'http://localhost:4421' },
    devices: { type: 'string', default: 'iphone,pixel' },
  },
});
const DEVICES = {
  iphone: [webkit, 'iPhone 15'],
  pixel: [chromium, 'Pixel 7'],
};
const ALBUM = '/feelings/oppressive_cuteness/';

let failed = 0;
const check = (who, name, ok, detail = '') => {
  if (!ok) failed++;
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${who}: ${name}${detail ? ` (${detail})` : ''}`
  );
};
const json = async (path) => (await fetch(opt.url + path)).json();

async function run(key) {
  const [engine, profile] = DEVICES[key];
  const browser = await engine.launch();
  const context = await browser.newContext({ ...devices[profile] });
  const page = await context.newPage();
  const ok = (name, cond, detail) => check(profile, name, cond, detail);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const go = async (path) => {
    await page.goto(opt.url + path, { waitUntil: 'load' });
    await page.waitForTimeout(600);
  };
  const html = () =>
    page.evaluate(() => ({ ...document.documentElement.dataset }));
  const box = (sel) =>
    page.$eval(sel, (e) => {
      const r = e.getBoundingClientRect();
      return {
        top: r.top,
        right: r.right,
        bottom: r.bottom,
        left: r.left,
        width: r.width,
        height: r.height,
        vw: innerWidth,
        vh: innerHeight,
        shown: getComputedStyle(e).display !== 'none',
      };
    });
  const overflow = () =>
    page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  const album = await json('/feelings.json');
  const ai = album.photos.findIndex((p) => p.href === ALBUM);
  const path = () => page.evaluate(() => location.pathname);

  // LAYOUT
  await go(ALBUM);
  ok('photo page: no sideways scroll', (await overflow()) <= 0);
  const hud = await box('.hud');
  ok(
    'HUD inside the window',
    hud.left >= 0 && hud.right <= hud.vw && hud.top >= 0
  );
  const targets = await page.$$eval('.hud .toggle_option', (x) =>
    x
      .filter((e) => e.offsetParent)
      .map((e) => Math.round(Math.min(e.offsetWidth, e.offsetHeight)))
  );
  ok(
    'HUD controls at least 24px (WCAG 2.2 target size)',
    targets.length > 0 && targets.every((t) => t >= 24),
    `${targets.join(', ')} px`
  );
  ok('no keyboard shortcuts button on touch', !(await box('.hud_help')).shown);

  // TAP toggles the chrome, and does not follow the next link
  await page.touchscreen.tap(200, 420);
  await page.waitForTimeout(500);
  ok('tap hides the chrome', (await html()).idle === '');
  ok('tap stays on the photo', (await path()) === ALBUM);
  await page.touchscreen.tap(200, 420);
  await page.waitForTimeout(500);
  ok('tap shows it again', (await html()).idle === undefined);

  // DOUBLE TAP zooms and back
  const tapTwice = async () => {
    await page.touchscreen.tap(200, 420);
    await page.waitForTimeout(90);
    await page.touchscreen.tap(200, 420);
    await page.waitForTimeout(500);
  };
  await tapTwice();
  const zoomed = await page.$eval('.stage_zoom', (i) => i.checked);
  const wide = await page.$eval(
    '.stage_photo',
    (i) => i.getBoundingClientRect().width > innerWidth
  );
  ok('double tap zooms', zoomed && wide);
  await tapTwice();
  ok(
    'double tap again: back',
    !(await page.$eval('.stage_zoom', (i) => i.checked))
  );

  // SWIPE steps in place (synthetic pointer events)
  await page.evaluate(() => (window.__same = true));
  const swipe = (from, to) =>
    page.evaluate(
      ([a, b]) => {
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
        ev('pointerdown', a);
        ev('pointerup', b);
      },
      [from, to]
    );
  await swipe(320, 80);
  await page.waitForTimeout(1200);
  ok(
    'swipe left: next photo, in place',
    (await path()) === album.photos[ai + 1].href &&
      (await page.evaluate(() => window.__same))
  );
  await swipe(80, 320);
  await page.waitForTimeout(1200);
  ok('swipe right: back', (await path()) === ALBUM);

  // a swipe hides the chrome; a tap brings it back
  if ((await html()).idle !== undefined) {
    await page.touchscreen.tap(200, 420);
    await page.waitForTimeout(500);
  }

  // INFO pane as a bottom sheet
  await page.tap('.hud label.toggle_option:has(input[name="info"])');
  await page.waitForTimeout(400);
  const info = await box('#info');
  ok(
    'info: a bottom sheet',
    info.shown &&
      Math.abs(info.bottom - info.vh) < 1 &&
      Math.abs(info.width - info.vw) < 1 &&
      info.height <= info.vh * 0.6 + 1,
    `${Math.round(info.width)}×${Math.round(info.height)} at ${Math.round(info.top)}`
  );
  await page.tap('#info .pane_close');
  await page.waitForTimeout(400);
  ok('info: Close', !(await box('#info')).shown);

  // STRIP along the bottom, current frame in view
  await page.tap('.hud label.toggle_option:has(input[name="strip"])');
  await page.waitForTimeout(600);
  const strip = await box('.strip');
  const frame = await box('.strip_link[aria-current]');
  ok(
    'strip: along the bottom, current frame in view',
    strip.shown &&
      Math.abs(strip.bottom - strip.vh) < 1 &&
      frame.left >= 0 &&
      frame.right <= frame.vw
  );
  await page.tap('.hud label.toggle_option:has(input[name="strip"])');

  // PALETTE fits the window; its field does not make iOS zoom in
  await page.tap('.hud [commandfor="palette"]');
  await page.waitForTimeout(400);
  const pal = await box('#palette');
  ok(
    'palette: open, inside the window',
    (await page.$eval('#palette', (d) => d.open)) &&
      pal.left >= 0 &&
      pal.right <= pal.vw &&
      pal.bottom <= pal.vh,
    `${Math.round(pal.width)}×${Math.round(pal.height)}`
  );
  const size = await page.$eval('.palette_search', (i) =>
    parseFloat(getComputedStyle(i).fontSize)
  );
  ok('palette: search text 16px or more', size >= 16, `${size}px`);
  const chips = await page.$eval(
    '.palette_groups',
    (g) => g.scrollWidth - g.clientWidth
  );
  ok('palette: chips wrap', chips <= 0);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // PANEL: a scroll past the middle snaps to the photos, which scroll on
  // their own and end with the credit. Playwright's WebKit snaps no scroll
  // that did not come from a finger (and has no touch drag), so the snap
  // is checked in Chromium only.
  if (engine === webkit)
    console.log(
      `skip ${profile}: panel snap (headless WebKit snaps no script or wheel scroll; check on a phone)`
    );
  else {
    await page.evaluate(() => scrollTo(0, innerHeight * 0.7));
    await page.waitForTimeout(1200);
    const snapped = await page.evaluate(() => [scrollY, innerHeight]);
    ok(
      'panel: snaps up',
      Math.abs(snapped[0] - snapped[1]) < 2 && (await html()).panel === '',
      `scrollY ${Math.round(snapped[0])} of ${snapped[1]}`
    );
    await page.evaluate(() => scrollTo(0, innerHeight * 0.3));
    await page.waitForTimeout(1200);
    ok(
      'panel: snaps back to the viewer',
      (await page.evaluate(() => scrollY)) < 2
    );
  }
  await go('/feelings/');
  ok('album page: opens on the panel', (await html()).panel === '');
  ok('album page: no sideways scroll', (await overflow()) <= 0);
  const head = await box('.table_head');
  ok('panel header inside the window', head.left >= 0 && head.right <= head.vw);
  // found on iOS Safari: the tools took the whole row and left the
  // breadcrumb no width, so its text ran over the count
  const crumbs = await page.$eval('.table_crumbs ol', (o) => [
    o.clientWidth,
    o.scrollWidth,
  ]);
  ok(
    'panel header: the breadcrumb has room',
    crumbs[0] > 0 && crumbs[1] <= crumbs[0] + 1,
    `${crumbs[0]}px for ${crumbs[1]}px`
  );
  await page.$eval('.table_scroller', (s) => (s.scrollTop = s.scrollHeight));
  await page.waitForTimeout(400);
  const credit = await box('.table_credit');
  ok(
    'panel: ends with the credit, in view',
    credit.top >= 0 && credit.bottom <= credit.vh,
    `${Math.round(credit.top)}–${Math.round(credit.bottom)} of ${credit.vh}`
  );
  await page.tap('label.toggle_option:has(input[name="view"][value="list"])');
  await page.waitForTimeout(400);
  const ledger = await page.$eval('.ledger', (l) => ({
    shown: getComputedStyle(l).display !== 'none',
    scroll: l.scrollWidth > l.clientWidth,
    page: document.documentElement.scrollWidth - innerWidth,
  }));
  ok(
    'list: its own sideways scroll, not the page’s',
    ledger.shown && ledger.page <= 0,
    ledger.scroll ? 'list scrolls sideways' : 'list fits'
  );

  // HOME
  await go('/');
  ok('home: no sideways scroll', (await overflow()) <= 0);
  ok('no console errors', !errors.length, errors.slice(0, 3).join(' | '));
  await browser.close();
}

for (const d of opt.devices.split(',')) await run(d);
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
