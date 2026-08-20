/**
 * Progress-tree styles, on the harness's own `--dsw-alias-*` tokens so the
 * node follows the theme like every other chat node.
 */
export const STYLE_ID = 'workflow-view-style'

const CSS = `
.dsh_wf {
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 10px;
  background: var(--dsw-alias-bg-layer-2);
  padding: 10px 12px;
  font-size: 13px;
  color: var(--dsw-alias-label-primary);
}
.dsh_wf_head { display: flex; align-items: center; gap: 8px; }
.dsh_wf_name { font-weight: 600; }
.dsh_wf_count {
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  color: var(--dsw-alias-label-secondary);
}
.dsh_wf_elapsed {
  margin-left: auto;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  color: var(--dsw-alias-label-secondary);
}
.dsh_wf_bar { height: 3px; border-radius: 2px; background: var(--dsw-alias-bg-layer-1); margin: 8px 0 2px; overflow: hidden; }
.dsh_wf_fill { height: 100%; background: var(--dsw-alias-brand-primary); transition: width 240ms ease; }
.dsh_wf_fill_failed { background: var(--dsw-alias-state-error-primary); }
.dsh_wf_phase { margin-top: 8px; }
.dsh_wf_phaseName {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  color: var(--dsw-alias-label-secondary);
  margin-bottom: 2px;
}
.dsh_wf_member { display: flex; align-items: baseline; gap: 8px; padding: 2px 0; }
.dsh_wf_glyph { flex: none; width: 14px; text-align: center; font-size: 11px; }
.dsh_wf_ok { color: var(--dsw-alias-state-success-primary); }
.dsh_wf_failed { color: var(--dsw-alias-state-error-primary); }
.dsh_wf_running { color: var(--dsw-alias-brand-primary); }
.dsh_wf_interrupted { color: var(--dsw-alias-state-warn-primary); }
.dsh_wf_label { min-width: 0; word-break: break-word; }
.dsh_wf_dur {
  margin-left: auto;
  flex: none;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  color: var(--dsw-alias-label-secondary);
}
.dsh_wf_err {
  margin: 1px 0 3px 22px;
  font-size: 11.5px;
  line-height: 1.4;
  color: var(--dsw-alias-state-error-primary);
  word-break: break-word;
}
.dsh_wf_empty { color: var(--dsw-alias-label-secondary); font-size: 12px; }
@keyframes dsh_wf_pulse { 0%, 100% { opacity: 1 } 50% { opacity: 0.35 } }
.dsh_wf_running .dsh_wf_spin { animation: dsh_wf_pulse 1.1s ease-in-out infinite; display: inline-block; }
`

/** Inject the stylesheet once per document. */
export function ensureStyles(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById(STYLE_ID) !== null) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.dataset.plugin = '@my-dsh/workflow'
  style.textContent = CSS
  document.head.appendChild(style)
}
