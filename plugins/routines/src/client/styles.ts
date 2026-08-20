/**
 * Styles for the Routines settings section.
 *
 * Built from the harness's real `--dsw-alias-*` tokens so the panel follows
 * the theme; an invented token name silently falls through to its fallback
 * colour and the section stops matching everything around it.
 */
export const STYLE_ID = 'routines-style'

const CSS = `
.dsh_rt_intro { margin: 0 0 6px; color: var(--dsw-alias-label-secondary); font-size: 12.5px; line-height: 1.5; }
.dsh_rt_warn {
  margin: 0 0 14px;
  padding: 8px 10px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  line-height: 1.45;
}
.dsh_rt_list { display: flex; flex-direction: column; gap: 8px; margin: 0 0 12px; }
.dsh_rt_card {
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-2);
  padding: 10px 12px;
}
.dsh_rt_head { display: flex; align-items: baseline; gap: 8px; }
.dsh_rt_name { font-weight: 600; font-size: 13px; }
.dsh_rt_when { margin-left: auto; color: var(--dsw-alias-label-secondary); font-size: 11px; font-variant-numeric: tabular-nums; }
.dsh_rt_cron {
  font-family: var(--ds-font-family-code, ui-monospace, monospace);
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 5px;
  background: var(--dsw-alias-bg-layer-1);
  border: 1px solid var(--dsw-alias-border-l1);
  color: var(--dsw-alias-label-secondary);
}
.dsh_rt_prompt {
  margin: 6px 0 0;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  line-height: 1.45;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-word;
}
.dsh_rt_fail { margin: 6px 0 0; color: var(--dsw-alias-state-error-primary); font-size: 12px; }
.dsh_rt_actions { display: flex; gap: 6px; margin-top: 8px; }
.dsh_rt_btn {
  font: inherit;
  font-size: 12px;
  padding: 4px 10px;
  border-radius: 6px;
  border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
}
.dsh_rt_btn:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.dsh_rt_btn:disabled { opacity: 0.45; cursor: default; }
.dsh_rt_danger:hover:not(:disabled) { color: var(--dsw-alias-state-error-primary); border-color: var(--dsw-alias-state-error-primary); }
.dsh_rt_form { display: flex; flex-direction: column; gap: 10px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; padding: 12px; background: var(--dsw-alias-bg-layer-2); }
.dsh_rt_field { display: flex; flex-direction: column; gap: 4px; }
.dsh_rt_label { font-size: 12px; font-weight: 600; }
.dsh_rt_help { font-size: 11px; color: var(--dsw-alias-label-secondary); }
.dsh_rt_input, .dsh_rt_area {
  font: inherit;
  font-size: 13px;
  padding: 6px 8px;
  border-radius: 6px;
  border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
}
.dsh_rt_area { min-height: 72px; resize: vertical; line-height: 1.45; }
.dsh_rt_mono { font-family: var(--ds-font-family-code, ui-monospace, monospace); }
.dsh_rt_presets { display: flex; flex-wrap: wrap; gap: 6px; }
.dsh_rt_preset {
  font: inherit;
  font-size: 11px;
  padding: 3px 8px;
  border-radius: 999px;
  border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
}
.dsh_rt_preset:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.dsh_rt_formActions { display: flex; gap: 8px; justify-content: flex-end; }
.dsh_rt_primary { border-color: transparent; background: var(--dsw-alias-brand-primary); color: var(--dsw-alias-label-primary-foreground, #fff); }
.dsh_rt_primary:hover:not(:disabled) { filter: brightness(1.12); background: var(--dsw-alias-brand-primary); }
.dsh_rt_error { margin: 8px 0 0; color: var(--dsw-alias-state-error-primary); font-size: 12px; }
`

/** Inject the stylesheet once per document. */
export function ensureStyles(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById(STYLE_ID) !== null) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.dataset.plugin = '@dsh-pro/routines'
  style.textContent = CSS
  document.head.appendChild(style)
}
