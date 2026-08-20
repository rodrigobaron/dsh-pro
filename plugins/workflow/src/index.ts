/**
 * @my-dsh/workflow host half — deliberately empty.
 *
 * The progress tree is built entirely in the browser from durable session
 * events the harness already writes. The row still has to exist, because
 * mounting it is what qualifies the package for the browser roster
 * (`dsh.client`) so the loader serves `./client`.
 */

/** Cordis plugin name. */
export const name = 'workflow-view'

/** Nothing to mount host-side. */
export function apply(): void {}
