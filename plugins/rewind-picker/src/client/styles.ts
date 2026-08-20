/**
 * The picker dialog's styles.
 *
 * Modelled on the /context modal, deliberately: same centred card, same theme
 * tokens, same row-as-card idiom for the list. Two things are load-bearing —
 *
 *   position: FIXED on the backdrop. The overlay slot renders inside the
 *   composer's container, so an absolutely positioned scrim covers the input
 *   area instead of the page and the dialog opens at the bottom. Fixed
 *   positioning escapes that anchor, which is exactly what the /context modal
 *   does and for the same reason.
 *
 *   The `--dsw-alias-*` tokens are the harness's real ones (bg-layer-1/2,
 *   border-l1, label-primary/secondary, interactive-bg-hover, brand-primary).
 *   Invented names silently fall through to the fallback colour and the dialog
 *   stops following the theme.
 */
export const STYLE_ID = 'rewind-picker-style'

const CSS = `
.dsh_rewind_backdrop {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.45);
}
.dsh_rewind_card {
  display: flex;
  flex-direction: column;
  width: min(640px, calc(100vw - 48px));
  max-height: min(82vh, 760px);
  box-sizing: border-box;
  background: var(--dsw-alias-bg-layer-1);
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 12px;
  box-shadow: var(--dsw-shadow-lv3, 0 12px 32px rgba(0, 0, 0, 0.4));
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  overflow: hidden;
}
.dsh_rewind_head { padding: 16px 18px 12px; }
.dsh_rewind_headrow { display: flex; align-items: baseline; gap: 8px; }
.dsh_rewind_title { font-weight: 600; font-size: 14px; }
.dsh_rewind_close {
  margin-left: auto;
  border: 0;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font-size: 18px;
  line-height: 1;
  padding: 2px 6px;
  border-radius: 6px;
  cursor: pointer;
  font-family: inherit;
}
.dsh_rewind_close:hover { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-2); }
.dsh_rewind_sub { margin: 8px 0 0; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 1.5; }
.dsh_rewind_note {
  margin: 10px 0 0;
  padding: 7px 10px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  line-height: 1.45;
}
.dsh_rewind_note b { color: var(--dsw-alias-label-primary); font-weight: 600; }

/* One card per message: the list reads as discrete choices, not a paragraph. */
.dsh_rewind_list {
  flex: 1;
  overflow-y: auto;
  margin: 0;
  padding: 4px 18px 12px;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.dsh_rewind_row {
  display: flex;
  gap: 10px;
  width: 100%;
  text-align: left;
  padding: 9px 11px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
  transition: box-shadow 120ms ease, background 120ms ease;
}
.dsh_rewind_row:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dsh_rewind_row[aria-pressed="true"] {
  border-color: var(--dsw-alias-brand-primary);
  box-shadow: 0 0 0 1px var(--dsw-alias-brand-primary);
}
.dsh_rewind_row:disabled { opacity: 0.5; cursor: default; }
.dsh_rewind_n {
  flex: none;
  min-width: 22px;
  height: 22px;
  padding: 0 5px;
  border-radius: 6px;
  background: var(--dsw-alias-bg-layer-1);
  border: 1px solid var(--dsw-alias-border-l1);
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  display: flex;
  align-items: center;
  justify-content: center;
}
.dsh_rewind_row[aria-pressed="true"] .dsh_rewind_n {
  background: var(--dsw-alias-brand-primary);
  border-color: transparent;
  color: var(--dsw-alias-label-primary-foreground, #fff);
}
.dsh_rewind_body { min-width: 0; flex: 1; }
.dsh_rewind_meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 3px;
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
}
.dsh_rewind_pill {
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--dsw-alias-bg-layer-1);
  border: 1px solid var(--dsw-alias-border-l1);
  font-size: 10px;
}
.dsh_rewind_text {
  line-height: 1.45;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-word;
  white-space: pre-wrap;
}
.dsh_rewind_muted { color: var(--dsw-alias-label-secondary); font-style: italic; }
.dsh_rewind_empty { padding: 26px 18px; text-align: center; color: var(--dsw-alias-label-secondary); }
.dsh_rewind_alert {
  margin: 0 18px 10px;
  padding: 8px 10px;
  border-radius: 8px;
  font-size: 12px;
  line-height: 1.45;
  color: var(--dsw-alias-state-error-primary);
  border: 1px solid var(--dsw-alias-state-error-primary);
  background: var(--dsw-alias-bg-layer-2);
}
.dsh_rewind_foot {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  padding: 12px 18px 16px;
  border-top: 1px solid var(--dsw-alias-border-l1);
}
.dsh_rewind_btn {
  padding: 7px 14px;
  border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}
.dsh_rewind_btn:disabled { opacity: 0.45; cursor: default; }
/* Secondary only: on the primary this grey would paint over the brand fill and
   the button would go DARK on hover, which read as disabled. */
.dsh_rewind_btn:not(.dsh_rewind_primary):hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.dsh_rewind_primary {
  border-color: transparent;
  background: var(--dsw-alias-brand-primary);
  color: var(--dsw-alias-label-primary-foreground, #fff);
}
/* Keep the brand colour and just lift it, so hover reads as "more", not "off".
   A filter needs no second brand token that may not exist. */
.dsh_rewind_primary:hover:not(:disabled) { filter: brightness(1.12); }
.dsh_rewind_primary:active:not(:disabled) { filter: brightness(0.94); }
`

/** Inject the stylesheet once per document. */
export function ensureStyles(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById(STYLE_ID) !== null) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  // Claim the tag, so the plugin inventory does not attribute these rules to
  // whichever plugin happened to be loading when they were injected.
  style.dataset.plugin = '@dsh-pro/rewind-picker'
  style.textContent = CSS
  document.head.appendChild(style)
}
