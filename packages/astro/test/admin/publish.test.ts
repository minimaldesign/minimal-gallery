import { afterEach, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  CommandResolver,
  PublishChecks,
} from '../../src/admin/server/index.ts';
import { lastUrl } from '../../src/admin/server/jobs.ts';
import { startServer, tempGallery, type TestServer } from './helpers.ts';

let server: TestServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

const checks = async (): Promise<PublishChecks> => ({
  method: 'deploy',
  deploy: {
    wranglerInstalled: true,
    loggedIn: true,
    worker: 'my-gallery',
    accounts: [{ id: 'a'.repeat(32), name: 'Photos' }],
    accountId: 'a'.repeat(32),
    needsAccount: false,
    customDomain: false,
    subdomain: 'yann',
    subdomainKnown: true,
  },
});

/** A stand-in for `minimalgallery publish`: prints, waits a little, exits. */
const fake =
  (code: number): CommandResolver =>
  (job, method) => ({
    command: process.execPath,
    args: [
      '-e',
      `
      const [job, method] = process.argv.slice(1);
      console.log('\\u001b[32m◇\\u001b[39m ' + job + ' with ' + method);
      process.stderr.write('a warning\\r\\n');
      setTimeout(() => {
        console.log('Deployed to https://my-gallery.example.workers.dev.');
        console.log('Done.');
        process.exit(${code});
      }, 150);
      `,
      job,
      String(method),
    ],
  });

describe('publish and connect jobs', () => {
  it('streams the command’s output and ends with the URL', async () => {
    const dir = await tempGallery();
    server = await startServer({
      galleryDir: dir,
      commands: fake(0),
      publishChecks: checks,
    });
    const events = await server.events();
    const info = await server.call('GET', '/publish');
    expect(info.body).toMatchObject({
      method: 'deploy',
      deploy: { worker: 'my-gallery' },
      bucket: null,
      site: null,
      last: null,
      job: null,
    });

    expect(
      (await server.call('POST', '/publish', { method: 'ftp' })).status
    ).toBe(400);
    const started = await server.call('POST', '/publish', { method: 'deploy' });
    expect(started.status).toBe(202);
    const id = started.body.job;
    // One job at a time.
    expect(
      (await server.call('POST', '/publish', { method: 'build' })).status
    ).toBe(409);
    expect((await server.call('POST', '/connect/cloudflare')).status).toBe(409);

    const end = await events.waitFor(
      (e) => e.event === 'job' && e.data.state !== 'running'
    );
    expect(end.data).toEqual({
      job: 'publish',
      id,
      state: 'done',
      url: 'https://my-gallery.example.workers.dev',
      code: 0,
    });
    const lines = events.events
      .filter((e) => e.event === 'log')
      .map((e) => e.data);
    expect(lines).toContainEqual({
      job: 'publish',
      line: '◇ publish with deploy',
    });
    expect(lines).toContainEqual({ job: 'publish', line: 'a warning' });
    expect(lines.at(-1)).toEqual({ job: 'publish', line: 'Done.' });
    // The queue was paused for the job, then resumed.
    expect(
      events.events.some((e) => e.event === 'queue' && e.data.paused)
    ).toBe(true);
    expect((await server.call('GET', '/state')).body.queue.paused).toBe(false);

    const after = await server.call('GET', '/publish');
    expect(after.body.last).toMatchObject({
      method: 'deploy',
      state: 'done',
      url: 'https://my-gallery.example.workers.dev',
      code: 0,
    });
    expect(after.body.job).toMatchObject({ id, state: 'done' });
    expect(after.body.job.lines).toContain('Done.');
    const admin = JSON.parse(
      await readFile(join(dir, '.minimalgallery/cache/admin.json'), 'utf8')
    );
    expect(admin.published).toBe(true);
    expect((await server.call('GET', '/state')).body.firstRun.published).toBe(
      true
    );
  });

  it('reports a failed job with its exit code', async () => {
    const dir = await tempGallery();
    server = await startServer({
      galleryDir: dir,
      commands: fake(3),
      publishChecks: checks,
    });
    const events = await server.events();
    await server.call('POST', '/connect/cloudflare');
    const end = await events.waitFor(
      (e) => e.event === 'job' && e.data.state !== 'running'
    );
    expect(end.data).toMatchObject({
      job: 'connect',
      state: 'failed',
      code: 3,
    });
    expect(end.data.url).toBeUndefined();
  });

  it('says so when the gallery has no minimalgallery command', async () => {
    const dir = await tempGallery();
    server = await startServer({
      galleryDir: dir,
      commands: () => null,
      publishChecks: checks,
    });
    const r = await server.call('POST', '/publish', { method: 'build' });
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/npm install/);
  });

  it('finds the last https address in the output', () => {
    expect(
      lastUrl([
        'see https://dash.cloudflare.com/x',
        'Published https://a.example.com/path).',
        'bye',
      ])
    ).toBe('https://a.example.com/path');
    expect(lastUrl(['nothing here'])).toBeNull();
  });
});
