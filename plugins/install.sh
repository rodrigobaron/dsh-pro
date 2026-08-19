#!/usr/bin/env bash
# Install every plugin in this directory into a DeepSeek Harness profile.
#
# Adding a plugin means adding a directory — this script discovers them rather
# than listing them. A plugin directory is any child of plugins/ holding a
# package.json, and it may contribute three things:
#
#   package.json      required. `name` decides where it installs, and a
#                     `scripts.build` entry is run before it is copied.
#   cordis.patch.yml  optional. Loader rows merged into the profile patch.
#   agent.preset.yml  optional. Rows appended to the `artifacts` agent preset,
#                     for plugins registering a tool (`tools` is agent-scoped,
#                     so a tool cannot be a profile row).
#
# Idempotent: the profile patch and the preset are generated whole on every
# run, so re-running cannot accumulate duplicate rows.
set -euo pipefail

DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
PLUGINS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(dirname "$PLUGINS_DIR")"
PROFILE_MODULES="$DSH_HOME/profiles/node_modules"
PATCH_FILE="$DSH_HOME/profiles/web/cordis.patch.yml"
PRESET_ID="artifacts"
PRESET_DIR="$DSH_HOME/.agent-presets/$PRESET_ID"

echo "my-dsh plugin installer"
echo "  DSH_HOME: $DSH_HOME"
echo

# ── 0. Discover plugins ──────────────────────────────────────────────────────
PLUGINS=()
for dir in "$PLUGINS_DIR"/*/; do
  [ -f "${dir}package.json" ] && PLUGINS+=("${dir%/}")
done
if [ ${#PLUGINS[@]} -eq 0 ]; then
  echo "  ! no plugins found in $PLUGINS_DIR" >&2
  exit 1
fi
echo "  found ${#PLUGINS[@]} plugin(s): $(for p in "${PLUGINS[@]}"; do printf '%s ' "$(basename "$p")"; done)"
echo

pkg_field() { node -p "JSON.parse(require('fs').readFileSync('$1/package.json','utf8')).$2 ?? ''"; }

# ── 1. Retire the vendored dsh-artifacts install ─────────────────────────────
# Only from DSH_HOME — the reference checkouts in the repo are left alone.
for stale in "$PROFILE_MODULES/@dsh-artifact" "$DSH_HOME/.agent-presets/artifact" "$DSH_HOME/.agent-presets/file-canvas"; do
  if [ -e "$stale" ]; then
    rm -rf "$stale"
    echo "  ✓ removed superseded $(basename "$stale")"
  fi
done

# ── 2. Install dependencies for plugins that build ───────────────────────────
NEEDS_BUILD=0
for plugin in "${PLUGINS[@]}"; do
  [ -n "$(pkg_field "$plugin" 'scripts?.build')" ] && NEEDS_BUILD=1
done
if [ "$NEEDS_BUILD" -eq 1 ] && [ ! -d "$REPO_DIR/node_modules" ]; then
  echo "  · installing build dependencies (first run)…"
  ( cd "$REPO_DIR" && npm install --no-audit --no-fund --silent )
  echo "  ✓ dependencies installed"
fi

# ── 3. Build and install each plugin ─────────────────────────────────────────
for plugin in "${PLUGINS[@]}"; do
  name="$(pkg_field "$plugin" 'name')"
  if [ -z "$name" ]; then
    echo "  ! $(basename "$plugin")/package.json has no name" >&2
    exit 1
  fi

  if [ -n "$(pkg_field "$plugin" 'scripts?.build')" ]; then
    ( cd "$plugin" && npm run build --silent )
  fi

  dest="$PROFILE_MODULES/$name"
  mkdir -p "$(dirname "$dest")"
  rm -rf "$dest"
  mkdir -p "$dest"
  # Copy only what the package declares it ships, plus its manifest, so build
  # inputs and node_modules never reach the profile.
  cp "$plugin/package.json" "$dest/"
  while IFS= read -r entry; do
    [ -z "$entry" ] && continue
    [ -e "$plugin/$entry" ] || continue
    # `files` entries may name a nested path ("lib/index.js"), so the parent
    # has to exist before the copy — cp will not create it, and a swallowed
    # failure here would install a package missing its entry point.
    mkdir -p "$dest/$(dirname "$entry")"
    cp -R "$plugin/$entry" "$dest/$(dirname "$entry")/"
  done < <(node -p "(JSON.parse(require('fs').readFileSync('$plugin/package.json','utf8')).files ?? []).join('\n')")
  echo "  ✓ installed $name"
done

# ── 4. Generate the profile patch ────────────────────────────────────────────
# Written whole every run. The vendor installer appended to this file, which is
# how it collided with the shipped `[]` placeholder and left the profile
# unparseable; owning the document removes that class of failure.
mkdir -p "$(dirname "$PATCH_FILE")"
if [ -f "$PATCH_FILE" ] && [ ! -f "$PATCH_FILE.pre-my-dsh" ]; then
  cp "$PATCH_FILE" "$PATCH_FILE.pre-my-dsh"
  echo "  ✓ backed up previous patch → $(basename "$PATCH_FILE").pre-my-dsh"
fi

{
  echo "# Managed by my-dsh/plugins/install.sh — regenerated on every install."
  echo "# A top-level YAML array of loader patch entries, merged from each"
  echo "# plugin's own cordis.patch.yml."
  for plugin in "${PLUGINS[@]}"; do
    [ -f "$plugin/cordis.patch.yml" ] || continue
    echo
    echo "# ── $(basename "$plugin") ─────────────────────────────────────────"
    cat "$plugin/cordis.patch.yml"
  done
  echo
  echo "# Mount the $PRESET_ID preset by default."
  echo "- id: agent-presets"
  echo "  config:"
  echo "    default: $PRESET_ID"
} > "$PATCH_FILE"
echo "  ✓ wrote $PATCH_FILE"

# ── 5. Generate the agent preset ─────────────────────────────────────────────
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

STANDARD_PRESET="$(find_standard_preset || true)"
if [ -z "$STANDARD_PRESET" ]; then
  echo "  ! could not find the shipped standard preset" >&2
  exit 1
fi

mkdir -p "$PRESET_DIR"
cp "$STANDARD_PRESET" "$PRESET_DIR/agent.cordis.yml"
for plugin in "${PLUGINS[@]}"; do
  [ -f "$plugin/agent.preset.yml" ] || continue
  {
    echo
    echo "# ── $(basename "$plugin") ─────────────────────────────────────────"
    cat "$plugin/agent.preset.yml"
  } >> "$PRESET_DIR/agent.cordis.yml"
  echo "  ✓ added $(basename "$plugin") to the $PRESET_ID preset"
done

cat > "$PRESET_DIR/preset.yml" <<'PRESET'
name: Artifacts
description: Standard coding agent plus the show_file tool, for viewing any workspace file as an artifact — source, Markdown, HTML, images, and PDFs.
PRESET
echo "  ✓ wrote preset.yml"

echo
echo "Done. Restart DeepSeek Harness to apply."
