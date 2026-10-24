/** wrangler output for the tests. Nothing here runs wrangler. */

// Captured from wrangler 4.152, with the account details replaced.
export const WHOAMI_ONE = ` ⛅️ wrangler 4.152.0
────────────────────
Getting User settings...
👋 You are logged in with an OAuth Token, associated with the email someone@example.com.
🔐 Credentials are stored in: /home/someone/.wrangler/config/default.toml
┌─────────────────────────────────┬──────────────────────────────────┐
│ Account Name                    │ Account ID                       │
├─────────────────────────────────┼──────────────────────────────────┤
│ Someone@example.com's Account   │ 0123456789abcdef0123456789abcdef │
└─────────────────────────────────┴──────────────────────────────────┘
🔓 Token Permissions:
Scope (Access)
- user (read)
- account (read)
- workers (write)
`;

export const WHOAMI_TWO = ` ⛅️ wrangler 4.152.0
────────────────────
Getting User settings...
👋 You are logged in with an OAuth Token, associated with the email someone@example.com.
┌─────────────────────────────────┬──────────────────────────────────┐
│ Account Name                    │ Account ID                       │
├─────────────────────────────────┼──────────────────────────────────┤
│ Studio                          │ aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa │
│ Someone@example.com's Account   │ bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb │
└─────────────────────────────────┴──────────────────────────────────┘
`;

export const WHOAMI_LOGGED_OUT = ` ⛅️ wrangler 4.152.0
────────────────────
Getting User settings...
You are not authenticated. Please run \`wrangler login\`.
`;

export const R2_DISABLED = `
✘ [ERROR] A request to the Cloudflare API (/accounts/0123456789abcdef0123456789abcdef/r2/buckets) failed.

  Please enable R2 through the Cloudflare Dashboard. [code: 10042]

  If you think this is a bug, please open an issue at:
  https://github.com/cloudflare/workers-sdk/issues/new/choose
`;

export const BUCKET_EXISTS = `
✘ [ERROR] A request to the Cloudflare API (/accounts/0123456789abcdef0123456789abcdef/r2/buckets) failed.

  The bucket you tried to create already exists, and you own it. [code: 10004]
`;

export const NOT_LOGGED_IN_CREATE = `
✘ [ERROR] In a non-interactive environment, it's necessary to set a CLOUDFLARE_API_TOKEN environment variable for wrangler to work. Please go to https://developers.cloudflare.com/fundamentals/api/get-started/create-token/ for instructions on how to create an api token, and assign its value to CLOUDFLARE_API_TOKEN.
`;
