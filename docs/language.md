# Language

## The primitives default to Chinese

`CodeBlock`, the fenced blocks inside `MarkdownText`, and `HoverCard` default
their copy labels to Simplified Chinese:

```js
function CodeBlock({ code, lang, className, copyLabel = <Chinese>, copiedLabel = <Chinese> })
```

These are **parameter defaults, not localized strings** — they ignore the
interface language entirely, so any caller that omits them ships Chinese into
an English UI. That is how a Markdown artifact came to render its code fences
with a Simplified Chinese copy button.

Passing the labels is the only fix available from a plugin. `MarkdownText`
takes `codeLabels: { copyLabel, copiedLabel }`, which reaches the fences it
renders internally. This repository keeps one `CODE_LABELS` constant so a whole
file rendered as code and a fence inside a Markdown file cannot drift apart.

The harness also defaults a reconnect banner to
a Simplified Chinese string. Nothing here renders it, and no plugin can override
a component it does not call — if it appears while disconnected, that is
upstream's string.


This repository writes English only, and English is the default. It does not
**force** English. The harness keeps its own language selector, and a user who
has configured Chinese keeps Chinese — that setting is theirs to make.

Those two facts have to coexist, and here is how. Every client plugin here
registers its English dictionary under *both* locale ids:

```ts
ctx.locale.register(NS, { en: DICT_EN, zh: DICT_EN })
```

Selecting Chinese then leaves the harness's own interface in Chinese and these
plugins in English. The alternative is worse: an unregistered `zh` namespace
renders raw message keys like `git.commit.button`. Showing English is honest
about there being no translation; showing keys is just broken.

An earlier `english-only` plugin pinned the locale instead. Pinning froze the
UI, and it overrode a choice belonging to the user, so it is gone. Nothing
replaced it, because nothing needed to: what keeps the repository English is
that only English is written, not a switch that prevents anything else.

The repackaged plugins arrived with Chinese dictionaries, which a locale of
`zh` would have selected. That Chinese has been removed or translated, so
switching languages no longer resurrects it.

Chinese survives in four places, all of them deliberate:

| File | Why |
| --- | --- |
| `vision-toolkit/upstream/vendor/agent-vision-toolkit/**` | hash-verified. `UPSTREAM_MANIFEST.json` records each file's sha256 and an aggregate the plugin checks at load; editing one stops the tools mounting |
| `vision-toolkit/upstream/lib/upstream.js` | a regex matching a Simplified Chinese label in the Python worker's OUTPUT. The worker is hash-locked, so translating the matcher would stop it parsing |
| `vision-toolkit/upstream/patches/*.patch` | a patch's context lines must match the file it applies to |
| `vision-toolkit/upstream/assets/skill/references/restore-ui.md` | tracked with a sha256 in `assets/skill/UPSTREAM.json` |

The rule is: Chinese we *emit* is gone; Chinese that *matches someone else's
bytes* stays, because changing it would silently break the match.
