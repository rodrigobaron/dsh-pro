/**
 * Semantic target parsing.
 *
 * A "target" is the compact string the model writes to point at one element:
 * `role=button|Save`, `label=Email`, `text=Settings`. Accessibility snapshots
 * print elements as `<role> "<name>"`, so the bare `button|Save` shorthand
 * reads straight off a snapshot without a prefix.
 */
import type { Locator, Page } from 'playwright-core'

/** Supported semantic target prefixes. */
export type TargetKind = 'css' | 'label' | 'placeholder' | 'role' | 'testid' | 'text'

/** A model-facing target, normalized. */
export interface ParsedTarget {
  kind: TargetKind
  value: string
  name?: string
}

const KINDS: readonly string[] = ['css', 'label', 'placeholder', 'role', 'testid', 'text']

/**
 * Parse a compact semantic target.
 *
 * A value with no `=` is either the `<role>|<name>` snapshot shorthand or a
 * bare CSS selector, so ordinary Playwright habits keep working.
 *
 * @param raw - model-provided target string.
 * @returns the normalized target description.
 */
export function parseTarget(raw: string): ParsedTarget {
  const target = raw.trim()
  if (target.length === 0) throw new Error('target must be a non-empty string')

  const equals = target.indexOf('=')
  if (equals === -1) {
    const shorthand = /^([a-z][a-z0-9-]*)\|(.+)$/i.exec(target)
    const role = shorthand?.[1]?.trim()
    const name = shorthand?.[2]?.trim()
    if (role !== undefined && name !== undefined && role.length > 0 && name.length > 0) {
      return { kind: 'role', value: role.toLowerCase(), name }
    }
    return { kind: 'css', value: target }
  }

  const kind = target.slice(0, equals).toLowerCase()
  const value = target.slice(equals + 1)
  if (!KINDS.includes(kind)) {
    throw new Error(`unsupported target prefix "${kind}"; use role=, text=, label=, placeholder=, testid=, or css=`)
  }
  if (value.length === 0) throw new Error('target value must not be empty')

  if (kind === 'role') {
    const separator = value.indexOf('|')
    if (separator === -1) return { kind: 'role', value }
    const role = value.slice(0, separator).trim()
    const name = value.slice(separator + 1).trim()
    if (role.length === 0 || name.length === 0) throw new Error('role targets use role=<aria-role>|<accessible-name>')
    return { kind: 'role', value: role, name }
  }

  return { kind: kind as TargetKind, value }
}

/**
 * Resolve one semantic target to a Playwright locator.
 *
 * @param page - owning Playwright page.
 * @param raw - compact target string.
 * @param exact - whether human-readable matching must be exact.
 * @returns a locator suitable for one action.
 */
export function resolveTarget(page: Page, raw: string, exact: boolean): Locator {
  const target = parseTarget(raw)
  switch (target.kind) {
    case 'css': return page.locator(target.value)
    case 'label': return page.getByLabel(target.value, { exact })
    case 'placeholder': return page.getByPlaceholder(target.value, { exact })
    case 'testid': return page.getByTestId(target.value)
    case 'text': return page.getByText(target.value, { exact })
    case 'role': return page.getByRole(
      target.value as Parameters<Page['getByRole']>[0],
      target.name === undefined ? {} : { name: target.name, exact },
    )
  }
}
