/**
 * React arrives through the injected `require`, not a bundled copy — the
 * harness owns the single instance.
 */
import type * as ReactNS from 'react'

export const React: typeof ReactNS = require('react')
export const h = React.createElement
