/**
 * Narrow local contracts for the host services this plugin consumes.
 *
 * Same precedent as the other host halves here: structural copies let the
 * package build self-contained while a composed profile supplies the real
 * implementations at runtime.
 *
 * @module @dsh-pro/updates/host-contracts
 */

/** One webserver route registration (the dsh-ssh route surface). */
export interface HostRoute {
  /** 'exact' matches the full path; 'prefix' matches a path prefix. */
  readonly kind: 'exact' | 'prefix'
  readonly path: string
  handler(req: NodeIncomingMessage, res: NodeServerResponse): Promise<void> | void
}

/** The `webServer` service (subset of the host webserver). */
export interface HostWebServer {
  register(route: HostRoute): () => void
}

// Node http types spelled structurally, matching the sibling plugins.
export interface NodeIncomingMessage {
  readonly method?: string
  readonly url?: string
  readonly headers: Record<string, string | string[] | undefined>
  readonly socket: { readonly remoteAddress?: string }
  [Symbol.asyncIterator](): AsyncIterableIterator<Uint8Array>
}

export interface NodeServerResponse {
  writeHead(status: number, headers?: Record<string, string>): void
  end(chunk?: string | Uint8Array): void
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The host webserver route surface; required via `inject`. */
    webServer: HostWebServer
  }
}
