/**
 * @my-dsh/deep-research client half: discoverability only.
 *
 * The command itself is expanded on the host, so this registers nothing that
 * intercepts Enter — typing `/deep-research a topic` sends an ordinary
 * message, which is exactly what the host expects. All this adds is the entry
 * in the `/` menu, so the command can be found without reading the README.
 */
const COMMAND = 'deep-research'

interface TriggerCandidate { name: string; description?: string }

/**
 * What a pick may do. `{ text }` replaces the trigger token with that text,
 * which is what completes a command; returning `undefined` means "not
 * handled", so the menu closes and nothing is inserted.
 */
type PickOutcome = { readonly text: string } | 'handled' | undefined

interface InputTriggersFace {
  registerSource(source: {
    trigger: string
    name: string
    order?: number
    candidates(session: unknown, request: { position?: string; query: string }): Promise<readonly TriggerCandidate[]>
    onPick(pick: unknown): PickOutcome
    matchEnter(session: unknown, line: string): Promise<'handled' | undefined>
  }): () => void
}

interface ClientCtx {
  effect(setup: () => unknown, label?: string): unknown
  get(key: string): unknown
}

/**
 * Register the menu entry.
 * @param ctx - the client root context.
 */
function apply(ctx: ClientCtx): void {
  ctx.effect(() => {
    // Soft dependency: without the trigger service the command still works,
    // it just cannot be discovered from the menu.
    const inputTriggers = ctx.get('inputTriggers') as InputTriggersFace | undefined
    if (inputTriggers === undefined) return () => {}
    return inputTriggers.registerSource({
      trigger: '/',
      name: COMMAND,
      order: 5,
      candidates: (_session, request) => {
        if (request.position !== 'leading') return Promise.resolve([])
        const query = request.query.trim().toLowerCase()
        if (query !== '' && !COMMAND.startsWith(query)) return Promise.resolve([])
        return Promise.resolve([{
          name: COMMAND,
          description: 'Research a topic with a controlled multi-round search loop',
        }])
      },
      // Complete the token and leave the cursor after it for the topic. This
      // returned `undefined` at first, which reads as "not handled" — the menu
      // closed and nothing was inserted, so the entry could be seen but never
      // selected. The trailing space matters: `/deep-researchtopic` is a
      // different word and the host's parser rejects it.
      onPick: () => ({ text: `/${COMMAND} ` }),
      // Enter is deliberately NOT handled: the message is meant to send
      // normally, and the host expands it on the way to the model.
      matchEnter: () => Promise.resolve(undefined),
    })
  }, 'deep-research: / menu entry')
}

module.exports = { name: 'deep-research-ui', inject: [], apply }
