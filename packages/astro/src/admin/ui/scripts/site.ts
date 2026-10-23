/**
 * The two pages about the site rather than the photos: Settings (the
 * gallery's name and look, the about text, custom.css) and Publish (the
 * method, first-run guidance, the streamed log and the final URL).
 */
import {
  $,
  $$,
  api,
  ApiError,
  app,
  bound,
  count,
  emit,
  status,
} from './core.ts';

/* ------------------------------------------------------------------ */
/* SETTINGS                                                            */
/* ------------------------------------------------------------------ */

interface Settings {
  name: string;
  description: string | null;
  author: string | null;
  site: string | null;
  albumsSort: string;
  defaults: Record<string, string | number | boolean>;
  about: string;
  customCss: string;
}

const settingsForm = $<HTMLFormElement>('[data-form="settings"]');
const cssForm = $<HTMLFormElement>('[data-form="css"]');
const TEXTS = ['name', 'description', 'author', 'site', 'about'] as const;
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
  await save(settingsForm, changes, (saved) =>
    'about' in changes && Object.keys(changes).length === 1
      ? 'Saved to about.md.'
      : `Saved. The preview restarts with the new settings${saved.name ? `, as “${saved.name}”` : ''}.`
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
    emit('refresh');
  } catch (error) {
    status(form, `Not saved: ${(error as Error).message}`);
  } finally {
    submit.removeAttribute('aria-busy');
  }
}

/* ------------------------------------------------------------------ */
/* PUBLISH                                                             */
/* ------------------------------------------------------------------ */

interface PublishInfo {
  method: 'git' | 'deploy' | 'build';
  git: {
    repo: boolean;
    remote: string | null;
    branch: string | null;
    ghInstalled: boolean;
    ghAuthed: boolean;
  };
  deploy: {
    wranglerInstalled: boolean;
    loggedIn: boolean;
    worker: string | null;
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

const guide = (name: string) => $(`[data-guide="${name}"]`, publishForm);

export async function loadPublish() {
  publishForm.setAttribute('aria-busy', 'true');
  status(publishForm, 'Checking GitHub and Cloudflare…');
  try {
    info = await api<PublishInfo>('GET', '/publish');
  } catch (error) {
    status(publishForm, `Could not check: ${(error as Error).message}`);
    return;
  }
  publishForm.removeAttribute('aria-busy');
  const method = field(publishForm, 'method') as RadioNodeList;
  if (!method.value) method.value = info.method;

  const { git, deploy, bucket } = info;
  guide('gh-missing').hidden = git.ghInstalled;
  guide('gh-login').hidden = !git.ghInstalled || git.ghAuthed;
  guide('git-repo').hidden = git.repo;
  const ready = guide('git-ready');
  ready.hidden = !(git.repo && git.ghAuthed);
  ready.textContent = `Signed in to GitHub. Publishing commits the gallery and pushes ${
    git.branch ?? 'the current branch'
  }${git.remote ? ` to ${git.remote}` : ''}.`;
  guide('cf-login').hidden = deploy.loggedIn;
  const cf = guide('cf-ready');
  cf.hidden = !deploy.loggedIn;
  cf.textContent = deploy.wranglerInstalled
    ? `Connected to Cloudflare. Publishing deploys ${deploy.worker ? `the worker “${deploy.worker}”` : 'the site'}.`
    : 'Cloudflare’s tool (wrangler) is not installed in this gallery. Run npm install in the gallery folder, then come back.';

  const bucketSection = $('[data-bucket]', publishForm);
  bucketSection.hidden = !bucket;
  if (bucket) {
    bound('bucket-text', publishForm).textContent = bucket.pending
      ? `Your photos are served from a storage bucket. ${count(bucket.pending, 'file')} ${
          bucket.pending === 1 ? 'waits' : 'wait'
        } to be uploaded; publishing uploads them first.`
      : 'Your photos are served from a storage bucket, and every file is already there.';
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
    showJob(info.job.job, info.job.state);
    log.textContent = info.job.lines.join('\n');
    if (info.job.state !== 'running') ended(info.job);
  }
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
  const busy = state === 'running';
  for (const b of $$<HTMLButtonElement>('button', publishForm))
    b.disabled = busy;
  $('[type="submit"]', publishForm).toggleAttribute('aria-busy', busy);
}

async function start(path: string, body: unknown, kind: 'publish' | 'connect') {
  try {
    const { job } = await api<{ job: string }>('POST', path, body);
    currentJob = job;
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
    jobSection.scrollIntoView({ block: 'nearest' });
  } catch (error) {
    status(
      publishForm,
      error instanceof ApiError && error.status === 409
        ? 'Another publish is running. Wait for it to end.'
        : `Could not start: ${(error as Error).message}`
    );
  }
}

publishForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const method =
    (field(publishForm, 'method') as RadioNodeList).value || info?.method;
  void start('/publish', { method }, 'publish');
});

publishForm.addEventListener('click', (event) => {
  const target = (event.target as Element).closest<HTMLElement>(
    '[data-action]'
  );
  if (target?.dataset.action === 'connect')
    void start('/connect/cloudflare', undefined, 'connect');
  if (target?.dataset.action === 'recheck') void loadPublish();
});

/** A `log` event. Keeps the log scrolled to the end unless you scrolled up. */
export function logLine(data: { job: string; line: string }) {
  if (currentJob && data.job !== currentJob) return;
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
  showJob(data.job, data.state);
  if (data.state !== 'running') ended(data);
}

function ended(data: {
  job: 'publish' | 'connect';
  state: string;
  url?: string;
  code?: number;
}) {
  for (const b of $$<HTMLButtonElement>('button', publishForm))
    b.disabled = false;
  $('[type="submit"]', publishForm).removeAttribute('aria-busy');
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
  if (!button?.dataset.copy) return;
  try {
    await navigator.clipboard.writeText(button.dataset.copy);
    button.dataset.copied = '';
    setTimeout(() => delete button.dataset.copied, 1600);
  } catch {
    /* clipboard refused: the value is on screen to select */
  }
});

export const publishRoute = () => app.route === 'publish';
