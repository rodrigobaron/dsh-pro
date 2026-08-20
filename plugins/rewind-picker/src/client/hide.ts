/**
 * Hiding rewound messages in the transcript.
 *
 * A rewind removes messages from the MODEL's history by replacing a range of
 * the session surface. The transcript is a different projection: the harness
 * documents that "a human transcript must project append-origin events rather
 * than `session.surface`, because landed replacements shadow history the
 * reader already saw". So the rewound exchange keeps rendering, exactly as
 * compaction leaves everything visible after summarizing it.
 *
 * There is no supported filter for this — the client runtime has no hook that
 * drops a chat node, and a slot entry can only REPLACE a keyed renderer, never
 * filter one and fall through for the rest. So this hides them in the DOM.
 *
 * That means coupling to two framework attributes, `data-chat-flow-kind` and
 * `data-chat-flow-key`. If either changes, hiding silently stops working and
 * the rewound messages reappear — which is the safe direction to fail in: the
 * model's history is still correct, the reader just sees more than intended.
 *
 * Why a DOM walk and not a stylesheet: only USER rows carry a durable message
 * id in their key. The assistant steps and tool calls that belong to a rewound
 * turn are keyed by turn and call id, so they cannot be selected directly.
 * Walking the flow in order and carrying a "currently inside a rewound turn"
 * flag identifies them by position instead, and stops cleanly at the next
 * surviving user message — which is what keeps messages sent AFTER a rewind
 * visible.
 */

/** The attribute the chat flow keys each row by. */
const KEY_ATTR = 'data-chat-flow-key'
/** The attribute naming what kind of row it is. */
const KIND_ATTR = 'data-chat-flow-kind'
/** Marks rows this plugin hid, so it can release them again. */
const MARK = 'dshRewindHidden'

/**
 * Whether a row's key belongs to one of the given message ids.
 *
 * User rows are keyed `<n>:input-message<messageId>`, so an id match is a
 * suffix test rather than equality.
 */
function keyHasId(key: string, ids: ReadonlySet<string>): boolean {
  for (const id of ids) {
    if (key.endsWith(id)) return true
  }
  return false
}

/**
 * Hide every row belonging to a rewound turn, and release any that no longer
 * are.
 *
 * Idempotent: safe to run on every render, and running it with an empty id set
 * restores everything this plugin hid.
 *
 * @param ids - durable ids of the rewound user messages.
 * @param root - the document to walk (injectable for tests).
 * @returns how many rows are hidden.
 */
export function applyHiding(ids: ReadonlySet<string>, root: Document | undefined = typeof document === 'undefined' ? undefined : document): number {
  if (root === undefined) return 0
  // Array.from, not for-of: the DOM lib target here does not give NodeList an
  // iterator, and the flow is small enough that the copy costs nothing.
  const rows = Array.from(root.querySelectorAll<HTMLElement>(`[${KEY_ATTR}]`))
  let insideRewound = false
  let hidden = 0
  for (const row of rows) {
    const kind = row.getAttribute(KIND_ATTR)
    const key = row.getAttribute(KEY_ATTR) ?? ''
    // A user row opens or closes a rewound stretch; everything between belongs
    // to whichever user message preceded it.
    if (kind === 'user') insideRewound = ids.size > 0 && keyHasId(key, ids)
    if (insideRewound) {
      row.style.display = 'none'
      row.dataset[MARK] = 'true'
      hidden += 1
    } else if (row.dataset[MARK] === 'true') {
      row.style.removeProperty('display')
      delete row.dataset[MARK]
    }
  }
  return hidden
}
