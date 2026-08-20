# dsh-pro

An opinionated coding agent built on top of
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

DSH ships the runtime — sessions, agents, tools, a web GUI — and leaves the
product decisions open. dsh-pro makes them: a file artifact panel, git review,
web search that needs no API key, conversation rewind, scheduled routines, deep
research. The result covers roughly the ground Claude Code or Codex does,
assembled entirely from plugin seams rather than a fork, so upstream stays
upgradeable.

## Install

Needs a working `dsh` install and Node.

```bash
git clone https://github.com/rodrigobaron/dsh-pro
cd dsh-pro
./install.sh
```

Then restart `dsh web`, and force-refresh the browser once for the client-side
plugins.

The installer builds every plugin under `plugins/`, installs it into
`~/.dsh/profiles/node_modules`, and regenerates the profile patch. It creates no
agent preset and does not change which preset is default. It is idempotent — the
patch is written whole on every run, so re-running never accumulates duplicate
rows. Set `DSH_HOME` to target a different harness home.

## Plugins

**Interface**

| Plugin | What it adds |
| --- | --- |
| [`tool-file-canvas`](plugins/tool-file-canvas/README.md) | the `show_file` tool and the contained `GET /canvas/file` reader |
| `client-ui-file-canvas` | the artifact panel and its renderers |
| `client-ui-layout-wide` | a wide, resizable details column |
| [`git-review`](plugins/git-review/README.md) | a Git tab: review the diff, stage, discard, commit, push |
| `context` | a context dashboard tab and the `/context` command |
| `archived-sessions` | a session manager in Settings: browse, archive, delete |
| [`notification`](plugins/notification/README.md) | desktop notifications when a session finishes a turn |

**Agent capabilities**

| Plugin | What it adds |
| --- | --- |
| [`search`](plugins/search/README.md) | web search over ten free engines with automatic fallback, no API key |
| [`browser`](plugins/browser/README.md) | drive a real Chromium tab: open, read, click, fill, screenshot |
| `vision-toolkit` | image Q&A, OCR, grounding, pixel diff |
| [`deep-research`](plugins/deep-research/README.md) | `/deep-research <topic>`: a controlled multi-round search loop |

**Conversation control**

| Plugin | What it adds |
| --- | --- |
| [`rewind`](plugins/rewind/README.md) | a rewind button on every user message: drop it and everything after |
| [`rewind-picker`](plugins/rewind/README.md) | the `/rewind` command: pick the message to rewind to from a list |
| [`routines`](plugins/routines/README.md) | scheduled agent routines: a cron engine that fires real sessions |
| [`at-file`](plugins/at-file/README.md) | `@path` references in the composer, without reading the file |

Each plugin is self-contained. Nothing depends on `reference/`, which holds
upstream checkouts consulted while porting and is not distributed.

## Docs

- [Development](docs/development.md) — adding a plugin, the build contract, type-checking
- [Language](docs/language.md) — English by default, and why that is not enforced

## Thanks

This repository stands on other people's work. Nine of its plugins began as
someone else's, and the ones written from scratch were shaped by reading them.

- [bowenliang123/dsh-context](https://github.com/bowenliang123/dsh-context) — the context dashboard and the `/context` command
- [Zephyr-vibe/dsh-archived-sessions](https://github.com/Zephyr-vibe/dsh-archived-sessions) — session management, disk accounting, and lineage
- [Anionex/dsh-vision-toolkit](https://github.com/Anionex/dsh-vision-toolkit) and the `agent-vision-toolkit` it packages — eyes for a text-only agent
- [omdsh-dev/dsh-at-file](https://github.com/omdsh-dev/dsh-at-file) — `@path` references, and the pre-step injection pattern `deep-research` borrows
- [DDDMUC/dsh-free-search](https://github.com/DDDMUC/dsh-free-search) — ten search engines with no API key, and the fallback chain behind them
- [omdsh-dev/dsh-notification](https://github.com/omdsh-dev/dsh-notification) — desktop notifications and their rule engine
- [omdsh-dev/dsh-recall](https://github.com/omdsh-dev/dsh-recall) — conversation rewind, and the user-bubble renderer it shadows to place a button there
- [linxin666/dsh-timer-agent](https://github.com/linxin666/dsh-timer-agent) — the scheduled-agent engine, and its at-most-once firing discipline
- [Clizo1209/dsh-playwright-browser](https://github.com/Clizo1209/dsh-playwright-browser) — browser automation with semantic locators

Thanks also to [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent),
whose cron design `dsh-timer-agent` follows and which therefore shapes
`routines` here, and to the
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) team, whose
plugin seams made every one of these possible without a fork.

## License

[MIT](LICENSE), except where a plugin is derived from someone else's work. Those
keep their upstream license and carry a NOTICE recording exactly what changed:

| Plugin | Upstream | License |
| --- | --- | --- |
| `context` | [bowenliang123/dsh-context](https://github.com/bowenliang123/dsh-context) | Apache-2.0 |
| `archived-sessions` | [Zephyr-vibe/dsh-archived-sessions](https://github.com/Zephyr-vibe/dsh-archived-sessions) | MIT |
| `vision-toolkit` | [Anionex/dsh-vision-toolkit](https://github.com/Anionex/dsh-vision-toolkit) | MIT |
| `at-file` | [omdsh-dev/dsh-at-file](https://github.com/omdsh-dev/dsh-at-file) | MIT |
| `search` | [DDDMUC/dsh-free-search](https://github.com/DDDMUC/dsh-free-search) | MIT |
| `notification` | [omdsh-dev/dsh-notification](https://github.com/omdsh-dev/dsh-notification) | MIT |
| `rewind` | [omdsh-dev/dsh-recall](https://github.com/omdsh-dev/dsh-recall) | MIT |
| `routines` | [linxin666/dsh-timer-agent](https://github.com/linxin666/dsh-timer-agent) | MIT |
| `browser` | [Clizo1209/dsh-playwright-browser](https://github.com/Clizo1209/dsh-playwright-browser) | MIT |
