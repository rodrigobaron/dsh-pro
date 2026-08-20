# Deep research

`/deep-research <topic>` runs a controlled search loop as a workflow, instead
of a few searches and a summary.

## The design

A research loop is a control system, and saying so gives the model a fan-out
rule and a stopping rule it would otherwise improvise:

- **Requisite variety** — a regulator needs as much variety as the system it
  regulates, so each round fans out across *different modalities* (definitional,
  adversarial, temporal, community, comparative) rather than rephrasing one
  query five times.
- **Information gain is the control signal** — a round is judged by new claims
  and new independent sources, not by how many results came back.
- **Stop on marginal gain** — the loop ends after two consecutive rounds that
  add nothing new. A fixed round count either stops mid-question or burns quota
  on a finished one.
- **Redundancy against a noisy channel** — corroboration across sources that
  did not copy each other. Two sites quoting one press release are one source.
- **Feedback closes the loop** — a critic names what is still missing, and
  those gaps *are* the next round's queries.

Claims come back tagged **corroborated**, **single-source**, or **contested**,
and contested is reported as a finding rather than averaged into a bland
middle.

## How it is wired

The command is expanded **host-side** at `agent/pre-step`, the same shape
`at-file` uses for `@path`. Typing `/deep-research <topic>` sends an ordinary
message; the host recognizes it and appends one instruction naming the
`deep-research` skill. The transcript keeps showing what you typed, no extra
turn is spent, and the command works from a pasted message or a routine prompt
as readily as from the composer. The browser half only adds the `/` menu entry
— it deliberately does not intercept Enter.

The methodology lives in the skill, not in the injected message, so changing it
reaches every invocation.

The skill is registered **model-facing only**:

```ts
invocation: { modelInvocable: true, userInvocable: false }
```

Omitting `invocation` permits both surfaces, which put a second `deep-research`
in the `/` menu beside the command — two entries for one feature, and the skill
one only loads the instructions without a topic. The harness ships no
deep-research skill of its own; both entries came from this plugin. The model
still loads the skill by name; the human entry point is the command.

Picking the command returns `{ text: '/deep-research ' }` — a `PickOutcome`
that replaces the trigger token. Returning `undefined` reads as "not handled",
which is why the entry was visible but unselectable at first. The trailing
space is load-bearing: `/deep-researchtopic` is a different word and the host's
parser rejects it.

## Search is snippet-only

Searches run through `@dsh-pro/search`'s free engines: `web_search` (routed
there by the `web` seam), plus `advanced_search` for time filtering and
`platform_search` for GitHub and Reddit.

**There is no page fetch.** `dsh-base` sets `fetch: false` and no fetch
provider is mounted, so the loop sees titles, URLs and snippets — never a full
page. That is the biggest constraint on what a result can claim, and the skill
says so explicitly rather than letting the model write as though it had read
its sources. It also shapes the design: a low-bandwidth channel is answered
with more angles and more corroboration.

## Two layers that look alike but are not

`web.searchProvider: ddg` is the **seam provider id** — upstream registers a
single provider object under that name and routes all ten engines through it.
The **engine** is a separate setting (`keenable` by default here). Changing the
seam id to an engine name would leave `ctx.web` with no provider at all.
