/**
 * Styles for the Updates settings section.
 *
 * Built from the harness's real `--dsw-alias-*` tokens so the panel follows the
 * theme; an invented token name silently falls through to its fallback colour
 * and the section stops matching everything around it.
 */
export const STYLE_ID = 'updates-style'

const CSS = `
.dsh_up_intro { margin: 0 0 14px; color: var(--dsw-alias-label-secondary); font-size: 12.5px; line-height: 1.5; }
.dsh_up_grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin: 0 0 12px; }
.dsh_up_card {
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 10px;
  background: var(--dsw-alias-bg-layer-1);
  padding: 12px 13px;
  min-width: 0;
}
.dsh_up_label {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: .08em;
  color: var(--dsw-alias-label-secondary);
  margin: 0 0 5px;
}
.dsh_up_version {
  font-size: 19px;
  font-weight: 650;
  color: var(--dsw-alias-label-primary);
  font-family: var(--ds-font-family-code), monospace;
  margin: 0;
  overflow-wrap: anywhere;
}
.dsh_up_meta { margin: 5px 0 0; font-size: 11px; color: var(--dsw-alias-label-secondary); line-height: 1.45; }
.dsh_up_tag {
  display: inline-block;
  margin-left: 6px;
  padding: 1px 6px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 650;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-secondary);
  vertical-align: middle;
}
.dsh_up_row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin: 0 0 12px; }
.dsh_up_btn {
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 7px;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 12px;
  padding: 6px 12px;
  cursor: pointer;
}
/* Scoped to non-primary: a bare :hover here painted over the brand fill and
   turned the primary button dark on hover. */
.dsh_up_btn:not(.dsh_up_primary):hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.dsh_up_primary {
  background: var(--dsw-alias-brand-primary);
  border-color: transparent;
  color: #fff;
  font-weight: 600;
}
.dsh_up_primary:hover:not(:disabled) { filter: brightness(1.12); }
.dsh_up_btn:disabled { opacity: .5; cursor: default; }
.dsh_up_stamp { font-size: 11px; color: var(--dsw-alias-label-secondary); }
.dsh_up_note {
  margin: 0 0 12px;
  padding: 9px 11px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  line-height: 1.5;
}
.dsh_up_note strong { color: var(--dsw-alias-label-primary); display: block; margin-bottom: 3px; }
.dsh_up_note code {
  display: inline-block;
  margin-top: 6px;
  padding: 3px 7px;
  border-radius: 5px;
  background: var(--dsw-alias-bg-layer-1);
  font-family: var(--ds-font-family-code), monospace;
  font-size: 11.5px;
  color: var(--dsw-alias-label-primary);
}
.dsh_up_error {
  margin: 0 0 12px;
  padding: 9px 11px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent);
  color: var(--dsw-alias-state-error-primary);
  font-size: 12px;
  line-height: 1.5;
}
.dsh_up_notes {
  margin: 0;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-1);
  padding: 10px 12px;
}
.dsh_up_notes summary { cursor: pointer; font-size: 12px; color: var(--dsw-alias-label-secondary); }
.dsh_up_notes pre {
  margin: 9px 0 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-family: var(--ds-font-family-code), monospace;
  font-size: 11.5px;
  line-height: 1.5;
  color: var(--dsw-alias-label-primary);
}
@media (max-width: 640px) { .dsh_up_grid { grid-template-columns: minmax(0, 1fr); } }
`

/** Adopt the stylesheet once, tagged so the DOM says which plugin owns it. */
export function ensureStyles(): void {
  if (document.getElementById(STYLE_ID) !== null) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  // Without this the harness attributes the sheet to whichever plugin happened
  // to be loading when it was adopted.
  style.setAttribute('data-plugin', '@dsh-pro/updates')
  style.textContent = CSS
  document.head.appendChild(style)
}
