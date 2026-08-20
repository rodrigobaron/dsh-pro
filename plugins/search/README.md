# Web search

`search` replaces the harness's default web search with ten free engines and
automatic fallback. The default provider needs a `DEEPSEEK_API_KEY`; these need
nothing.

## The row that makes it work

Upstream's own patch notes that `web.searchProvider` must point at its provider
id — then does not ship that override. dsh-base sets
`searchProvider: deepseek-official`, so a plain install leaves every search
still going to DeepSeek. The plugin looks installed and does nothing, which is
the worst kind of broken.

So this package's `cordis.patch.yml` carries the override itself:

```yaml
- id: web
  config:
    searchProvider: ddg
```

`ddg` there is the **provider id**, not the engine. Upstream registers one
provider under that id and routes internally to whichever engine the settings
name, so the row reads `ddg` whatever engine you pick.

Confirm it took with `dsh --profile web --dump-config`: the `web` row's
`searchProvider` should read `ddg`, not `deepseek-official`.

Note this row modifies a base row the plugin does not own — installing web
search takes over web search, which is the point. Removing the plugin
regenerates the patch without it, and the default comes back.

## English defaults

Upstream is tuned for Chinese. Four values carry that, and `scripts/build.mjs`
rewrites each as an asserted exact-string replacement, so a changed upstream
line fails the build instead of quietly shipping Chinese-first search:

| Value | Upstream | Here |
| --- | --- | --- |
| `ACCEPT_LANG` | `zh-CN,zh;q=0.9,en;q=0.8` | `en-US,en;q=0.9` |
| `lang` (settings UI) | `zh` | `en` |
| `bingMarket` | `zh-CN` | `en-US` |
| `region` (DuckDuckGo `kl`) | unset | `us-en` |

`ACCEPT_LANG` is the one that matters most: it goes out on every engine's
request through a single shared fetch helper, so it steers DuckDuckGo, Bing,
SearXNG and AnySearch alike — far more than any per-engine market setting.

The default **engine** changes for the same reason. Upstream picks Bing and
says why: "most stable, optimized for Chinese (`zh-CN`)". That reason does not
survive the switch — and Bing turns out to be the engine that gets answers
*wrong*, silently (see below).

Measured across three queries per engine, tracking availability and
correctness separately, because a returned result is not a right one:

| Engine | Available | Median | Honours `site:` | Answers a question |
| --- | --- | --- | --- | --- |
| `keenable` | 3/3 | 518ms | yes | yes |
| `anysearch` | 3/3 | 1317ms | yes | yes |
| `exa` | 3/3 | 1331ms | yes | yes |
| `tavily` | 3/3 | 1727ms | yes | yes |
| `bing` | 3/3 | 268ms | **no** | yes |
| `ddg` | 2/3 | 943ms | 403 | 403 |
| `ddg-lite` | 1/3 | 3234ms | rate-limited | rate-limited |

The default is `keenable`: fastest of the engines that are actually correct,
and keyless (`KEENABLE_API_KEY` only raises the quota). `ddg` held the spot
briefly on the strength of one good query, then spent the rest of the session
rate-limited. The fallback chain covers a bad day for any of them.

## The fallback chain

Without a time filter the chain is `[preferred, ...paid, ...free]`:

```
preferred -> exa -> tavily -> keenable -> perplexity -> deepseek-official
          -> bing -> anysearch -> ddg -> ddg-lite -> searxng
```

It stops at the first engine returning **more than zero** results — zero counts
as failure — under a 30s budget shared by the whole chain.

"Paid first" is not as odd as it reads. `exa`, `tavily`, and `keenable` all
work keyless (MCP or anonymous tier) and are always tried; a key raises their
quota rather than unlocking them. `perplexity` and `deepseek-official` are the
only two that need one, and without it they are skipped before any request, so
they cost nothing to leave in the chain.

One trap: with a `timeRange`, a preferred engine that cannot time-filter is
dropped from the chain **entirely**, not demoted. Prefer `bing` and ask for
last-week results and bing never runs.

Nothing else emits Chinese: every other Chinese string in the host half is a
comment, and the model-facing text — tool descriptions and the injected
system-prompt section — was already English. The browser half keeps both
dictionaries and switches on `lang`, so Chinese stays available and is simply
no longer the default.

## Bing ignores search operators

Bing does not honour `site:`, `filetype:` or `inurl:` for cookieless requests.
Verified with two header profiles including a full browser fingerprint: it
echoes the query back in `og:title`, then returns generic entity results. It
cannot be fixed from here.

What makes it worth a warning is that **it does not fail**. It returns a
confident, healthy-looking result set for a different query, so the automatic
fallback chain never fires and nothing downstream can tell. On
`site:linkedin.com/in Rodrigo Baron machine learning`, Bing returned ten Olivia
Rodrigo results; `tavily` and `exa` both returned the intended profile first.

Only the model can route around this, so the system-prompt section names the
limitation and the engines to use instead.

Bing results also used to carry `bing.com/ck/a?` redirect URLs rather than the
site found, because every organic result is wrapped in a redirect and the
scraper took the first href in the block. That broke `web_fetch` on a result,
broke dedup, and hid the domain. The build now decodes the destination from the
redirect's base64 `u` parameter, with `<cite>` as a fallback.

## Settings are durable — the patch only seeds a fresh install

`cordis.patch.yml` supplies the **initial** value of the settings namespace.
Once the namespace exists, the stored value wins and changing the patch does
nothing. So a default changed here reaches a new install but not an existing
one, and the engine actually in use is whatever **Settings -> Plugins -> Free
Search** says. Check there first when behaviour does not match the defaults
documented above.

## SearXNG needs your own instance

Upstream ships six public SearXNG instances and none of them work. It is not
rate limiting: SearXNG disables the JSON output format by default, and its bot
limiter rejects anonymous `format=json`. Probed 2026-08-20, all six upstream
defaults plus ten more public instances returned 429 to a **single** request,
403, HTML instead of JSON, or nothing at all. Zero served JSON.

That cost more than one dead engine, because `searxng` sits in the automatic
fallback chain — every fallback spent six pointless requests on third parties
before moving on. The default list is now empty, so it fails in milliseconds
with `no instances configured` instead, and the system prompt tells the model
the engine needs configuring rather than advertising it as free and keyless.

The engine itself is untouched and is genuinely good against a **self-hosted**
SearXNG, where JSON is on and no limiter is in the way. Point
`searxngInstances` at yours.

Engine, API keys, and cache TTL live in **Settings -> Plugins -> Free Search**,
or `/free-search-engine` in the composer. Editing the generated profile patch
is pointless — the installer rewrites it whole on every run.
