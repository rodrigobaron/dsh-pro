/**
 * The picker overlay's styles, injected once.
 *
 * Scoped under `.dsh_rewind_*` and built from the harness's own theme tokens,
 * so the dialog follows light/dark without a second palette.
 */
export const STYLE_ID = 'rewind-picker-style'

const CSS = `
.dsh_rewind_scrim {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.45);
  z-index: 40;
}
.dsh_rewind_dialog {
  display: flex;
  flex-direction: column;
  width: min(680px, calc(100% - 48px));
  max-height: min(70vh, 620px);
  border-radius: 12px;
  border: 1px solid var(--dsw-alias-border-secondary, rgba(128, 128, 128, 0.3));
  background: var(--dsw-alias-background-primary, #1b1b1b);
  color: var(--dsw-alias-label-primary, inherit);
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.45);
  overflow: hidden;
}
.dsh_rewind_head { padding: 18px 20px 12px; border-bottom: 1px solid var(--dsw-alias-border-secondary, rgba(128, 128, 128, 0.2)); }
.dsh_rewind_title { margin: 0 0 6px; font-size: 15px; font-weight: 600; }
.dsh_rewind_subtitle { margin: 0; font-size: 12.5px; line-height: 1.5; opacity: 0.75; }
.dsh_rewind_files {
  margin: 10px 0 0;
  padding: 8px 10px;
  border-radius: 7px;
  font-size: 12px;
  line-height: 1.45;
  background: var(--dsw-alias-background-tertiary, rgba(128, 128, 128, 0.12));
  opacity: 0.9;
}
.dsh_rewind_list { flex: 1; overflow-y: auto; padding: 8px; margin: 0; list-style: none; }
.dsh_rewind_item { display: block; }
.dsh_rewind_btn {
  display: block;
  width: 100%;
  text-align: left;
  padding: 10px 12px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.dsh_rewind_btn:hover { background: var(--dsw-alias-background-tertiary, rgba(128, 128, 128, 0.14)); }
.dsh_rewind_btn[aria-pressed="true"] {
  border-color: var(--dsw-alias-border-focus, #4c8dff);
  background: var(--dsw-alias-background-tertiary, rgba(128, 128, 128, 0.18));
}
.dsh_rewind_meta { display: flex; gap: 8px; align-items: center; font-size: 11px; opacity: 0.6; margin-bottom: 3px; }
.dsh_rewind_badge {
  padding: 1px 6px;
  border-radius: 999px;
  font-size: 10px;
  background: var(--dsw-alias-background-tertiary, rgba(128, 128, 128, 0.2));
}
.dsh_rewind_text {
  font-size: 13px;
  line-height: 1.45;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-word;
}
.dsh_rewind_muted { opacity: 0.5; font-style: italic; }
.dsh_rewind_empty { padding: 28px 20px; text-align: center; font-size: 13px; opacity: 0.65; }
.dsh_rewind_error {
  margin: 0 20px 10px;
  padding: 8px 10px;
  border-radius: 7px;
  font-size: 12px;
  line-height: 1.45;
  color: var(--dsw-alias-label-error, #ff8080);
  background: rgba(255, 96, 96, 0.12);
}
.dsh_rewind_foot {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  padding: 12px 20px 16px;
  border-top: 1px solid var(--dsw-alias-border-secondary, rgba(128, 128, 128, 0.2));
}
.dsh_rewind_action {
  padding: 7px 14px;
  border-radius: 7px;
  border: 1px solid var(--dsw-alias-border-secondary, rgba(128, 128, 128, 0.3));
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}
.dsh_rewind_action:hover:not(:disabled) { background: var(--dsw-alias-background-tertiary, rgba(128, 128, 128, 0.14)); }
.dsh_rewind_action:disabled { opacity: 0.45; cursor: default; }
.dsh_rewind_primary {
  border-color: transparent;
  background: var(--dsw-alias-button-primary-fill, #4c8dff);
  color: var(--dsw-alias-label-primary-foreground, #fff);
}
`

/** Inject the stylesheet once per document. */
export function ensureStyles(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById(STYLE_ID) !== null) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  // Claim the tag, so the plugin inventory does not attribute these rules to
  // whichever plugin happened to be loading when they were injected.
  style.dataset.plugin = '@my-dsh/rewind-picker'
  style.textContent = CSS
  document.head.appendChild(style)
}
