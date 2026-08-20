#!/usr/bin/env bash
# Install every plugin in this directory into a DeepSeek Harness profile.
#
# Adding a plugin means adding a directory — this script discovers them rather
# than listing them. A plugin directory is any child of plugins/ holding a
# package.json, and it may contribute three things:
#
#   package.json      required. `name` decides where it installs, a
#                     `scripts.build` entry is run before it is copied, and
#                     `dependencies` travel with it into the profile.
#   cordis.patch.yml  optional. Loader rows merged into the profile patch.
#
# No agent preset is created. A plugin that wants to give the model a tool
# registers it into `agent.ctx.tools` when its skill loads, which works under
# every preset the deployment already has — see tool-file-canvas.
#
# Idempotent: the profile patch and the preset are generated whole on every
# run, so re-running cannot accumulate duplicate rows.
set -euo pipefail

DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGINS_DIR="$REPO_DIR/plugins"

# `--stage <dir>` builds the install into <dir> instead of DSH_HOME, in exactly
# the layout the profile wants, and adds a manifest. That is what CI packs into
# a release tarball, and what @dsh-pro/updates unpacks on the far end. Staging
# through the same code path as a real install is the point: a separate
# "packaging" script is a second definition of what an install *is*, and the two
# drift the moment one of them learns about a new file.
STAGE_DIR=""
while [ $# -gt 0 ]; do
  case "$1" in
    --stage) STAGE_DIR="${2:-}"; shift 2 ;;
    *) echo "  ! unknown argument: $1" >&2; exit 2 ;;
  esac
done

VERSION="$(node -p "require('$REPO_DIR/package.json').version")"

if [ -n "$STAGE_DIR" ]; then
  mkdir -p "$STAGE_DIR"
  STAGE_DIR="$(cd "$STAGE_DIR" && pwd)"
  PROFILE_MODULES="$STAGE_DIR/modules"
  PATCH_FILE="$STAGE_DIR/cordis.patch.yml"
  echo "dsh-pro release staging (v$VERSION)"
  echo "  staging into: $STAGE_DIR"
else
  PROFILE_MODULES="$DSH_HOME/profiles/node_modules"
  PATCH_FILE="$DSH_HOME/profiles/web/cordis.patch.yml"
  echo "dsh-pro plugin installer (v$VERSION)"
  echo "  DSH_HOME: $DSH_HOME"
fi
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

has_runtime_deps() {
  [ "$(node -p "Object.keys(JSON.parse(require('fs').readFileSync('$1/package.json','utf8')).dependencies ?? {}).length")" != "0" ]
}

# Every production dependency of one plugin, transitive closure included, as
# paths relative to the repo's node_modules. npm resolves the tree because
# walking package.json by hand would miss both hoisting and nested installs.
runtime_deps() {
  local pkg="$1" listing
  listing="$( cd "$REPO_DIR" && npm ls --workspace="$pkg" --omit=dev --parseable --all 2>/dev/null || true )"
  printf '%s\n' "$listing" \
    | sed -n "s|^$REPO_DIR/node_modules/||p" \
    | { grep -v "^$pkg\$" || true; }
}

# ── 1. Retire the vendored dsh-artifacts install ─────────────────────────────
# Only from DSH_HOME — the reference checkouts in the repo are left alone.
# Includes the presets earlier versions of this installer created; the
# repository no longer owns any preset.
# The whole @my-dsh scope goes too: the packages were renamed to @dsh-pro, and
# an old copy left in DSH_HOME would keep loading ALONGSIDE the new one —
# two of every plugin, both claiming the same slots.
#
# @dsh-pro/workflow is retired rather than merely deleted from the repo: an
# install left behind in DSH_HOME would keep loading, and its browser half
# suppresses the harness's own workflow node — so a stale copy would leave
# workflow runs invisible with nothing in the repo to explain why.
if [ -z "$STAGE_DIR" ]; then
  for stale in "$PROFILE_MODULES/@dsh-artifact" "$PROFILE_MODULES/@my-dsh" "$PROFILE_MODULES/@dsh-pro/workflow" "$DSH_HOME/.agent-presets/artifact" "$DSH_HOME/.agent-presets/file-canvas" "$DSH_HOME/.agent-presets/artifacts"; do
    if [ -e "$stale" ]; then
      rm -rf "$stale"
      echo "  ✓ removed superseded $(basename "$stale")"
    fi
  done
fi

# ── 2. Install dependencies for plugins that build ───────────────────────────
NEEDS_INSTALL=0
[ -d "$REPO_DIR/node_modules" ] || NEEDS_INSTALL=1
for plugin in "${PLUGINS[@]}"; do
  [ -n "$(pkg_field "$plugin" 'scripts?.build')" ] || continue
  [ -d "$REPO_DIR/node_modules" ] || NEEDS_INSTALL=1
done
# A runtime dependency that is declared but absent means node_modules predates
# it; the copy in step 3 would otherwise fail with a confusing message.
for plugin in "${PLUGINS[@]}"; do
  has_runtime_deps "$plugin" || continue
  while IFS= read -r dep; do
    [ -z "$dep" ] && continue
    [ -d "$REPO_DIR/node_modules/$dep" ] || NEEDS_INSTALL=1
  done < <(node -p "Object.keys(JSON.parse(require('fs').readFileSync('$plugin/package.json','utf8')).dependencies ?? {}).join('\n')")
done
if [ "$NEEDS_INSTALL" -eq 1 ]; then
  echo "  · installing dependencies…"
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

  # Runtime dependencies travel with the plugin. The profile resolves only what
  # the harness itself ships, so node finds a dependency at
  # <dest>/node_modules/<dep> when it loads <dest>/lib/index.js. Bundling is the
  # cheaper answer and is what most plugins here do; this is for packages that
  # cannot be bundled — playwright-core locates its driver and its browser
  # builds relative to its own install path, so it has to be a real directory.
  if has_runtime_deps "$plugin"; then
    deps=0
    while IFS= read -r dep; do
      [ -z "$dep" ] && continue
      if [ ! -d "$REPO_DIR/node_modules/$dep" ]; then
        echo "  ! $name depends on $dep, which is not installed — run npm install" >&2
        exit 1
      fi
      mkdir -p "$dest/node_modules/$(dirname "$dep")"
      cp -R "$REPO_DIR/node_modules/$dep" "$dest/node_modules/$dep"
      deps=$((deps + 1))
    done < <(runtime_deps "$name")
    if [ "$deps" -gt 0 ]; then
      [ "$deps" -eq 1 ] && unit=dependency || unit=dependencies
      echo "  · $name: carried $deps runtime $unit"
    fi
  fi
  echo "  ✓ installed $name"
done

# ── 4. Generate the profile patch ────────────────────────────────────────────
# Written whole every run. The vendor installer appended to this file, which is
# how it collided with the shipped `[]` placeholder and left the profile
# unparseable; owning the document removes that class of failure.
mkdir -p "$(dirname "$PATCH_FILE")"
if [ -z "$STAGE_DIR" ] && [ -f "$PATCH_FILE" ] && [ ! -f "$PATCH_FILE.pre-my-dsh" ]; then
  cp "$PATCH_FILE" "$PATCH_FILE.pre-my-dsh"
  echo "  ✓ backed up previous patch → $(basename "$PATCH_FILE").pre-my-dsh"
fi

{
  echo "# Managed by dsh-pro/install.sh — regenerated on every install."
  echo "# A top-level YAML array of loader patch entries, merged from each"
  echo "# plugin's own cordis.patch.yml."
  for plugin in "${PLUGINS[@]}"; do
    [ -f "$plugin/cordis.patch.yml" ] || continue
    echo
    echo "# ── $(basename "$plugin") ─────────────────────────────────────────"
    cat "$plugin/cordis.patch.yml"
  done
} > "$PATCH_FILE"
echo "  ✓ wrote $PATCH_FILE"

# ── 5. Stamp what was installed ──────────────────────────────────────────────
# @dsh-pro/updates compares the installed version against the newest GitHub
# release, so an install has to leave a record of what it is. Without this the
# updater cannot tell 0.1.0 from a build off main and would offer every release
# forever.
COMMIT="$(git -C "$REPO_DIR" rev-parse --short HEAD 2>/dev/null || echo unknown)"
BUILT_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
PLUGIN_NAMES="$(for p in "${PLUGINS[@]}"; do pkg_field "$p" 'name'; done | paste -sd, -)"

if [ -n "$STAGE_DIR" ]; then
  node -e '
    const [dir, version, commit, builtAt, names] = process.argv.slice(1)
    const manifest = { version, commit, builtAt, plugins: names.split(",").filter(Boolean) }
    require("fs").writeFileSync(dir + "/manifest.json", JSON.stringify(manifest, null, 2) + "\n")
  ' "$STAGE_DIR" "$VERSION" "$COMMIT" "$BUILT_AT" "$PLUGIN_NAMES"
  echo "  ✓ wrote $STAGE_DIR/manifest.json"
  echo
  echo "Staged v$VERSION. Pack $STAGE_DIR into the release tarball."
else
  node -e '
    const [dir, version, commit, builtAt, names, source] = process.argv.slice(1)
    const marker = { version, commit, builtAt, source, plugins: names.split(",").filter(Boolean) }
    require("fs").writeFileSync(dir + "/.release.json", JSON.stringify(marker, null, 2) + "\n")
  ' "$PROFILE_MODULES/@dsh-pro" "$VERSION" "$COMMIT" "$BUILT_AT" "$PLUGIN_NAMES" "local"
  echo "  ✓ stamped v$VERSION"
  echo
  echo "Done. Restart DeepSeek Harness to apply."
fi
