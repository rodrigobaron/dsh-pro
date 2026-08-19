// Shared core of the file canvas host: path resolution, containment, capped
// reads, and the one envelope shape both halves emit. Imported by the tool
// plugin (agent context) and the route plugin (web context), which run in
// different Cordis contexts and therefore load as separate entries.
import { classify, looksTextual } from "./filetype.js";

/** Route the browser fetches for on-demand reads and binary streaming. */
const ROUTE = "/canvas/file";

/** Ceiling on text embedded in a tool result — beyond this the canvas fetches. */
const MAX_EMBED_BYTES = 512 * 1024;

/** Ceiling on a single route response, so one request cannot exhaust memory. */
const MAX_STREAM_BYTES = 32 * 1024 * 1024;

/** Raised when a path resolves outside every allowed root. */
class PathDenied extends Error {}
/** Raised when a path does not exist or is not a regular file. */
class PathUnreadable extends Error {}

// ── roots ───────────────────────────────────────────────────────────────────

/**
 * Directory paths every read is confined to.
 *
 * The process cwd is only ever *one* of these. The harness is routinely
 * launched from a directory unrelated to the workspace being worked in, so
 * treating cwd as the root makes every path in the actual workspace look like
 * an escape attempt.
 *
 * @param ctx - plugin context; `workspaceRegistry` is read when injected.
 * @param extra - additional roots, e.g. the calling session's own workspace.
 */
function rootPaths(ctx, extra = []) {
  const paths = [];
  for (const p of extra) if (p) paths.push(p);
  try {
    for (const ws of ctx.workspaceRegistry?.list?.() ?? []) {
      if (ws?.path) paths.push(ws.path);
    }
  } catch {
    // Cordis refuses service access that was never injected; a composition
    // without the registry still has the session and cwd roots below.
  }
  paths.push(process.cwd());
  return [...new Set(paths)];
}

/** Resolve each root path to a target, dropping any that no longer exist. */
async function allowedRoots(ctx, extra = []) {
  const roots = [];
  for (const path of rootPaths(ctx, extra)) {
    try {
      roots.push({ path, target: await ctx.fs.resolve(path) });
    } catch {
      // A configured workspace whose directory is gone simply grants nothing.
    }
  }
  return roots;
}

/**
 * Resolve a caller-supplied path and prove it lands inside an allowed root.
 *
 * An absolute path is taken as given. A relative one is tried against each root
 * in turn — the session's workspace first — and the first candidate that both
 * exists and is contained wins, so `src/main.py` means the file in the session's
 * workspace rather than one in whatever directory the harness was launched from.
 *
 * @param opts.bases - preferred base directories, highest priority first.
 * @throws {PathDenied} when candidates resolved but all escaped their roots.
 * @throws {PathUnreadable} when nothing resolved to an existing file.
 */
async function resolveContained(ctx, path, opts = {}) {
  const roots = await allowedRoots(ctx, opts.bases ?? []);
  const absolute = /^([a-zA-Z]:[\\/]|[\\/])/.test(path);
  const bases = absolute ? [undefined] : roots.map((root) => root.path);

  let sawEscape = false;
  let fallback;

  for (const base of bases) {
    let target;
    try {
      target = await ctx.fs.resolve(path, base === undefined ? {} : { cwd: base });
    } catch {
      continue;
    }
    const contained = roots.some((root) => ctx.fs.contains(root.target, target));
    if (!contained) {
      sawEscape = true;
      continue;
    }
    // Prefer a candidate that actually exists; a contained-but-absent one is
    // still the better error (404 over 403) if nothing else matches.
    const info = await ctx.fs.stat(target).catch(() => undefined);
    if (info) return target;
    fallback ??= target;
  }

  if (fallback) return fallback;
  if (sawEscape) {
    throw new PathDenied(
      `${path} is outside the workspace (roots: ${roots.map((r) => r.path).join(", ") || "none"})`,
    );
  }
  throw new PathUnreadable(`cannot resolve ${path}`);
}

// ── reading ─────────────────────────────────────────────────────────────────

/**
 * Read at most `limit` bytes of a target.
 * @returns the bytes, and whether the file continues past what was read.
 */
async function readCapped(ctx, target, limit, signal) {
  const info = await ctx.fs.stat(target, signal);
  if (!info) throw new PathUnreadable("no such file");
  if (info.type !== "file") throw new PathUnreadable(`not a regular file (${info.type})`);

  const size = typeof info.size === "number" ? info.size : undefined;
  const bytes = await ctx.fs.readBytes(target, signal, limit);
  const truncated = size !== undefined ? size > bytes.byteLength : bytes.byteLength >= limit;
  return { bytes, size: size ?? bytes.byteLength, truncated };
}

/** Same-origin URL the client uses to fetch (or stream) one path. */
function fileUrl(path) {
  return `${ROUTE}?path=${encodeURIComponent(path)}`;
}

/** Stable per-path id, so reopening a file revises it instead of duplicating. */
function artifactIdFor(path) {
  const slug = String(path)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(-60);
  return `file-${slug || "untitled"}`;
}

/** Basename for the default artifact title. */
function basename(path) {
  const parts = String(path).split(/[\\/]/);
  return parts[parts.length - 1] || String(path);
}

/**
 * Build the canvas envelope for one path: the single shape both triggers emit
 * and the only shape the client renderer dispatches on.
 */
async function buildEnvelope(ctx, path, title, signal, opts = {}) {
  const target = await resolveContained(ctx, path, opts);
  const kind = classify(path);
  const processPath = ctx.fs.processPath(target);

  // Images and PDFs are never embedded: the canvas points an <img>/<embed> at
  // the route and the browser streams the bytes.
  if (!kind.text) {
    const info = await ctx.fs.stat(target, signal);
    if (!info) throw new PathUnreadable("no such file");
    if (info.type !== "file") throw new PathUnreadable(`not a regular file (${info.type})`);
    return {
      artifact_id: artifactIdFor(processPath),
      title: title || basename(path),
      path: processPath,
      type: kind.type,
      language: kind.language,
      url: fileUrl(processPath),
      size: info.size ?? 0,
      truncated: false,
    };
  }

  const { bytes, size, truncated } = await readCapped(ctx, target, MAX_EMBED_BYTES, signal);

  // An unknown extension is only `binary` until the bytes say otherwise; a
  // LICENSE or a .conf reads as text and deserves the code view, not a
  // download card.
  if (!looksTextual(bytes)) {
    return {
      artifact_id: artifactIdFor(processPath),
      title: title || basename(path),
      path: processPath,
      type: "binary",
      url: fileUrl(processPath),
      size,
      truncated: false,
    };
  }

  return {
    artifact_id: artifactIdFor(processPath),
    title: title || basename(path),
    path: processPath,
    type: kind.type,
    language: kind.language ?? "text",
    content: new TextDecoder("utf-8").decode(bytes),
    url: fileUrl(processPath),
    size,
    truncated,
  };
}

export {
  PathDenied,
  PathUnreadable,
  ROUTE,
  MAX_EMBED_BYTES,
  MAX_STREAM_BYTES,
  allowedRoots,
  rootPaths,
  resolveContained,
  readCapped,
  fileUrl,
  artifactIdFor,
  basename,
  buildEnvelope,
};
