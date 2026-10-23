// minimal gallery theme script: enhancement only; every page works without
// it. With it, next and previous happen inside the page (STEP): no
// navigation, a plain CSS crossfade between two images. Loaded with `defer blocking="render"` (render-blocking in Chrome
// only); the visitor's settings are already on <html> from the inline
// script in the head (restore.js), which runs before first paint in every
// engine. Ported from the signed-off prototype (design/prototype/mg.js).
const d = document;
const root = d.documentElement;
const ls = localStorage;
const ss = sessionStorage;
const $ = (s, c = d) => c.querySelector(s);
const $$ = (s, c = d) => [...c.querySelectorAll(s)];
const tok = (n) => getComputedStyle(root).getPropertyValue(n).trim();
const base = $('meta[name="mg-root"]').content;
const coarse = matchMedia('(pointer: coarse)').matches;
// syncPanel() runs from restore(), early: its state is declared up here
let synced = false;
// the strip's latest glide (center() runs early too): a newer one takes over
let tween = 0;
// the panel (the photos below the viewer) is up when it covers the window
const panelUp = () => scrollY > innerHeight / 2;
// snapped to the panel: the page (viewer + one-window panel) is at its end
const atPanel = () => scrollY + innerHeight >= root.scrollHeight - 2;
const esc = (s) => String(s).replace(/[&<"]/g, (c) => `&#${c.charCodeAt()};`);

// SCROLL: no restored scroll positions. A page opens on the viewer unless
// it is a context page (table-start) or the URL asks for #grid, so the
// home link always lands on the newest photo.
history.scrollRestoration = 'manual';
const visit = performance.getEntriesByType('navigation')[0]?.type;
if (!location.hash && !$('.table-start')) scrollTo(0, 0);
// context pages open at the grid where scroll-initial-target is missing
else if (
  $('.table-start') &&
  !location.hash &&
  visit !== 'back_forward' &&
  !CSS.supports('scroll-initial-target: nearest')
)
  $('#grid').scrollIntoView();

// PANES (info, keyboard shortcuts): drag one by its header (fine pointer,
// wide window). Each pane's spot is remembered; one that no longer fits
// the window falls back to the default.
const wide = matchMedia('(pointer: fine) and (width >= 768px)');
const movePane = (p, x, y, save) => {
  const key = `mgPane-${p.id}`;
  const w = p.offsetWidth || Math.min(368, innerWidth - 80);
  const h = p.offsetHeight || 120;
  const fits = x >= 0 && y >= 0 && x + w <= innerWidth && y + h <= innerHeight;
  if (!wide.matches || (!fits && !save)) {
    delete p.dataset.moved;
    return delete ls[key];
  }
  x = Math.max(0, Math.min(innerWidth - w, x));
  y = Math.max(0, Math.min(innerHeight - h, y));
  p.style.setProperty('--pane-x', x);
  p.style.setProperty('--pane-y', y);
  p.dataset.moved = '';
  if (save) ls[key] = [x, y];
};
const placePane = (p) => {
  const at = ls[`mgPane-${p.id}`];
  if (at) movePane(p, ...at.split(',').map(Number));
};
for (const p of $$('.pane'))
  p.addEventListener('pointerdown', (e) => {
    if (!wide.matches || !e.target.closest('.pane_head')) return;
    if (e.target.closest('button, label')) return;
    const r = p.getBoundingClientRect();
    const [dx, dy] = [e.clientX - r.left, e.clientY - r.top];
    p.setPointerCapture(e.pointerId);
    p.classList.add('is-dragging');
    p.onpointermove = (ev) => movePane(p, ev.clientX - dx, ev.clientY - dy, 1);
    p.onpointerup = () => {
      p.onpointermove = null;
      p.classList.remove('is-dragging');
    };
  });

// SETTINGS that outlive a page (crop, view, size, strip, fit, the panes),
// each falling back to the owner's token, and hidden chrome. A checkbox
// stores its value when checked (default "on") and its data-off value
// otherwise (default "off"). Each setting is `data-<name>` on <html>, which
// the CSS reads ahead of the inputs (the head script sets the visitor's
// choices before first paint); this keeps the inputs in step with it, and
// runs again on pagereveal (a prerendered page may be stale).
const OPTIONS = {
  info: '',
  keys: '',
  crop: '--mg-grid-crop',
  view: '--mg-grid-view',
  size: '--mg-grid-size',
  strip: '--mg-strip',
  fit: '--mg-fit',
};
const restore = () => {
  ss.mgIdle ? (root.dataset.idle = 'key') : delete root.dataset.idle;
  for (const [n, t] of Object.entries(OPTIONS)) {
    const fixed = n === 'view' && $('meta[name="mg-view"]')?.content;
    const v = fixed || ls['mg-' + n] || (t && tok(t));
    if (!v) {
      delete root.dataset[n];
      continue;
    }
    root.dataset[n] = v;
    for (const i of $$(`input[name="${n}"]`))
      i.checked =
        i.type === 'checkbox' ? v === (i.value || 'on') : i.value === v;
  }
  for (const n of ['info', 'keys'])
    if ($(`input[name="${n}"]`).checked) placePane($(`#${n}`));
  syncPanel();
};
restore();
d.addEventListener('change', (e) => {
  const t = e.target;
  if (t.name in OPTIONS)
    ls['mg-' + t.name] = root.dataset[t.name] =
      t.type === 'checkbox'
        ? t.checked
          ? t.getAttribute('value') || 'on'
          : t.dataset.off || 'off'
        : t.value;
  if (t.name === 'strip' && t.checked)
    withCtx((c) => {
      strip(c);
      center();
    });
  if (t.name === 'view' && t.value === 'list' && t.checked) withCtx(list);
  if (t.name === 'view' && root.hasAttribute('data-panel')) {
    const was = d.activeElement?.closest?.('a')?.pathname;
    select(items().find((a) => a.pathname === was) || pick());
  }
  if ((t.name === 'info' || t.name === 'keys') && t.checked)
    placePane($(`#${t.name}`));
  // zoom asks for the 1:1 derivative: the srcset's sizes follow the zoom
  if (t.matches('.stage_zoom')) {
    const img = $$('.stage_photo').at(-1);
    const w = getComputedStyle(d.body).getPropertyValue('--photo-zoom-width');
    if (img.srcset) img.sizes = t.checked ? `${w}px` : '100vw';
  }
  if (t.matches('.stage_zoom:checked')) {
    const s = $('.stage_scroller');
    requestAnimationFrame(() =>
      s.scrollTo(
        (s.scrollWidth - s.clientWidth) * at[0],
        (s.scrollHeight - s.clientHeight) * at[1]
      )
    );
  }
});

// CONTEXT: the page's photos as JSON (<id>.json, cached in sessionStorage
// on first fetch). `?in=<id>` keeps prev/next, strip, grid, list and
// breadcrumb in that context; without it the page's own context (a photo's
// album) is in the HTML, except the strip and, on pages that open on the
// viewer, the list rows, which are built from the JSON when shown. Without
// script the page stays in its album and the grid stands in for the rest.
// What a page needs before first paint is cheap (links, preloads, crumbs,
// the strip when it is on); the grid and the list wait until they are
// wanted or the page is idle. The JSON also carries everything the viewer
// shows, so a step needs nothing else.
const own = $('.strip').dataset;
// a context id is slugs joined by `/` (`grid`, `colors`, `aperture/1.4`);
// anything else is ignored, so `?in=//host/x` cannot fetch another site's
// JSON (its info rows and captions are written into the page as markup)
const ctx = new URLSearchParams(location.search)
  .get('in')
  ?.match(/^[\w.-]+(\/[\w.-]+)*$/)?.[0];
const ctxId = ctx || own.context;
const linkIn = ctx || own.in;
const query = linkIn
  ? `?in=${encodeURIComponent(linkIn).replace(/%2F/g, '/')}`
  : '';
const inCtx = (p) => p.href + query;
// the photo shown, matched by its page path (slugs repeat); a step moves it
let here = own.photo;
let context; // { photos, i, title, href } once loaded
const waiting = [];
// `fn` once the context is loaded; `fail` if it cannot be
function withCtx(fn, fail) {
  if (context) return fn(context);
  waiting.push([fn, fail]);
  if (waiting.length > 1) return;
  const key = `mgCtx-${ctxId}`;
  const got = (t) => {
    const c = JSON.parse(t);
    c.i = c.photos.findIndex((p) => p.href === here);
    if (c.i < 0) return;
    context = c;
    for (const [f] of waiting.splice(0)) f(c);
  };
  if (ss[key]) return got(ss[key]);
  fetch(`${base}${ctxId}.json`)
    .then((r) => (r.ok ? r.text() : Promise.reject(r.status)))
    .then((t) => {
      try {
        ss[key] = t;
      } catch {} // over quota: fetched again next time
      got(t);
    })
    // the page keeps what its HTML has; a step waiting on it navigates
    .catch(() => waiting.splice(0).forEach(([, f]) => f?.()));
}
const attrs = (p) => `style="--ar: ${p.ar}; --photo: ${p.color}"`;
const current = (p) => (p.href === here ? ' aria-current="page"' : '');
// prev and next, the neighbors' photos and the crumbs: small and visible,
// so applied at once on `?in=` pages and on every step. The static rel
// next and prev links are dropped: steps stay in the page, and Firefox
// would prefetch each next page's HTML for nothing. No
// wrapping: at either end there is no link, so every way of stepping
// (keys, click, swipe) does nothing there.
function nav(c) {
  const ps = c.photos;
  for (const [rel, p] of [
    ['next', ps[c.i + 1]],
    ['prev', ps[c.i - 1]],
  ]) {
    const a = $(`.stage_${rel}`);
    $(`link[rel="${rel}"]`)?.remove();
    $(`link[data-near="${rel}"]`)?.remove();
    if (!p) {
      a.removeAttribute('href');
      a.removeAttribute('aria-label');
      continue;
    }
    a.href = inCtx(p);
    a.ariaLabel = `${rel === 'next' ? 'Next' : 'Previous'} photo: ${p.title}`;
    // the neighbor's photo at low priority, with the hero's srcset choice
    const pre = d.createElement('link');
    const at = {
      rel: 'preload',
      as: 'image',
      href: p.src,
      fetchpriority: 'low',
      'data-near': rel,
      ...(p.srcset && { imagesrcset: p.srcset, imagesizes: '100vw' }),
    };
    for (const [k, v] of Object.entries(at)) pre.setAttribute(k, v);
    d.head.append(pre);
  }
  const n = ps.length;
  $('.table_count').textContent = `${n} photo${n === 1 ? '' : 's'}`;
  for (const crumb of $$('.hud_context, .table_context'))
    if (c.title)
      Object.assign(crumb, {
        textContent: c.title,
        href: `${c.href}#grid`,
      });
    else crumb.parentElement.remove();
}
// the filmstrip's frames, when the strip is on (the builder is shared with
// the inline call after the strip, in the head script)
function strip(c) {
  mgStrip($('.strip'), c.photos, linkIn || '');
  center();
}
// the grid and the rail of another context (`?in=`)
let gridDone = !ctx;
function thumbs(c) {
  if (gridDone) return;
  gridDone = true;
  const seen = new Set();
  $('.thumbs').innerHTML = c.photos
    .map((p) => {
      const id = seen.has(p.year) ? '' : ` id="y-${p.year}"`;
      seen.add(p.year);
      return `<li class="thumbs_item"${id} ${attrs(p)}><a class="thumbs_link" href="${inCtx(p)}"${current(p)}><img class="thumbs_image" src="${p.thumb}" alt="${esc(p.title)}" loading="lazy"><span class="thumbs_tip surface" aria-hidden="true"><b>${esc(p.title)}</b>${esc(p.tip)}</span></a></li>`;
    })
    .join('');
  $('.rail_list').innerHTML = [...seen]
    .map(
      (y) =>
        `<li><a class="rail_link" href="#y-${y}"><span class="rail_year surface">${y === 'undated' ? 'Undated' : y}</span></a></li>`
    )
    .join('');
  $('.table_rail').hidden = seen.size < 2;
}
// the list rows, the first time the list is shown (pages that open on the
// panel have them in their HTML, unless `?in=` changed the context)
let listDone = !ctx && !!$('.ledger tbody tr');
function list(c) {
  if (listDone) return;
  listDone = true;
  $('.ledger tbody').innerHTML = c.photos
    .map(
      (p, i) =>
        `<tr data-i="${i}"><td><a class="ledger_thumb" href="${inCtx(p)}" tabindex="-1" ${attrs(p)}><img class="ledger_image" src="${p.thumb}" alt="" loading="lazy"><span class="ledger_preview surface" aria-hidden="true" style="--preview: url('${p.preview}')"><span class="ledger_previewImage"></span></span></a></td><td data-sort="${esc(p.sort[0])}"><a href="${inCtx(p)}"${current(p)}>${esc(p.title)}</a></td>` +
        p.cells
          .map(
            (col, n) =>
              `<td data-sort="${esc(p.sort[n + 1])}">${col.map(([t, h]) => (h ? `<a href="${h}#grid">${esc(t)}</a>` : esc(t))).join(' ')}</td>`
          )
          .join('') +
        '</tr>'
    )
    .join('');
}
// the grid and list, built now (the panel is wanted) or once the page is
// idle after the step's transition
function panel() {
  if (!gridDone) withCtx(thumbs);
  if (!listDone && listView()) withCtx(list);
}
if (ctx) withCtx(nav);
if ($('input[name="strip"]').checked) withCtx(strip);
if (root.hasAttribute('data-panel')) panel();
else {
  const idle = (f) =>
    self.requestIdleCallback
      ? requestIdleCallback(f, { timeout: 2000 })
      : setTimeout(f, 200);
  addEventListener('load', () => setTimeout(() => idle(panel), 1000), {
    once: true,
  });
  addEventListener('scroll', panel, { once: true, passive: true });
}

// STEP: next and previous (keys, the click zones, a swipe, a strip frame,
// back and forward between photos of this context) happen inside the page:
// no navigation, nothing rebuilt. The new photo is a second image in the
// stage that fades in over the old one (a CSS opacity transition) as soon
// as it has decoded, or after 150ms on its color, so the step answers at
// once; the old one fades out and is removed. Then the page's text, links,
// selection and URL follow. Anything outside the context (or a failed
// JSON fetch) is a normal page load.
const site = $('.hud_crumbs a').textContent;
const at0 = { path: location.pathname, photo: here };
const photoIndex = (href) => {
  const path = new URL(href, location.href).pathname;
  return context.photos.findIndex((p) => p.href === path);
};
function step(href) {
  withCtx(
    () => {
      const i = photoIndex(href);
      i < 0 ? (location.href = href) : stepTo(i);
    },
    () => (location.href = href)
  );
}
let pending = 0; // the latest step: an earlier one still decoding is dropped
function stepTo(i, push = true) {
  const c = context;
  const p = c.photos[i];
  if (!p || i === c.i) return;
  const zoom = $('.stage_zoom');
  if (zoom.checked) {
    zoom.checked = false;
    zoom.dispatchEvent(new Event('change', { bubbles: true }));
  }
  // the new image, preloaded with the hero's srcset choice (the neighbor
  // preloads have usually fetched it already)
  const img = new Image();
  img.className = 'stage_photo is-hidden';
  img.alt = p.title;
  img.width = p.w;
  img.height = p.h;
  img.style.cssText = `--photo: ${p.color}; --photo-ratio: ${p.ar}; --photo-placeholder: none`;
  if (p.srcset) {
    img.sizes = '100vw';
    img.srcset = p.srcset;
  }
  img.src = p.src;
  const token = ++pending;
  Promise.race([
    img.decode().catch(() => {}),
    new Promise((r) => setTimeout(r, 150)),
  ]).then(() => {
    if (token !== pending) return;
    const stage = $('.stage_next');
    const old = $$('.stage_photo', stage);
    stage.append(img);
    getComputedStyle(img).opacity; // start from 0
    img.classList.remove('is-hidden');
    for (const o of old) {
      o.classList.add('is-hidden');
      const gone = () => o.remove();
      o.addEventListener('transitionend', gone, { once: true });
      setTimeout(gone, 2000); // no transition (reduced motion, a hidden tab)
    }
  });
  // everything else at once
  c.i = i;
  here = p.href;
  const label = c.title ?? 'All photos';
  d.title = `${p.title} · ${label} · ${site}`;
  $('meta[name="description"]')?.setAttribute(
    'content',
    `${p.title}, a photograph in ${label}.`
  );
  $('link[rel="canonical"]')?.setAttribute(
    'href',
    new URL(p.href, location.href).href
  );
  $('.hud_title').textContent = p.title;
  $('#info-title').textContent = p.title;
  const cap = $('.info_caption');
  cap.innerHTML = p.caption ?? '';
  cap.hidden = !p.caption;
  $('.info_list').innerHTML = p.info
    .map(
      (r) =>
        `<div class="info_row"><dt class="info_term">${esc(r.term)}</dt><dd class="info_value${r.exposure ? ' info_value-exposure' : ''}">${r.html}</dd></div>`
    )
    .join('');
  const body = d.body.style;
  body.setProperty('--photo', p.color);
  body.setProperty('--photo-ratio', p.ar);
  body.setProperty('--photo-zoom-width', p.zoom);
  body.removeProperty('--photo-placeholder');
  nav(c);
  for (const a of $$(
    '.strip_link, .thumbs_link, .ledger tbody td:nth-child(2) a'
  ))
    a.pathname === p.href
      ? a.setAttribute('aria-current', 'page')
      : a.removeAttribute('aria-current');
  center(true);
  if (push) history.pushState({ mg: p.href }, '', inCtx(p));
  // a slideshow's clock starts again with every photo, whoever stepped
  if (root.hasAttribute('data-play')) replay();
}
// every entry of this document is a photo of this context (or a hash link
// on one): back and forward step in place
history.replaceState({ ...history.state, mg: here }, '');
addEventListener('popstate', (e) => {
  const href =
    e.state?.mg ??
    (location.pathname === at0.path ? at0.photo : location.pathname);
  withCtx(
    (c) => {
      const i = photoIndex(href);
      if (i < 0) location.reload();
      else if (i !== c.i) stepTo(i, false);
    },
    () => location.reload()
  );
});
// a click on the zones or a strip frame is a step; a modified click (a new
// tab) is left to the browser
const plain = (e) =>
  !e.defaultPrevented &&
  !e.button &&
  !(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey);
d.addEventListener('click', (e) => {
  const a = e.target.closest?.('.stage_next, .stage_prev, .strip_link');
  if (!a?.href || !plain(e)) return;
  e.preventDefault();
  step(a.href);
});
// load the context early, so the first step is in place too
addEventListener('load', () => withCtx(() => {}), { once: true });

// VIEW TRANSITIONS between pages (a thumbnail to its photo, the photo back
// to the grid): where pageswap and pagereveal exist, the page you leave
// records how you left it and the page you arrive on names the matching
// elements, so the thumbnail morphs into the photo and back. Steps are not
// navigations, so they have no part here.
const vt = (el, n) => el && (el.style.viewTransitionName = n);
let clicked;
addEventListener('click', (e) => {
  clicked = e.target.closest('.thumbs_link');
});
addEventListener('pageswap', (e) => {
  if (!e.viewTransition) return;
  ss.mgVia = clicked ? 'thumb' : 'other';
  if (clicked) vt($('img', clicked), 'photo');
  else if (scrollY < innerHeight / 2) vt($$('.stage_photo').at(-1), 'photo');
});
// `late`: pagereveal fired before this deferred script ran (the head
// script kept the event), too late to name anything
function reveal(e, late) {
  restore();
  center();
  // where the Navigation API is missing, the referrer (same origin: the
  // full URL) says the same
  const from = self.navigation
    ? navigation.activation?.from?.url
    : d.referrer || null;
  if (late || !e.viewTransition || !from) return;
  if (ss.mgVia === 'thumb') vt($('.stage_photo'), 'photo');
  else {
    const path = new URL(from).pathname;
    const a =
      atPanel() &&
      $$('.thumbs_link').find((x) => new URL(x.href).pathname === path);
    const r = a?.getBoundingClientRect();
    if (r && (r.bottom < 0 || r.top > innerHeight))
      a.scrollIntoView({ block: 'center' });
    vt(a?.firstElementChild, 'photo');
  }
  e.viewTransition.finished.finally(() =>
    $$('[style*="view-transition"]').forEach(
      (x) => (x.style.viewTransitionName = '')
    )
  );
}

// CHROME: on a mouse, only real pointer movement shows it and it fades
// after the idle time; over the grid it stays. Arrow keys hide it at once,
// and the hidden state carries to the next page.
let idle;
const show = () => {
  delete root.dataset.idle;
  ss.mgIdle = '';
};
const hide = (how = '') => {
  root.dataset.idle = how;
  ss.mgIdle = '1';
};
const wake = (e) => {
  if (!e.movementX && !e.movementY) return; // synthetic moves after a load
  show();
  clearTimeout(idle);
  const t = tok('--mg-hud-idle');
  idle = setTimeout(
    () =>
      !root.hasAttribute('data-panel') &&
      !$('.hud:hover, dialog[open], .stage_zoom:checked') &&
      hide(),
    parseFloat(t) * (/ms/.test(t) ? 1 : 1000)
  );
};
if (!coarse) {
  addEventListener('pointermove', wake, { passive: true });
  if (!ss.mgIdle) wake({ movementX: 1 });
}
// the panel is up: the chrome stays and the photo crumb goes. CSS does
// this with a scroll-state query; data-panel backs it up in every engine
// (and is the only path where those queries are missing).
// When the panel opens (after load), the photo that was in full view gets
// focus, so arrow keys start from it.
function syncPanel() {
  const up = atPanel();
  const opened = up && synced && !root.hasAttribute('data-panel');
  synced = true;
  root.toggleAttribute('data-panel', up);
  if (up) {
    delete root.dataset.idle;
    delete root.dataset.play;
    ss.mgIdle = '';
  }
  if (opened && !d.activeElement?.closest('.table_scroller')) select(pick());
}
for (const t of ['scroll', 'scrollend', 'load', 'resize'])
  addEventListener(t, syncPanel, { passive: true });

// TOUCH: tap toggles the chrome, swipe changes photo, double tap zooms.
const frame = $('.stage_frame');
if (coarse) {
  let start, timer;
  // a tap must not follow the next link; only link clicks are cancelled, so
  // the double tap's click on the zoom checkbox still toggles it
  frame.addEventListener(
    'click',
    (e) => e.target.closest('a') && e.preventDefault()
  );
  frame.addEventListener(
    'pointerdown',
    (e) => (start = [e.clientX, e.clientY])
  );
  frame.addEventListener('pointercancel', () => (start = null));
  frame.addEventListener('pointerup', (e) => {
    if (!start) return;
    const [dx, dy] = [e.clientX - start[0], e.clientY - start[1]];
    start = null;
    const zoomed = $('.stage_zoom').checked;
    if (!zoomed && Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy))
      return go(dx < 0 ? 'next' : 'prev');
    if (Math.hypot(dx, dy) > 10) return;
    if (timer) {
      clearTimeout(timer);
      timer = 0;
      return $('.stage_zoom').click();
    }
    timer = setTimeout(() => {
      timer = 0;
      root.dataset.idle == null ? hide() : show();
    }, 260);
  });
}

// KEYS. On the photo: left and right change photos, up opens the panel.
// In the panel: arrows move focus through the photos (the next row is the
// nearest one above or below, so square and justified grids both work),
// Home and End, Enter opens (native link), Escape returns to the photo.
// Focus is the only thing script adds here.
// a step only happens where there is a link: none past either end
function go(rel) {
  const a = $(`.stage_${rel}`);
  if (!a.href) return;
  hide('key');
  step(a.href);
}
// SLIDESHOW: Space starts and stops a timed step through the context. Its
// clock is a CSS animation (stage_play, a hairline that fills over
// --mg-slideshow): when it ends, the next photo comes in and it starts
// again. CSS pauses it while the chrome is shown (pointer movement, a
// tap), a dialog is open or the photo is zoomed, so it resumes when the
// chrome hides again. It stops at the last photo (no wrap), on Space or
// Escape, and when the panel opens.
let bar;
function play(on = !root.hasAttribute('data-play')) {
  if (!on || !$('.stage_next').href) return delete root.dataset.play;
  if (!bar) {
    bar = d.createElement('span');
    bar.className = 'stage_play';
    bar.ariaHidden = 'true';
    bar.addEventListener('animationend', () => {
      const a = $('.stage_next');
      a.href ? step(a.href) : play(false);
    });
    $('.stage').append(bar);
  }
  hide('key');
  replay();
}
// the clock from zero: a bar taken out of the layout and put back starts
// its animation again
function replay() {
  delete root.dataset.play;
  bar.offsetWidth;
  root.dataset.play = '';
}
// RANDOM: r steps to another photo of the context, inside the page; the
// /random/ page does the same for links (and when the context's JSON
// cannot be loaded)
function random() {
  withCtx(
    (c) => {
      const n = c.photos.length;
      if (n < 2) return;
      const i = Math.floor(Math.random() * (n - 1));
      hide('key');
      stepTo(i < c.i ? i : i + 1);
    },
    () => (location.href = `${base}random/${query}`)
  );
}
const palette = () => {
  const p = $('dialog.palette');
  p ? (p.open ? p.close() : p.showModal()) : $('.palette_search')?.focus();
};
const size = (v) => $(`input[name="size"][value="${v}"]`).click();
// the selectable items of the current view: thumbnails, or list rows (each
// row's title link); the current photo's item carries aria-current in both
function listView() {
  return $('input[name="view"][value="list"]').checked;
}
function items() {
  panel();
  return $$(listView() ? '.ledger tbody td:nth-child(2) a' : '.thumbs_link');
}
function pick() {
  const a = items();
  return a.find((x) => x.matches('[aria-current]')) || a[0];
}
// focus an item and scroll only the panel's own scroller to show it
function select(el) {
  if (!el) return;
  el.focus({ preventScroll: true });
  const sc = $('.table_scroller');
  const r = el.getBoundingClientRect();
  const b = sc.getBoundingClientRect();
  const head = $('.table_head').offsetHeight;
  if (r.top < b.top + head || r.bottom > b.bottom)
    sc.scrollTop += r.top + r.height / 2 - (b.top + head + b.bottom) / 2;
}
const toViewer = () => scrollTo({ top: 0, behavior: 'smooth' });
const toPanel = () => {
  $('#grid').scrollIntoView({ behavior: 'smooth' });
  select(pick());
};
const move = (k) => {
  delete root.dataset.pointer;
  const list = items();
  const i = list.indexOf(d.activeElement);
  if (i < 0) return list[0]?.focus();
  let j = { Home: 0, End: list.length - 1 }[k] ?? i;
  if (k === 'ArrowLeft' || k === 'ArrowRight') {
    if (!listView()) j = i + (k === 'ArrowRight' ? 1 : -1);
  } else if (k === 'ArrowUp' || k === 'ArrowDown') {
    const down = k === 'ArrowDown';
    const boxes = list.map((a) => a.getBoundingClientRect());
    const r = boxes[i];
    const tops = boxes
      .map((b) => b.top)
      .filter((t) => (down ? t > r.top + 2 : t < r.top - 2));
    if (!tops.length) return;
    const row = down ? Math.min(...tops) : Math.max(...tops);
    const mid = (b) => Math.abs(b.left + b.width / 2 - r.left - r.width / 2);
    j = boxes.reduce(
      (best, b, n) =>
        Math.abs(b.top - row) < 2 && (best < 0 || mid(b) < mid(boxes[best]))
          ? n
          : best,
      -1
    );
  }
  list[Math.max(0, Math.min(list.length - 1, j))].focus();
};
const keys = {
  ArrowRight: () => go('next'),
  ArrowLeft: () => go('prev'),
  ArrowUp: toPanel,
  z: () => $('.stage_zoom').click(),
  i: () => $('input[name="info"]').click(),
  f: () => $('input[name="fit"]').click(),
  s: () => $('input[name="strip"]').click(),
  1: () => size('small'),
  2: () => size('medium'),
  3: () => size('large'),
  t: () => $('input[name="crop"]:not(:checked)').click(),
  v: () => $('input[name="view"]:not(:checked)').click(),
  '?': () => $('input[name="keys"]').click(),
  g: toPanel,
};
// the viewer's own keys: in the panel, Space scrolls and r does nothing
const viewing = {
  ' ': () => play(),
  r: random,
};
addEventListener('keydown', (e) => {
  const k = e.key;
  const field = e.target.closest('input[type="search"]');
  const mod = e.metaKey || e.ctrlKey || e.altKey;
  if (k === 'Escape') {
    if (root.hasAttribute('data-play')) play(false);
    // in the filter field, the first Escape clears the search
    if (field?.value) {
      e.preventDefault();
      // refuse a cancel from this same key press only (engines differ on
      // whether a prevented Escape still sends one), so the next one closes
      cleared = true;
      setTimeout(() => (cleared = false));
      return clearSearch(field);
    }
    // in the panel, back to the photo; focus leaves the thumbnails, so the
    // next arrow is a viewer key again (the info panel ignores Escape)
    if (root.hasAttribute('data-panel') && !$('dialog[open]')) {
      toViewer();
      $('.stage_frame').focus({ preventScroll: true });
    }
  }
  if (((e.metaKey || e.ctrlKey) && k === 'k') || (k === '/' && !field)) {
    e.preventDefault();
    palette();
  } else if (field || mod) return;
  else if (root.hasAttribute('data-panel') && /^(Arrow|Home$|End$)/.test(k)) {
    e.preventDefault();
    move(k);
  } else if (keys[k]) {
    e.preventDefault();
    keys[k]();
  } else if (viewing[k] && !root.hasAttribute('data-panel') && !e.repeat) {
    // a control reached by keyboard keeps Space (a checkbox toggles)
    const control = e.target.closest('input, button, select, textarea');
    if (k === ' ' && control?.matches(':focus-visible')) return;
    e.preventDefault();
    viewing[k]();
  }
});

// PALETTE: Escape clears a typed search first; the dialog closes on the
// next one (its cancel event is refused while a clear just happened)
let cleared = false;
function clearSearch(f) {
  f.value = '';
  f.dispatchEvent(new Event('input', { bubbles: true }));
}
$('dialog.palette')?.addEventListener('cancel', (e) => {
  const f = $('.palette_search', e.target);
  if (cleared || f.value) {
    e.preventDefault();
    if (f.value) clearSearch(f);
  }
  cleared = false;
});

// PALETTE: typing narrows the chips, Enter opens the first
d.addEventListener('input', (e) => {
  if (!e.target.matches('.palette_search')) return;
  const q = e.target.value.trim().toLowerCase();
  for (const g of $$('.palette_group', e.target.closest('.palette'))) {
    const head = g.firstElementChild.textContent;
    for (const li of $$('li', g))
      li.hidden = !(head + ' ' + li.textContent).toLowerCase().includes(q);
    g.hidden = !$('li:not([hidden])', g);
  }
});
d.addEventListener('submit', (e) => {
  const a = $('li:not([hidden]) .chip', e.target.closest('.palette') || d);
  if (a && $('.palette_search', e.target)?.value) {
    e.preventDefault();
    location.href = a.href;
  }
});

// LIST SORT: rows have to be reordered in the DOM, so this is script. A
// header click sorts by that column, ascending, then descending, then back
// to the context's own order (data-i); values come from data-sort, and
// photos with no value always sort last.
d.addEventListener('click', (e) => {
  const th = e.target.closest('.ledger_sort')?.closest('th');
  if (!th) return;
  const table = th.closest('table');
  const col = th.cellIndex;
  const state = th.getAttribute('aria-sort') || 'none';
  const next = {
    none: 'ascending',
    ascending: 'descending',
    descending: 'none',
  }[state];
  for (const h of table.tHead.rows[0].cells) h.removeAttribute('aria-sort');
  if (next !== 'none') th.setAttribute('aria-sort', next);
  const num = th.dataset.type === 'num';
  const dir = next === 'descending' ? -1 : 1;
  const key = (r) => r.cells[col].dataset.sort;
  const rows = [...table.tBodies[0].rows].sort((a, b) => {
    if (next === 'none') return a.dataset.i - b.dataset.i;
    const [x, y] = [key(a), key(b)];
    if (!x || !y) return !x - !y;
    return dir * (num ? x - y : x.localeCompare(y));
  });
  table.tBodies[0].append(...rows);
});

// POINTER: tooltip follows it, the loupe pans with it, the rail scrubs
let at = [0.5, 0.5];
let drag;
addEventListener('pointermove', (e) => {
  const g = e.target.closest?.('.thumbs');
  if (g && e.pointerType === 'mouse') {
    root.dataset.pointer ??= '';
    g.style.setProperty('--x', e.clientX);
    g.style.setProperty('--y', e.clientY);
  }
  if (drag) return drag.s.scrollTo(drag.x - e.clientX, drag.y - e.clientY);
  const r = frame.getBoundingClientRect();
  at = [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
});
addEventListener('pointerdown', (e) => {
  const s = e.target.closest('.stage_scroller');
  if (s && e.pointerType === 'mouse' && $('.stage_zoom:checked')) {
    drag = { s, x: e.clientX + s.scrollLeft, y: e.clientY + s.scrollTop };
  }
  const rail = e.target.closest('.rail_list');
  if (rail) {
    rail.setPointerCapture(e.pointerId);
    rail.onpointermove = (ev) => {
      const x = rail.getBoundingClientRect().right - 8;
      const a = d.elementFromPoint(x, ev.clientY)?.closest('.rail_link');
      if (a) $(a.hash)?.scrollIntoView({ block: 'center' });
    };
    rail.onpointerup = () => (rail.onpointermove = null);
  }
});
addEventListener('pointerup', () => (drag = null));

// STRIP: the current frame is centered (the scroller clamps the ends). On
// a step the strip, which stays in the page, glides to the new current
// frame (a 550ms ease-out tween); reduced motion moves it at once.
function center(smooth) {
  const id = ++tween;
  const c = $('.strip_link[aria-current]');
  if (!c || !c.offsetWidth) return;
  const l = c.closest('.strip_list');
  const dx = c.getBoundingClientRect().left - l.getBoundingClientRect().left;
  const left = l.scrollLeft + dx - (l.clientWidth - c.offsetWidth) / 2;
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!smooth || still) return l.scrollTo({ left, behavior: 'instant' });
  // a 550ms ease-out tween (smooth scroll has no duration control); the
  // strip's own snapping is paused so it cannot fight the tween
  const from = l.scrollLeft;
  const t0 = performance.now();
  l.style.scrollSnapType = 'none';
  const frame = (t) => {
    if (id !== tween) return;
    const k = Math.min(1, (t - t0) / 550);
    l.scrollLeft = from + (left - from) * (1 - (1 - k) ** 3);
    if (k < 1) requestAnimationFrame(frame);
    else l.style.scrollSnapType = '';
  };
  requestAnimationFrame(frame);
}
center();
if (self.mgReveal) reveal(self.mgReveal, true);
else addEventListener('pagereveal', (e) => reveal(e));
