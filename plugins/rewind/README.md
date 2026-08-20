# Rewinding the conversation

Two entry points, one route:

- **`rewind`** puts a button on every user message. Click it, confirm, and that
  message and everything after it leave the conversation — from the transcript
  and from what the model sees — while its text returns to the composer for
  editing.
- **`rewind-picker`** adds `/rewind`, which opens a dialog listing the user
  messages newest first so you can pick one without hunting for its button.

Both POST `/rewind`, which appends a durable `session/recall` tombstone. The
log keeps every event, so this survives a restart.

## How it works without `session.recall()`

Upstream's host calls `session.recall()`. That is core runtime support rather
than a plugin seam — its own README says so — and **no published harness has
ever shipped it**: rc.7 has no such method, and a grep of rc.8 finds no match
either. So the host here is ours, and uses public API only.

The model-visible history is a **surface** projected over the append-only log,
and a surface event may enter as a replacement: `{ op: 'replace', start, end }`
substitutes one node for a whole range. Compaction uses exactly this to swap a
stretch of history for a summary, and the type documentation states that "any
surface-replacing producer may use it". A rewind replaces
`[boundary .. last surface node]` with a single marker, so `deriveMessages()`
stops projecting the rewound turns.

Two consequences follow from the mechanism, and both are deliberate:

- **The op cannot empty a range** — a replacement always leaves exactly one
  node. That node is a marker saying the conversation was rewound and how many
  messages went with it. The model reads it on purpose: a silently shorter
  history invites it to re-derive conclusions it has no record of reaching.
- **Nothing is deleted.** Every original event stays in the log and no file is
  touched. `planRewind` is the part where an off-by-one would shadow the wrong
  range irreversibly, so it is pure and unit-tested
  (`npm run test --workspace=@dsh-pro/rewind`).

## Hiding the rewound messages

The rewind is real for the model, but the transcript is a different projection.
The harness's docs are explicit that "a human transcript must project
append-origin events rather than `session.surface`, because landed replacements
shadow history the reader already saw" — so the rewound exchange keeps
rendering, exactly as compaction leaves everything visible after summarizing.

There is no supported filter for this: the client runtime has no hook that
drops a chat node, and a slot entry can only *replace* a keyed renderer, never
filter one and fall through for the rest. So `rewind-picker` hides the rows in
the DOM, driven by the ids the host reports.

That means coupling to two framework attributes, `data-chat-flow-kind` and
`data-chat-flow-key`. **If either changes, hiding silently stops and the
rewound messages reappear** — which is the safe direction to fail in: the
model's history is still correct, the reader just sees more than intended.

It walks the flow rather than writing a stylesheet, because only *user* rows
carry a durable message id in their key. Assistant steps and tool calls are
keyed by turn and call id, so they cannot be selected directly; walking in
order with a "currently inside a rewound turn" flag identifies them by position
and stops at the next surviving user message. That last part is what keeps
messages sent *after* a rewind visible.

A `MutationObserver` re-applies it, because the flow rebuilds its rows on every
snapshot change and drops the inline styles. On mount the client asks the host
(`POST /rewind {query:true}`) which messages are rewound, so a reload does not
resurrect them. Only rewind's own markers count — compaction shadows surface
nodes too, and its summaries are meant to stay visible.

## The two bundles have to talk

The button and the picker are separate bundles that share only the route, so a
rewind from the button was invisible to the picker: its hidden set stayed stale
until a reload re-queried it, which is why the button used to need an F5 and
the command did not. The button's bundle now dispatches
`my-dsh:rewound` on the window when a rewind commits, and the picker re-reads
the state. A DOM event is the smallest thing that crosses the gap without a
shared module.

The host reports the same state two ways for two consumers: **ids**, which the
transcript hiding keys rows by, and **seqs**, which the picker uses to drop
already-rewound messages from its list — offering one again could only produce
a refusal, since it is no longer a surface node.

## Giving the composer back

A rewind puts the message back in the composer to edit. From the command that
needed two things the first pass missed.

`sessions` has to be in the client plugin's `inject` list. `restoreDraft`
resolves the composer through `ctx.sessions.scope(sessionId)`, and without the
injection that is `undefined` — so the restore returned false and did nothing,
silently, while the button path (which never had a token in the way) looked
fine.

The `/rewind` token also has to be consumed, the same way `/context` does it:
the token stays in the composer while the dialog is open, and closing
dispatches `slash/input-consume-token` with a guard recorded at open time — a
span CAS for a menu pick, bare-token equality for Enter. A stale guard fails
soft inside the shell and leaves a draft the user edited alone. Closing happens
*before* the restore, so consuming the token cannot edit the text the restore
just wrote.

## Dialog layout

The overlay slot renders inside the composer's container, so an absolutely
positioned scrim covers the input area and the dialog opens at the bottom of
the page. `position: fixed` escapes that anchor and centres it — which is
exactly what the `/context` modal does, and for the same reason. The styles
also use the harness's real `--dsw-alias-*` tokens (`bg-layer-1/2`,
`border-l1`, `label-primary/secondary`, `interactive-bg-hover`,
`brand-primary`); an invented token name falls through to its fallback colour
and the dialog quietly stops following the theme.

## The node shape trap

The conversation snapshot's nodes are **flat** — `{ kind, seq, content, time }`.
The `conversation.chat.node` slot hands its renderer a `{ node: { data } }`
wrapper instead, and assuming that wrapper applies to the snapshot too produces
a picker that finds 97 nodes and zero messages, with no error anywhere. If you
read nodes from a snapshot, read the fields off the node.
