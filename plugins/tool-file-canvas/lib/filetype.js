// Extension → canvas type, renderer language, and HTTP content type.
//
// One table drives three decisions that must never disagree: which renderer the
// canvas picks (`type`), how a code view highlights it (`language`), and what
// the file route sets as `Content-Type`. `text` says whether the host may embed
// the bytes in the tool result as a UTF-8 string, or must hand the client a URL
// and let the browser stream the bytes itself.

/** @type {Record<string, {type: string, language?: string, mime: string, text: boolean}>} */
const TABLE = {
  // ── documents the canvas renders as something other than source ──────────
  html: { type: "html", language: "html", mime: "text/html; charset=utf-8", text: true },
  htm: { type: "html", language: "html", mime: "text/html; charset=utf-8", text: true },
  md: { type: "markdown", language: "markdown", mime: "text/markdown; charset=utf-8", text: true },
  markdown: { type: "markdown", language: "markdown", mime: "text/markdown; charset=utf-8", text: true },
  mdx: { type: "markdown", language: "markdown", mime: "text/markdown; charset=utf-8", text: true },

  // ── raster images: streamed, never embedded ──────────────────────────────
  png: { type: "image", mime: "image/png", text: false },
  jpg: { type: "image", mime: "image/jpeg", text: false },
  jpeg: { type: "image", mime: "image/jpeg", text: false },
  gif: { type: "image", mime: "image/gif", text: false },
  webp: { type: "image", mime: "image/webp", text: false },
  avif: { type: "image", mime: "image/avif", text: false },
  bmp: { type: "image", mime: "image/bmp", text: false },
  ico: { type: "image", mime: "image/x-icon", text: false },

  // SVG is both a picture and source, so it is text: the canvas offers a
  // preview/source toggle and the code view has something to show.
  svg: { type: "image", language: "xml", mime: "image/svg+xml", text: true },
  pdf: { type: "pdf", mime: "application/pdf", text: false },

  // ── source and data files: `code`, distinguished by language id ───────────
  js: { type: "code", language: "javascript", mime: "text/javascript; charset=utf-8", text: true },
  mjs: { type: "code", language: "javascript", mime: "text/javascript; charset=utf-8", text: true },
  cjs: { type: "code", language: "javascript", mime: "text/javascript; charset=utf-8", text: true },
  jsx: { type: "code", language: "jsx", mime: "text/javascript; charset=utf-8", text: true },
  ts: { type: "code", language: "typescript", mime: "text/plain; charset=utf-8", text: true },
  tsx: { type: "code", language: "tsx", mime: "text/plain; charset=utf-8", text: true },
  py: { type: "code", language: "python", mime: "text/plain; charset=utf-8", text: true },
  rb: { type: "code", language: "ruby", mime: "text/plain; charset=utf-8", text: true },
  go: { type: "code", language: "go", mime: "text/plain; charset=utf-8", text: true },
  rs: { type: "code", language: "rust", mime: "text/plain; charset=utf-8", text: true },
  java: { type: "code", language: "java", mime: "text/plain; charset=utf-8", text: true },
  kt: { type: "code", language: "kotlin", mime: "text/plain; charset=utf-8", text: true },
  swift: { type: "code", language: "swift", mime: "text/plain; charset=utf-8", text: true },
  c: { type: "code", language: "c", mime: "text/plain; charset=utf-8", text: true },
  h: { type: "code", language: "c", mime: "text/plain; charset=utf-8", text: true },
  cpp: { type: "code", language: "cpp", mime: "text/plain; charset=utf-8", text: true },
  cc: { type: "code", language: "cpp", mime: "text/plain; charset=utf-8", text: true },
  hpp: { type: "code", language: "cpp", mime: "text/plain; charset=utf-8", text: true },
  cs: { type: "code", language: "csharp", mime: "text/plain; charset=utf-8", text: true },
  php: { type: "code", language: "php", mime: "text/plain; charset=utf-8", text: true },
  sh: { type: "code", language: "bash", mime: "text/plain; charset=utf-8", text: true },
  bash: { type: "code", language: "bash", mime: "text/plain; charset=utf-8", text: true },
  zsh: { type: "code", language: "bash", mime: "text/plain; charset=utf-8", text: true },
  fish: { type: "code", language: "bash", mime: "text/plain; charset=utf-8", text: true },
  sql: { type: "code", language: "sql", mime: "text/plain; charset=utf-8", text: true },
  css: { type: "code", language: "css", mime: "text/css; charset=utf-8", text: true },
  scss: { type: "code", language: "scss", mime: "text/plain; charset=utf-8", text: true },
  less: { type: "code", language: "less", mime: "text/plain; charset=utf-8", text: true },
  json: { type: "code", language: "json", mime: "application/json; charset=utf-8", text: true },
  jsonc: { type: "code", language: "json", mime: "application/json; charset=utf-8", text: true },
  yaml: { type: "code", language: "yaml", mime: "text/plain; charset=utf-8", text: true },
  yml: { type: "code", language: "yaml", mime: "text/plain; charset=utf-8", text: true },
  toml: { type: "code", language: "toml", mime: "text/plain; charset=utf-8", text: true },
  xml: { type: "code", language: "xml", mime: "text/xml; charset=utf-8", text: true },
  ini: { type: "code", language: "ini", mime: "text/plain; charset=utf-8", text: true },
  env: { type: "code", language: "bash", mime: "text/plain; charset=utf-8", text: true },
  graphql: { type: "code", language: "graphql", mime: "text/plain; charset=utf-8", text: true },
  vue: { type: "code", language: "vue", mime: "text/plain; charset=utf-8", text: true },
  svelte: { type: "code", language: "svelte", mime: "text/plain; charset=utf-8", text: true },
  lua: { type: "code", language: "lua", mime: "text/plain; charset=utf-8", text: true },
  r: { type: "code", language: "r", mime: "text/plain; charset=utf-8", text: true },
  pl: { type: "code", language: "perl", mime: "text/plain; charset=utf-8", text: true },
  dockerfile: { type: "code", language: "dockerfile", mime: "text/plain; charset=utf-8", text: true },
  txt: { type: "code", language: "text", mime: "text/plain; charset=utf-8", text: true },
  log: { type: "code", language: "text", mime: "text/plain; charset=utf-8", text: true },
  csv: { type: "code", language: "csv", mime: "text/csv; charset=utf-8", text: true },
};

// Extension-less files that are still ordinary source, keyed by lowercase name.
const BY_NAME = {
  dockerfile: TABLE.dockerfile,
  makefile: { type: "code", language: "makefile", mime: "text/plain; charset=utf-8", text: true },
  ".gitignore": TABLE.env,
  ".dockerignore": TABLE.env,
  ".npmrc": TABLE.ini,
  ".env": TABLE.env,
  license: TABLE.txt,
  readme: TABLE.md,
};

/** Unrecognized bytes: streamed, and shown by the canvas as a download card. */
const BINARY = { type: "binary", mime: "application/octet-stream", text: false };

/** Basename of a POSIX or Windows path, without resolving anything. */
function basename(path) {
  const parts = String(path).split(/[\\/]/);
  return parts[parts.length - 1] || String(path);
}

/**
 * Classify a path by name alone — no I/O, so the same answer is available on
 * the host before reading and on the client before fetching.
 * @param {string} path - file path; only its basename is inspected.
 * @returns {{type: string, language?: string, mime: string, text: boolean}}
 */
export function classify(path) {
  const name = basename(path).toLowerCase();
  if (BY_NAME[name]) return BY_NAME[name];

  const dot = name.lastIndexOf(".");
  // A leading dot is a dotfile (".gitignore"), not an extension.
  if (dot > 0) {
    const ext = name.slice(dot + 1);
    if (TABLE[ext]) return TABLE[ext];
  }
  // Unknown extension, or none at all. Callers that have already sniffed the
  // bytes as valid UTF-8 fall back to a plain text view; the rest stream.
  return BINARY;
}

/** True when a byte buffer looks like UTF-8 text rather than arbitrary bytes. */
export function looksTextual(bytes) {
  // A NUL byte in the first block is the classic binary tell; beyond that, trust
  // a strict UTF-8 decode to reject anything that is not really text.
  const window = bytes.subarray(0, 4096);
  if (window.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(window);
    return true;
  } catch {
    return false;
  }
}

export { BINARY };
