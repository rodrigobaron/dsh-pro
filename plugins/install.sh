#!/usr/bin/env bash
# Install the my-dsh file canvas into a DeepSeek Harness profile, and back out
# the vendored dsh-artifacts canvas it replaces.
#
# Idempotent: the profile patch is generated wholesale rather than appended to,
# so re-running cannot accumulate duplicate entries or leave a stale document.
set -euo pipefail

DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_DEST="$DSH_HOME/profiles/node_modules/@my-dsh"
PATCH_FILE="$DSH_HOME/profiles/web/cordis.patch.yml"
PRESET_DIR="$DSH_HOME/.agent-presets/artifacts"

echo "my-dsh file canvas installer"
echo "  DSH_HOME: $DSH_HOME"
echo

# ── 1. Remove the vendored dsh-artifacts install ─────────────────────────────
# Only from DSH_HOME — the vendor/ checkout in the project is kept as reference.
VENDOR_PKGS="$DSH_HOME/profiles/node_modules/@dsh-artifact"
if [ -d "$VENDOR_PKGS" ]; then
  rm -rf "$VENDOR_PKGS"
  echo "  ✓ removed vendor packages (@dsh-artifact)"
fi
if [ -d "$DSH_HOME/.agent-presets/artifact" ]; then
  rm -rf "$DSH_HOME/.agent-presets/artifact"
  echo "  ✓ removed vendor agent preset (artifact)"
fi
# Earlier installs of this plugin used the id `file-canvas`; drop it so a
# re-run does not leave two presets offering the same tool.
if [ -d "$DSH_HOME/.agent-presets/file-canvas" ]; then
  rm -rf "$DSH_HOME/.agent-presets/file-canvas"
  echo "  ✓ removed superseded preset (file-canvas)"
fi

# ── 2. Build and install our packages ────────────────────────────────────────
# The harness serves a client package's `./client` export verbatim, so the
# browser half must be wrapped into module-loader factory form first. The wrap
# step is plain node with no dependencies — see client-ui-file-canvas/build.mjs.
( cd "$REPO_DIR/client-ui-file-canvas" && node build.mjs )

mkdir -p "$PKG_DEST"
for pkg in tool-file-canvas client-ui-file-canvas client-ui-layout-wide; do
  if [ ! -d "$REPO_DIR/$pkg" ]; then
    echo "  ! missing package: $pkg" >&2
    exit 1
  fi
  rm -rf "${PKG_DEST:?}/$pkg"
  cp -r "$REPO_DIR/$pkg" "$PKG_DEST/$pkg"
  echo "  ✓ installed @my-dsh/$pkg"
done

# ── 3. Generate the profile patch ────────────────────────────────────────────
# Written from scratch every run. The vendor installer appended to this file,
# which is how it collided with the shipped `[]` placeholder; owning the whole
# document removes that whole class of failure.
mkdir -p "$(dirname "$PATCH_FILE")"
if [ -f "$PATCH_FILE" ] && [ ! -f "$PATCH_FILE.pre-file-canvas" ]; then
  cp "$PATCH_FILE" "$PATCH_FILE.pre-file-canvas"
  echo "  ✓ backed up previous patch → $(basename "$PATCH_FILE").pre-file-canvas"
fi

cat > "$PATCH_FILE" <<'PATCH'
# Managed by my-dsh/plugins/install.sh — regenerated on every install.
# A top-level YAML array of loader patch entries.

# File canvas (browser): renders any workspace file in the details side panel.
- insert:
    - id: ui-file-canvas
      name: '@my-dsh/client-ui-file-canvas'

# Wide details column: the canvas opens at ~35% of the viewport (min 420px) and
# ~70% by dragging, instead of the stock 360px-open / 520px-max. A patch cannot rename a
# row, so the shipped layout is disabled and the fork inserted beside it.
- id: ui-layout
  disabled: true

- insert:
    - id: ui-layout-wide
      name: '@my-dsh/client-ui-layout-wide'

# File canvas (host): GET /canvas/file, the contained reader the canvas fetches
# envelopes and image/PDF bytes from. Lives in the web profile because it needs
# the `webServer` service; the `show_file` tool half lives in the agent preset.
- insert:
    - id: host-file-canvas-route
      name: '@my-dsh/tool-file-canvas/route'

# Mount the artifacts preset (standard + the show_file tool) by default.
- id: agent-presets
  config:
    default: artifacts
PATCH
echo "  ✓ wrote $PATCH_FILE"

# ── 4. Create the agent preset ───────────────────────────────────────────────
find_standard_preset() {
  local candidate dsh_real pkg_root
  if command -v dsh >/dev/null 2>&1; then
    dsh_real="$(readlink -f "$(command -v dsh)" 2>/dev/null || command -v dsh)"
    pkg_root="$(dirname "$(dirname "$dsh_real")")"
    candidate="$pkg_root/config/agent-presets/standard/agent.cordis.yml"
    [ -f "$candidate" ] && { printf '%s\n' "$candidate"; return 0; }
  fi
  if command -v npm >/dev/null 2>&1; then
    candidate="$(npm root -g 2>/dev/null)/@deepseek-ai/dsh/config/agent-presets/standard/agent.cordis.yml"
    [ -f "$candidate" ] && { printf '%s\n' "$candidate"; return 0; }
  fi
  # npx keeps the running copy in a content-addressed cache directory.
  candidate="$(find "$HOME/.npm/_npx" -path '*@deepseek-ai/dsh/config/agent-presets/standard/agent.cordis.yml' 2>/dev/null | head -1)"
  [ -n "$candidate" ] && [ -f "$candidate" ] && { printf '%s\n' "$candidate"; return 0; }
  return 1
}

mkdir -p "$PRESET_DIR"
STANDARD_PRESET="$(find_standard_preset || true)"
if [ -z "$STANDARD_PRESET" ]; then
  echo "  ! could not find the standard agent preset" >&2
  echo "    create $PRESET_DIR/agent.cordis.yml manually, then add the tool-file-canvas entry" >&2
  exit 1
fi

cp "$STANDARD_PRESET" "$PRESET_DIR/agent.cordis.yml"
echo "  ✓ copied standard preset ($STANDARD_PRESET)"

cat >> "$PRESET_DIR/agent.cordis.yml" <<'PRESET'

# ── file canvas ─────────────────────────────────────────────────────────────
# The model-facing `show_file` tool: put any workspace file on the canvas.
- id: tool-file-canvas
  name: '@my-dsh/tool-file-canvas'
PRESET
echo "  ✓ added tool-file-canvas to preset"

cat > "$PRESET_DIR/preset.yml" <<'PRESET'
name: Artifacts
description: Standard coding agent plus the show_file tool, for viewing any workspace file as an artifact — source, Markdown, HTML, images, and PDFs.
PRESET
echo "  ✓ wrote preset.yml"

echo
echo "Done. Restart DeepSeek Harness to apply."
