/**
 * Theme-native styles, injected as a plugin-owned <style> tag.
 *
 * Every colour is a harness alias token, so the tab follows light/dark with
 * the rest of the app. The two diff tints are the only literals: they are
 * layered with colour-mix over the theme's own surface, so they read correctly
 * on either background instead of being a fixed green/red.
 */

export const STYLES = [
  // Scoped box-sizing reset. The harness's reset does not reach this plugin's
  // nodes, so a padded `width: 100%` row resolved to 100% of the CONTENT box
  // and then added its own padding on top — every file row rendered 24px wider
  // than the pane and had its trailing button clipped.
  '.gr-root *, .gr-root *::before, .gr-root *::after { box-sizing: border-box; }',
  // The conversation composer floats over the bottom of the view, so the tab
  // reserves clearance for it rather than letting the split run underneath.
  '.gr-root { display: flex; flex-direction: column; height: 100%; min-height: 0; gap: 12px; padding: 16px 16px 96px; box-sizing: border-box; color: var(--dsw-alias-label-primary); }',

  // ---- header ----
  '.gr-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; flex: none; }',
  '.gr-branch { display: inline-flex; align-items: center; gap: 6px; font-weight: 600; font-size: 13px; }',
  '.gr-branch-name { font-family: var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace); }',
  '.gr-chip { font-size: 11px; padding: 2px 7px; border-radius: 999px; border: 1px solid var(--dsw-alias-border-l2); color: var(--dsw-alias-label-secondary); white-space: nowrap; }',
  '.gr-chip-warn { color: var(--dsw-alias-state-warn-primary); border-color: var(--dsw-alias-state-warn-primary); }',
  '.gr-spacer { flex: 1; }',

  // ---- buttons ----
  '.gr-btn { font: inherit; font-size: 12px; padding: 4px 10px; border-radius: 7px; border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); cursor: pointer; white-space: nowrap; }',
  '.gr-btn:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-1); border-color: var(--dsw-alias-border-l3); }',
  '.gr-btn:disabled { opacity: 0.45; cursor: default; }',
  // The harness pairs this fill with label-primary-foreground; without it the
  // label renders in the page's own text colour, which IS the fill here.
  '.gr-btn-primary { background: var(--dsw-alias-button-primary-fill); color: var(--dsw-alias-label-primary-foreground); border-color: transparent; font-weight: 600; }',
  '.gr-btn-primary:hover:not(:disabled) { background: var(--dsw-alias-button-primary-hover); border-color: transparent; }',
  '.gr-btn-danger { color: var(--dsw-alias-state-error-primary, #e5484d); }',
  '.gr-btn-sm { font-size: 11px; padding: 2px 7px; }',

  // ---- body split ----
  '.gr-body { display: flex; gap: 12px; flex: 1; min-height: 0; }',
  '.gr-files { flex: 0 0 300px; min-width: 220px; display: flex; flex-direction: column; min-height: 0; border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); overflow: hidden; }',
  '.gr-diff { flex: 1; min-width: 0; display: flex; flex-direction: column; min-height: 0; border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); overflow: hidden; }',

  // ---- file list ----
  '.gr-group { display: flex; align-items: center; flex-wrap: wrap; row-gap: 6px; gap: 8px; padding: 8px 12px; font-size: 11px; font-weight: 600; letter-spacing: 0.03em; text-transform: uppercase; color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-bg-layer-2); border-bottom: 1px solid var(--dsw-alias-border-l1); position: sticky; top: 0; z-index: 1; }',
  '.gr-scroll { overflow-y: auto; overflow-x: hidden; flex: 1; min-height: 0; }',
  // `position: relative` + `overflow: hidden` anchor the hover actions, which
  // are taken OUT of the flow below — in the flow they reserved ~106px on
  // every row and pushed the last button past the pane's edge.
  '.gr-file { position: relative; overflow: hidden; display: flex; align-items: center; gap: 8px; padding: 6px 12px; cursor: pointer; border: none; background: none; width: 100%; min-width: 0; text-align: left; color: inherit; font: inherit; }',
  '.gr-file:hover { background: var(--dsw-alias-bg-layer-2); }',
  '.gr-file[data-selected="true"] { background: var(--dsw-alias-bg-layer-2); box-shadow: inset 2px 0 0 var(--dsw-alias-label-primary); }',
  '.gr-file-name { flex: 1; min-width: 0; font-size: 12px; font-family: var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; direction: rtl; text-align: left; }',
  // Floated over the row's right edge on hover, with a fade so the filename
  // slides under them instead of being truncated to make room.
  '.gr-file-actions { position: absolute; right: 0; top: 0; bottom: 0; display: flex; align-items: center; gap: 4px; padding: 0 12px 0 24px; opacity: 0; pointer-events: none; background: linear-gradient(to right, transparent, var(--dsw-alias-bg-layer-2) 20%); }',
  '.gr-file:hover .gr-file-actions, .gr-file[data-selected="true"] .gr-file-actions { opacity: 1; pointer-events: auto; }',
  '.gr-letter { flex: none; width: 15px; text-align: center; font-size: 11px; font-weight: 700; font-family: var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace); }',
  '.gr-letter[data-k="A"] { color: var(--dsw-alias-state-success-primary, #30a46c); }',
  '.gr-letter[data-k="D"] { color: var(--dsw-alias-state-error-primary, #e5484d); }',
  '.gr-letter[data-k="U"] { color: var(--dsw-alias-state-warn-primary, #f5a524); }',
  '.gr-counts { flex: none; font-size: 11px; font-family: var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace); white-space: nowrap; }',
  '.gr-add { color: var(--dsw-alias-state-success-primary, #30a46c); }',
  '.gr-del { color: var(--dsw-alias-state-error-primary, #e5484d); }',

  // ---- diff pane ----
  '.gr-diff-head { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-2); flex: none; }',
  '.gr-diff-path { font-size: 12px; font-family: var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
  '.gr-diff-body { overflow: auto; flex: 1; min-height: 0; font-family: var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace); font-size: 12px; line-height: 1.55; }',
  '.gr-hunk { border-top: 1px solid var(--dsw-alias-border-l1); }',
  '.gr-hunk:first-child { border-top: none; }',
  '.gr-hunk-head { padding: 3px 12px; color: var(--dsw-alias-label-tertiary); background: var(--dsw-alias-bg-layer-2); white-space: pre; overflow: hidden; text-overflow: ellipsis; }',
  '.gr-row { display: flex; white-space: pre; }',
  // colour-mix keeps the tint readable on whatever the theme's surface is,
  // instead of hard-coding a light-mode green and red.
  '.gr-row[data-k="add"] { background: color-mix(in srgb, var(--dsw-alias-state-success-primary, #30a46c) 14%, transparent); }',
  '.gr-row[data-k="del"] { background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #e5484d) 14%, transparent); }',
  '.gr-row[data-k="meta"] { color: var(--dsw-alias-label-tertiary); font-style: italic; }',
  '.gr-num { flex: none; width: 44px; padding: 0 8px; text-align: right; color: var(--dsw-alias-label-tertiary); user-select: none; opacity: 0.75; }',
  '.gr-sign { flex: none; width: 14px; text-align: center; user-select: none; }',
  '.gr-text { flex: 1; min-width: 0; padding-right: 12px; white-space: pre-wrap; word-break: break-word; }',

  // ---- commit bar ----
  '.gr-commit { flex: none; display: flex; flex-direction: column; gap: 8px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); padding: 10px 12px; }',
  '.gr-msg { width: 100%; box-sizing: border-box; resize: vertical; min-height: 56px; font: inherit; font-size: 12px; font-family: var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace); padding: 8px 10px; border-radius: 8px; border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-base); color: inherit; }',
  '.gr-msg:focus { outline: none; border-color: var(--dsw-alias-border-l3); }',
  '.gr-commit-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }',
  '.gr-check { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; color: var(--dsw-alias-label-secondary); cursor: pointer; }',

  // ---- states ----
  '.gr-empty { padding: 24px; text-align: center; color: var(--dsw-alias-label-tertiary); font-size: 12px; }',
  '.gr-error { flex: none; padding: 8px 12px; border-radius: 8px; font-size: 12px; white-space: pre-wrap; word-break: break-word; border: 1px solid var(--dsw-alias-state-error-primary, #e5484d); color: var(--dsw-alias-state-error-primary, #e5484d); background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #e5484d) 10%, transparent); font-family: var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace); }',
  '.gr-ok { border-color: var(--dsw-alias-state-success-primary, #30a46c); color: var(--dsw-alias-state-success-primary, #30a46c); background: color-mix(in srgb, var(--dsw-alias-state-success-primary, #30a46c) 10%, transparent); }',

  // Narrow panes stack instead of squeezing the diff to nothing.
  '@media (max-width: 900px) { .gr-body { flex-direction: column; } .gr-files { flex: 0 0 200px; } }',
].join('\n')
