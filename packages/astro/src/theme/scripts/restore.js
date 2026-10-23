(() => {
  const r = document.documentElement;
  try {
    for (const n of ['fit', 'strip', 'crop', 'view', 'size', 'info', 'keys'])
      if (localStorage['mg-' + n]) r.dataset[n] = localStorage['mg-' + n];
    if (sessionStorage.mgIdle) r.dataset.idle = 'key';
  } catch {}
  r.dataset.script = '';
  if (r.dataset.start || location.hash == '#grid') r.dataset.panel = '';
  addEventListener('pagereveal', (e) => (self.mgReveal = e), { once: true });
  self.mgStrip = (n, ps) => {
    const d = n.dataset;
    const c = new URLSearchParams(location.search).get('in');
    const q = c || d.in;
    const on = r.dataset.strip
      ? r.dataset.strip == 'on'
      : getComputedStyle(r).getPropertyValue('--mg-strip').trim() == 'on';
    try {
      ps ??=
        on && JSON.parse(sessionStorage['mgCtx-' + (c || d.context)]).photos;
    } catch {}
    if (!ps || n.querySelector('li')) return;
    const e = (s) => String(s).replace(/[&<"]/g, (c) => `&#${c.charCodeAt()};`);
    const k = q ? '?in=' + encodeURIComponent(q).replace(/%2F/g, '/') : '';
    n.firstElementChild.innerHTML = ps
      .map(
        (p) =>
          `<li class="strip_item" style="--ar: ${p.ar}; --photo: ${p.color}"><a class="strip_link" href="${p.href + k}"${p.href == d.photo ? ' aria-current="page"' : ''}><img class="strip_image" src="${p.thumb}" alt="${e(p.title)}" loading="lazy"></a></li>`
      )
      .join('');
  };
})();
