# The @ path picker

Type `@` in the composer to search the workspace and insert a path. Choosing a
result leaves the path visible in the draft and in a reference bar above it.

The point is what it does **not** do. It never reads the file. Before the agent
steps, the plugin checks the path still exists inside the workspace and adds one
line:

```xml
<workspace-reference path="docs/spec.pdf" kind="file" />
```

That is the whole payload — a path and a kind. The agent reads the file with
`read`, looks at it with `read_image`, or shows it to you with `show_file`, and
does so only if the task needs it. A 40 MB CSV costs the same as a one-line
config, and referencing ten files costs ten lines.

Pasted `@path` text stays plain text by default, so pasting a shell command
does not silently create references. **Settings -> File mentions** turns that
off, and holds the filename filters (exact or regex, global or per-workspace).

## Naming

The Typert identities are renamed to `@dsh-pro/at-file`. The registry rejects
duplicate package-face keys and duplicate invocation ids, so a fork keeping
upstream's `dsh-at-file` keys could not be installed beside the original. Both
halves build from one `src/contract.ts`, so they cannot drift apart.

One identity is deliberately left alone —
`@deepseek-ai/dsh-session/types#SessionId`. It has to equal the agent lookup
provider's wire identity, and it is not ours to rename.

## Type-checking against the running harness

The client half imports harness client packages for the module augmentations
that declare the composer slots it fills — without them, `conversation.input.dock`
is an unknown string and the file cannot check at all.

Neither usual answer works. Upstream resolves them with `link:` devDependencies
into a sibling harness monorepo, which this repository does not have. Installing
them from npm deadlocks: the published rc.7 packages peer `^0.1.0-rc.7`, npm
resolves that to rc.8, and rc.8 peers `^0.1.0-rc.8`, so the graph has no
solution. Pinning rc.8 installs, but then you are checking against a version
that is not the one running — worse than not checking.

So `typecheck` checks against the harness that IS running:

```bash
npm run typecheck --workspace=@dsh-pro/at-file
```

`scripts/link-harness.mjs` symlinks the installed harness packages into
`node_modules` first, preferring the profile's healed tree and falling back to
the npx cache. The types cannot drift from the deployment, because they are the
deployment. Symlinks rather than tsconfig `paths` keep ordinary resolution, so
each package's `exports` map still governs subpaths like
`@deepseek-ai/dsh-client-runtime/client`.

Only the packages it imports are linked. A partial scope directory does not
shadow the rest of `@deepseek-ai` — node resolves the full package path at each
level — so schemastery still comes from this repository's lockfile and the
build stays reproducible. `npm install` prunes the links, which is why
`typecheck` rebuilds them every run instead of assuming a setup step.
