/**
 * The two pages about the site rather than the photos: Settings (the
 * gallery's name and look, custom.css) and Publish (the
 * method, first-run guidance, the streamed log and the final URL).
 */
import { $, $$, api, ApiError, bound, count, emit, status } from './core.ts';

/* ------------------------------------------------------------------ */
/* SETTINGS                                                            */
/* ------------------------------------------------------------------ */

interface Settings {
  name: string;
  description: string | null;
  author: string | null;
  site: string | null;
  albumsSort: string;
  saveEdits: 'sidecar' | 'photo';
  defaults: Record<string, string | number | boolean>;
  customCss: string;
}

const settingsForm = $<HTMLFormElement>('[data-form="settings"]');
const cssForm = $<HTMLFormElement>('[data-form="css"]');
const TEXTS = ['name', 'description', 'author', 'site'] as const;
const DEFAULTS = ['fit', 'strip', 'crop', 'view', 'size', 'backdrop'];
let settings: Settings | null = null;

const field = (form: HTMLFormElement, name: string) =>
  form.elements.namedItem(name) as HTMLInputElement | RadioNodeList | null;

export async function loadSettings() {
  try {
    settings = await api<Settings>('GET', '/settings');
  } catch (error) {
    status(
      settingsForm,
      `The settings could not be read: ${(error as Error).message}`
    );
    return;
  }
  if (settingsForm.dataset.dirty === undefined) fillSettings();
  void showSidecarEdits();
  if (cssForm.dataset.dirty === undefined)
    (field(cssForm, 'customCss') as HTMLInputElement).value =
      settings.customCss;
  settingsForm.removeAttribute('aria-busy');
  cssForm.removeAttribute('aria-busy');
}

function fillSettings() {
  if (!settings) return;
  for (const name of TEXTS)
    (field(settingsForm, name) as HTMLInputElement).value =
      settings[name] ?? '';
  (field(settingsForm, 'albumsSort') as RadioNodeList).value =
    settings.albumsSort;
  (field(settingsForm, 'saveEdits') as RadioNodeList).value =
    settings.saveEdits;
  for (const key of DEFAULTS)
    (field(settingsForm, key) as RadioNodeList).value = String(
      settings.defaults[key]
    );
}

for (const form of [settingsForm, cssForm])
  form.addEventListener('input', () => {
    form.dataset.dirty = '';
    status(form, 'Not saved yet.');
  });

settingsForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!settings) return;
  if (!settingsForm.reportValidity()) return;
  const changes: Record<string, unknown> = {};
  for (const name of TEXTS) {
    const value = (field(settingsForm, name) as HTMLInputElement).value.trim();
    if (value !== (settings[name] ?? '').trim()) changes[name] = value || null;
  }
  const sort = (field(settingsForm, 'albumsSort') as RadioNodeList).value;
  if (sort && sort !== settings.albumsSort) changes.albumsSort = sort;
  const saveEdits = (field(settingsForm, 'saveEdits') as RadioNodeList).value;
  if (saveEdits && saveEdits !== settings.saveEdits)
    changes.saveEdits = saveEdits;
  const defaults: Record<string, unknown> = {};
  for (const key of DEFAULTS) {
    const raw = (field(settingsForm, key) as RadioNodeList).value;
    if (!raw || raw === String(settings.defaults[key])) continue;
    defaults[key] =
      key === 'strip' ? raw === 'true' : key === 'size' ? Number(raw) : raw;
  }
  if (Object.keys(defaults).length) changes.defaults = defaults;
  if (!Object.keys(changes).length) {
    status(settingsForm, 'Nothing to save.');
    return;
  }
  await save(
    settingsForm,
    changes,
    (saved) =>
      `Saved. The preview restarts with the new settings${saved.name ? `, as “${saved.name}”` : ''}.`
  );
});

cssForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const customCss = (field(cssForm, 'customCss') as HTMLInputElement).value;
  if (settings && customCss === settings.customCss) {
    status(cssForm, 'Nothing to save.');
    return;
  }
  await save(
    cssForm,
    { customCss },
    () => 'Saved to custom.css. The preview has it now.'
  );
});

async function save(
  form: HTMLFormElement,
  changes: Record<string, unknown>,
  done: (saved: Settings) => string
) {
  const submit = $<HTMLButtonElement>('[type="submit"]', form);
  submit.setAttribute('aria-busy', 'true');
  try {
    settings = await api<Settings>('PUT', '/settings', changes);
    delete form.dataset.dirty;
    status(form, done(settings));
    void showSidecarEdits();
    emit('refresh');
  } catch (error) {
    status(form, `Not saved: ${(error as Error).message}`);
  } finally {
    submit.removeAttribute('aria-busy');
  }
}

/**
 * With edits saved inside the photos, offer to move what the sidecars hold
 * there too, so each value has one place.
 */
async function showSidecarEdits() {
  const box = $<HTMLElement>('[data-sidecar-edits]', settingsForm);
  if (settings?.saveEdits !== 'photo') {
    box.hidden = true;
    return;
  }
  let photos = 0;
  try {
    ({ photos } = await api<{ photos: number }>('GET', '/edits/sidecars'));
  } catch {
    // Not worth an error: the offer comes back on the next visit.
  }
  box.hidden = photos === 0;
  bound('sidecar-edits', box).textContent =
    `${count(photos, 'photo has its', 'photos have their')} details in an .xmp file next to it, from before.`;
}

$<HTMLButtonElement>(
  '[data-action="embed-sidecars"]',
  settingsForm
).addEventListener('click', async (event) => {
  const button = event.currentTarget as HTMLButtonElement;
  button.setAttribute('aria-busy', 'true');
  try {
    const { moved, failed } = await api<{
      moved: number;
      failed: Array<{ path: string; message: string }>;
    }>('POST', '/edits/sidecars/embed');
    status(
      settingsForm,
      failed.length
        ? `Moved into ${count(moved, 'photo', 'photos')}. Not moved: ${failed.map((f) => `${f.path} (${f.message})`).join(', ')}.`
        : `Moved into ${count(moved, 'photo', 'photos')}.`
    );
    emit('refresh');
  } catch (error) {
    status(settingsForm, `Not moved: ${(error as Error).message}`);
  } finally {
    button.removeAttribute('aria-busy');
    void showSidecarEdits();
  }
});

/* ------------------------------------------------------------------ */
/* PUBLISH                                                             */
/* ------------------------------------------------------------------ */

interface PublishInfo {
  method: 'deploy' | 'build';
  deploy: {
    wranglerInstalled: boolean;
    loggedIn: boolean;
    worker: string | null;
    accounts: { id: string; name: string }[];
    accountId: string | null;
    needsAccount: boolean;
    customDomain: boolean;
    subdomain: string | null;
    subdomainKnown: boolean;
  };
  bucket: { mode: 's3'; credentials: boolean; pending: number } | null;
  site: string | null;
  last: {
    method: string;
    state: 'done' | 'failed';
    url: string | null;
    at: string;
  } | null;
  job: {
    id: string;
    job: 'publish' | 'connect';
    state: 'running' | 'done' | 'failed';
    lines: string[];
    url?: string;
    code?: number;
  } | null;
}

const publishForm = $<HTMLFormElement>('[data-form="publish"]');
const jobSection = $('[data-job]');
const log = $('[data-log]');
let info: PublishInfo | null = null;
let currentJob: string | null = null;
let currentKind: 'publish' | 'connect' | null = null;

const guide = (name: string) => $(`[data-guide="${name}"]`, publishForm);

export async function loadPublish() {
  publishForm.setAttribute('aria-busy', 'true');
  status(publishForm, 'Checking Cloudflare…');
  try {
    info = await api<PublishInfo>('GET', '/publish');
  } catch (error) {
    status(publishForm, `Could not check: ${(error as Error).message}`);
    return;
  }
  publishForm.removeAttribute('aria-busy');
  const method = field(publishForm, 'method') as RadioNodeList;
  if (!method.value) method.value = info.method;

  const { deploy, bucket } = info;
  guide('cf-login').hidden = deploy.loggedIn;
  // after the login: which account, then the workers.dev name, once
  const step = cloudflareStep(deploy);
  guide('cf-account').hidden = step !== 'account';
  if (step === 'account') {
    const select = bound<HTMLSelectElement>('cf-accounts', publishForm);
    select.replaceChildren(
      ...deploy.accounts.map((a) => new Option(a.name, a.id))
    );
  }
  guide('cf-subdomain').hidden = step !== 'subdomain';
  showAddress();
  const cf = guide('cf-ready');
  cf.hidden = step !== 'ready';
  const address =
    deploy.subdomain && deploy.worker
      ? `https://${deploy.worker}.${deploy.subdomain}.workers.dev`
      : null;
  cf.textContent = deploy.wranglerInstalled
    ? `Connected to Cloudflare. Publishing uploads ${deploy.worker ? `the worker “${deploy.worker}”` : 'the site'}${address ? `, served at ${address}` : ''}.`
    : 'Cloudflare’s tool (wrangler) is not installed in this gallery. Run npm install in the gallery folder, then come back.';

  const bucketSection = $('[data-bucket]', publishForm);
  bucketSection.hidden = !bucket;
  if (bucket) {
    bound('bucket-text', publishForm).textContent = bucket.pending
      ? `Your photos are served from photo storage. ${count(bucket.pending, 'file')} ${
          bucket.pending === 1 ? 'waits' : 'wait'
        } to be uploaded; publishing uploads them first.`
      : 'Your photos are served from photo storage, and every file is already there.';
    $('[data-bucket-keys]', publishForm).hidden = bucket.credentials;
  }

  if (!currentJob) {
    status(
      publishForm,
      info.last
        ? `Last ${info.last.state === 'done' ? 'published' : 'tried'} ${new Date(info.last.at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}${info.last.url ? `, at ${info.last.url}` : ''}.`
        : 'Not published yet.'
    );
  }
  if (info.job && (!currentJob || currentJob === info.job.id)) {
    currentJob = info.job.id;
    currentKind = info.job.job;
    showJob(info.job.job, info.job.state);
    log.textContent = info.job.lines.join('\n');
    if (info.job.state !== 'running') ended(info.job);
  }
}

/** A workers.dev name, as Cloudflare takes it. */
const SUBDOMAIN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** What Cloudflare still needs before a first upload. */
function cloudflareStep(
  deploy: PublishInfo['deploy']
): 'login' | 'account' | 'subdomain' | 'ready' {
  if (!deploy.loggedIn) return 'login';
  if (deploy.needsAccount) return 'account';
  if (!deploy.customDomain && deploy.subdomainKnown && !deploy.subdomain)
    return 'subdomain';
  return 'ready';
}

/** The address the typed workers.dev name gives. */
function showAddress() {
  const input = field(publishForm, 'subdomain') as HTMLInputElement;
  const name = input.value.trim() || 'your-name';
  bound('cf-address', publishForm).textContent = `https://${
    info?.deploy.worker ?? 'gallery'
  }.${name}.workers.dev`;
}

/** Change a publish setting, then check again. */
async function saveSetting(
  path: string,
  method: 'PUT' | 'POST',
  body: Record<string, unknown>,
  done: string
) {
  try {
    await api(method, path, body);
    status(publishForm, done);
  } catch (error) {
    status(publishForm, (error as Error).message);
    return;
  }
  await loadPublish();
}

function showJob(kind: 'publish' | 'connect', state: string) {
  jobSection.hidden = false;
  bound('job-title').textContent =
    kind === 'connect'
      ? state === 'running'
        ? 'Connecting Cloudflare'
        : 'Connect Cloudflare'
      : state === 'running'
        ? 'Publishing'
        : 'Publish';
  setBusy(state === 'running');
}

function setBusy(busy: boolean) {
  for (const b of $$<HTMLButtonElement>('button', publishForm))
    b.disabled = busy;
  const submit = $('[type="submit"]', publishForm);
  if (busy) submit.setAttribute('aria-busy', 'true');
  else submit.removeAttribute('aria-busy');
}

async function start(path: string, body: unknown, kind: 'publish' | 'connect') {
  // the log can start before the answer does: clear it first
  currentJob = null;
  currentKind = kind;
  log.textContent = '';
  $('[data-result]').hidden = true;
  $('[data-failed]').hidden = true;
  showJob(kind, 'running');
  status(
    publishForm,
    kind === 'publish'
      ? 'Publishing…'
      : 'Waiting for Cloudflare in your browser…'
  );
  try {
    const { job } = await api<{ job: string }>('POST', path, body);
    currentJob ??= job;
    jobSection.scrollIntoView({ block: 'nearest' });
  } catch (error) {
    setBusy(false);
    currentKind = null;
    jobSection.hidden = !log.textContent;
    // a 409 says why in words meant for the reader (another job runs, the
    // tool is missing); anything else is unexpected
    status(
      publishForm,
      error instanceof ApiError && error.status === 409
        ? error.message
        : `Could not start: ${(error as Error).message}`
    );
  }
}

publishForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const method =
    (field(publishForm, 'method') as RadioNodeList).value || info?.method;
  if (method === 'deploy' && info) {
    const step = cloudflareStep(info.deploy);
    if (step !== 'ready') {
      const name = step === 'login' ? 'cf-login' : `cf-${step}`;
      guide(name).scrollIntoView({ block: 'nearest' });
      status(
        publishForm,
        step === 'login'
          ? 'Connect Cloudflare first.'
          : step === 'account'
            ? 'Choose the Cloudflare account first.'
            : 'Choose your workers.dev address first.'
      );
      return;
    }
  }
  void start('/publish', { method }, 'publish');
});

// the method is a setting of the gallery, kept in its package.json
publishForm.addEventListener('change', (event) => {
  const target = event.target as HTMLInputElement;
  if (target.name !== 'method') return;
  void saveSetting(
    '/publish/settings',
    'PUT',
    { method: target.value },
    'Saved as how this gallery publishes.'
  );
});

publishForm.addEventListener('input', (event) => {
  if ((event.target as HTMLInputElement).name === 'subdomain') showAddress();
});

// Enter in the workers.dev name registers it rather than publishing
publishForm.addEventListener('keydown', (event) => {
  const target = event.target as HTMLInputElement;
  if (event.key !== 'Enter' || target.name !== 'subdomain') return;
  event.preventDefault();
  $<HTMLButtonElement>('[data-action="subdomain"]', publishForm).click();
});

publishForm.addEventListener('click', (event) => {
  const target = (event.target as Element).closest<HTMLElement>(
    '[data-action]'
  );
  if (target?.dataset.action === 'connect')
    void start('/connect/cloudflare', undefined, 'connect');
  if (target?.dataset.action === 'recheck') void loadPublish();
  if (target?.dataset.action === 'account')
    void saveSetting(
      '/publish/settings',
      'PUT',
      {
        accountId: bound<HTMLSelectElement>('cf-accounts', publishForm).value,
      },
      'Saved the account in wrangler.jsonc.'
    );
  if (target?.dataset.action === 'subdomain') {
    const input = field(publishForm, 'subdomain') as HTMLInputElement;
    if (!SUBDOMAIN.test(input.value.trim())) {
      status(
        publishForm,
        'Use lowercase letters, digits and dashes, like yann-photos.'
      );
      input.focus();
      return;
    }
    void saveSetting(
      '/publish/subdomain',
      'POST',
      { name: input.value.trim() },
      'Your workers.dev address is ready.'
    );
  }
});

/** A `log` event. Keeps the log scrolled to the end unless you scrolled up. */
export function logLine(data: { job: string; line: string }) {
  // log events name the kind of job; one job runs at a time
  if (data.job !== currentKind) return;
  const atEnd = log.scrollHeight - log.scrollTop - log.clientHeight < 24;
  log.textContent += (log.textContent ? '\n' : '') + data.line;
  if (atEnd) log.scrollTop = log.scrollHeight;
}

/** A `job` event. */
export function jobEvent(data: {
  job: 'publish' | 'connect';
  id: string;
  state: 'running' | 'done' | 'failed';
  url?: string;
  code?: number;
}) {
  if (currentJob && data.id !== currentJob) return;
  currentJob = data.id;
  currentKind = data.job;
  showJob(data.job, data.state);
  if (data.state !== 'running') ended(data);
}

function ended(data: {
  job: 'publish' | 'connect';
  state: string;
  url?: string;
  code?: number;
}) {
  setBusy(false);
  if (data.job === 'connect') {
    status(
      publishForm,
      data.state === 'done'
        ? 'Cloudflare is connected.'
        : 'Cloudflare is not connected. The log says why.'
    );
    void loadPublish();
    return;
  }
  if (data.state === 'done') {
    const url = data.url ?? info?.site ?? '';
    const result = $('[data-result]');
    result.hidden = !url;
    const link = bound<HTMLAnchorElement>('url');
    link.href = url;
    link.textContent = url;
    bound('url-text').textContent = url;
    bound('url-copy').dataset.copy = url;
    status(
      publishForm,
      url ? 'Published.' : 'Published. Your host has the new site.'
    );
  } else {
    $('[data-failed]').hidden = false;
    status(
      publishForm,
      `Publishing stopped${data.code ? ` (exit code ${data.code})` : ''}.`
    );
  }
  emit('refresh');
}

/* copy buttons */
document.addEventListener('click', async (event) => {
  const button = (event.target as Element).closest<HTMLElement>('[data-copy]');
  const text = button?.dataset.copy;
  if (!button || !text) return;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // no clipboard access (an older engine, or a denied permission)
    const area = document.createElement('textarea');
    area.value = text;
    area.className = 'a11y-srOnly';
    document.body.append(area);
    area.select();
    const copied = document.execCommand('copy');
    area.remove();
    if (!copied) return;
  }
  button.dataset.copied = '';
  setTimeout(() => delete button.dataset.copied, 1600);
});
