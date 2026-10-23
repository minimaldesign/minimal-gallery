import { describe, expect, it } from 'vitest';
import { nextSteps, type Outcome } from '../src/steps.ts';
import type { Answers } from '../src/templates.ts';

describe('next steps', () => {
  const answers: Answers = {
    name: 'Photos',
    author: '',
    host: 'cloudflare',
    storage: 'bucket',
    bucket: { name: 'photos-media', domain: '', accountId: '' },
    publish: 'git',
    packageManager: 'npm',
  };
  const outcome: Outcome = {
    folder: 'photos',
    dir: '/home/someone/photos',
    installed: true,
    launcher: false,
    git: { status: 'committed' },
  };

  it('lists the login, the bucket and the account id when wrangler could not', () => {
    const steps = nextSteps(answers, {
      ...outcome,
      cloudflare: { login: 'logged-out', accountId: '', bucket: 'not-tried' },
    });
    expect(steps).toContain('npx wrangler login');
    expect(steps).toContain('npx wrangler r2 bucket create photos-media');
    expect(steps).toContain('copy your account id from npx wrangler whoami');
  });

  it('leaves out what is done', () => {
    const steps = nextSteps(
      {
        ...answers,
        bucket: {
          name: 'photos-media',
          domain: 'media.example.org',
          accountId: 'a'.repeat(32),
        },
        token: { accessKeyId: 'id', secretAccessKey: 'secret' },
      },
      {
        ...outcome,
        cloudflare: {
          login: 'logged-in',
          accountId: 'a'.repeat(32),
          bucket: 'created',
        },
      }
    );
    expect(steps).not.toContain('wrangler login');
    expect(steps).not.toContain('bucket create');
    expect(steps).not.toContain('account id');
    expect(steps).not.toContain('API token');
    expect(steps).not.toContain('publicUrl');
    expect(steps).not.toContain('git init');
    expect(steps).toContain(
      'npx wrangler r2 bucket domain add photos-media --domain media.example.org --zone-id <zone id>'
    );
    expect(steps).toContain(
      'R2, photos-media, Settings, Custom Domains, Connect Domain'
    );
    expect(steps).toContain('gh repo create --private --source . --push');
    expect(steps).toContain('Workers and Pages, Create, Import a repository');
    expect(steps).toContain(
      'Build command: npm run build. Deploy command: npx wrangler deploy.'
    );
    // Numbered from 1, with the publishing steps after the first two.
    expect(steps).toMatch(/^ {2}1\. cd photos$/m);
    expect(steps).toMatch(/^ {2}3\. Connect media\.example\.org/m);
  });

  it('says how to enable R2 when it is off', () => {
    const steps = nextSteps(answers, {
      ...outcome,
      cloudflare: {
        login: 'logged-in',
        accountId: 'a'.repeat(32),
        bucket: 'r2-disabled',
      },
    });
    expect(steps).toContain('Enable R2 in the Cloudflare dashboard');
    expect(steps).toContain('npx wrangler r2 bucket create photos-media');
    expect(steps).not.toContain('wrangler login');
  });

  it('asks for a public repository for GitHub Pages', () => {
    const steps = nextSteps(
      { ...answers, host: 'github', storage: 'repo', bucket: undefined },
      outcome
    );
    expect(steps).toContain('gh repo create --public --source . --push');
    expect(steps).toContain('set the source to GitHub Actions');
    expect(steps).not.toContain('bucket');
  });

  it('gives the commands git could not run', () => {
    const steps = nextSteps(answers, {
      ...outcome,
      git: {
        status: 'failed',
        message: 'fatal: unable to auto-detect email address',
      },
    });
    expect(steps).toContain(
      'git said: fatal: unable to auto-detect email address'
    );
    expect(steps).toContain('git add -A && git commit -m "Create the gallery"');
  });
});
