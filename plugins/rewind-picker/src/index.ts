/**
 * @dsh-pro/rewind-picker host half — deliberately empty.
 *
 * The `/rewind` command and its picker are entirely browser-side: the command
 * opens an overlay, the overlay reads the conversation snapshot it is already
 * given, and the confirmation posts to @dsh-pro/rewind's existing route. No
 * host service is needed.
 *
 * The row still has to exist, because mounting it is what qualifies the
 * package for the browser roster (`dsh.client`) so the loader serves
 * `./client` and the boot manifest carries it.
 */

/** Cordis plugin name. */
export const name = 'rewind-picker'

/** Nothing to mount host-side. */
export function apply(): void {}
