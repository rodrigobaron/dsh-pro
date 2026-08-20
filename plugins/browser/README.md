# Browsing

`browser` drives a real Chromium tab through Playwright: open a page, read it as
an accessibility snapshot, click, fill, wait, manage tabs, screenshot. It is for
pages that must be *rendered* to be understood — client-side apps, a local dev
server, a visual check. The harness's own `web_search` still handles finding
things, and `web_fetch` stays disabled upstream.

Ten tools is a lot of permanent schema, so they are gated: they mount into an
agent only when it loads the `browser` skill, the same way `show_file` and the
vision tools do.

## Seeing the page

`browser_screenshot` writes a PNG and returns its path — it shows nobody
anything. The path is what makes it useful: the file lands under the **session
workspace** rather than the harness process cwd, which is what puts it inside
the artifact canvas's roots, so `show_file` can render it. Browse, screenshot,
show is the loop.

## Finding a browser

`playwright-core` downloads nothing at install time. On first use the plugin
tries its Playwright-managed Chromium, then an installed Chrome, then Edge, and
if all three are absent it says so and names the one command that fixes it
(`npx playwright install chromium`) rather than downloading software unasked.

The dependency is pinned to `~1.59.1` because that line expects the Chromium
build already present in most Playwright caches. Bumping it is safe — the worst
case is falling back to system Chrome.

## Limits

- **Loopback and private addresses stay reachable**, deliberately: testing a
  local dev server is the main reason to hand an agent a browser. The exception
  is cloud instance-metadata (`169.254.0.0/16`, `metadata.google.internal`),
  which nothing legitimate browses and which hands out credentials to anything
  that asks. That check reads the address as written — a DNS name resolving
  there still gets through, since catching that needs resolution-time
  interception this plugin does not do.
- **`userDataDir` may not be a real browser profile.** Upstream documents this;
  here it throws, because pointing automation at your Chrome profile silently
  hands it every session you are signed in to.
- **No page JavaScript evaluation.** There is no `browser_eval`, on purpose.
- **Page content is data.** The skill body says so to the model, which is a
  mitigation and not a guarantee. Anything consequential — submitting a form,
  entering personal data, downloading, granting a permission — is written as
  ask-the-user-first.
