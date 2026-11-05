/**
 * Keeps the benches to the site under test: every browser context the
 * benches open answers requests to other hosts itself, with nothing. The gallery's pages load
 * Plausible from analytics.minimaldesign.net; in a headless run that host
 * may be unreachable, which holds the `load` event until the timeout, and
 * when it is reachable the benches would count as visits.
 */
export function siteOnly(browser, siteUrl) {
  const host = new URL(siteUrl).hostname;
  const local = new Set([host, 'localhost', '127.0.0.1']);
  const open = browser.newContext.bind(browser);
  browser.newContext = async (options) => {
    const context = await open(options);
    await context.route(
      (url) => !local.has(url.hostname),
      // an empty answer rather than an abort, which Chromium logs as an error
      (route) => route.fulfill({ status: 204, body: '' })
    );
    return context;
  };
  return browser;
}
