// @my-dsh/client-ui-file-canvas — browser half of the file canvas.
//
// Renders any workspace file in the `details` side panel. Two things put a file
// there, and both arrive as the same envelope so there is one render path:
//   - the `show_file` tool result, read back off the tool block's `meta`
//     (the host sets it via `output.presentationMeta`), so reopening a session
//     rebuilds the canvas from the log alone;
//   - a click on a file path in the transcript, resolved through
//     `GET /canvas/file?path=…&meta=1`.
//
// Written as plain ESM with `createElement` rather than JSX: the harness bundles
// a package's `./client` export as-is, so avoiding JSX keeps this package free
// of any build step.
//
// Extensibility mirrors the panel it replaces: the canvas declares child slots
// (`canvas.renderer` keyed by envelope type, `canvas.chrome` for toolbar items)
// so another plugin can teach it a new file type without touching this file.
import { CodeBlock, MarkdownText } from "@deepseek-ai/dsh-client-ui-primitives";
import { createElement as h, useEffect, useRef, useState, useSyncExternalStore } from "react";

const name = "@my-dsh/client-ui-file-canvas";
const inject = ["slots", "layout", "sessions"];

/** Host route serving envelopes and raw bytes. Must match the route plugin. */
const FILE_ROUTE = "/canvas/file";

// ── store (per session) ─────────────────────────────────────────────────────
// The selected file is shared between the inline tool card, the path-click
// handler, and the canvas itself, keyed by session so nothing leaks across
// conversations.

const sessions = new Map();
const listeners = new Set();

/** Session id of the most recently mounted canvas, for the global click handler. */
let activeSessionId = null;

/**
 * The layout service, captured at apply time.
 *
 * Opening the panel deliberately does NOT go through a slot-injected prop: a
 * missing prop would be swallowed by an optional call and the canvas would
 * silently refuse to open. Holding the service directly makes the failure
 * loud instead.
 */
let layoutService = null;

/** Open the details column, reporting rather than swallowing a wiring failure. */
function openCanvasPanel() {
  try {
    layoutService?.openDetails();
  } catch (error) {
    console.error("file-canvas: could not open the details panel", error);
  }
}

/** A path clicked before any canvas existed; consumed on the next mount. */
let pendingPath = null;

/**
 * Directory of the file currently on the canvas. A relative path clicked in the
 * transcript most often means "next to what I am already looking at", so it is
 * offered to the host as the first base before the workspace roots.
 */
let currentBase = null;

/** Query string for one path lookup, carrying the base when there is one. */
function fileQuery(path, extra = "") {
  const base = currentBase ? `&base=${encodeURIComponent(currentBase)}` : "";
  return `${FILE_ROUTE}?path=${encodeURIComponent(path)}${base}${extra}`;
}

/** Directory part of a resolved absolute path. */
function dirOf(path) {
  const cut = String(path).lastIndexOf("/");
  return cut > 0 ? String(path).slice(0, cut) : null;
}

function getState(sessionId) {
  let state = sessions.get(sessionId);
  if (!state) {
    state = { selected: null, latest: null, error: null, history: new Map() };
    sessions.set(sessionId, state);
  }
  return state;
}

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function setSelected(sessionId, envelope) {
  const state = getState(sessionId);
  state.selected = envelope;
  state.error = null;
  if (envelope?.path) currentBase = dirOf(envelope.path);
  emit();
}

function setError(sessionId, message) {
  const state = getState(sessionId);
  state.error = message;
  emit();
}

/** Record a file the session has produced, newest version first. */
function noteFile(sessionId, envelope) {
  const state = getState(sessionId);
  state.latest = envelope;
  const versions = state.history.get(envelope.artifact_id) ?? [];
  const known = versions.some((v) => v.version === envelope.version);
  if (!known) state.history.set(envelope.artifact_id, [envelope, ...versions]);
  if (!state.selected) state.selected = envelope;
  emit();
}

function useSession(sessionId) {
  return useSyncExternalStore(
    subscribe,
    () => (sessionId ? sessions.get(sessionId) ?? null : null),
    () => null,
  );
}

// ── envelope sources ────────────────────────────────────────────────────────

/** Pull the file envelope off a `show_file` tool block, running or settled. */
function envelopeFromBlock(block) {
  if (block && block.kind === "tool-result") {
    const meta = block.meta;
    return meta && meta.artifact_id && meta.path ? meta : null;
  }
  // A running call has only raw args; show what it is about to open.
  try {
    const args = JSON.parse(block?.argsRaw ?? "{}");
    if (args && args.path) {
      return {
        artifact_id: `file-${args.path}`,
        title: args.title || String(args.path).split(/[\\/]/).pop(),
        path: args.path,
        type: "pending",
        size: 0,
        truncated: false,
      };
    }
  } catch {
    /* a half-streamed argument object is simply not openable yet */
  }
  return null;
}

/** Ask the host for one path's envelope. */
async function fetchEnvelope(path) {
  const response = await fetch(fileQuery(path, "&meta=1"));
  if (!response.ok) throw new Error(await response.text().catch(() => `HTTP ${response.status}`));
  return response.json();
}

/**
 * Open a path on the canvas. Called by the path-click handler and the canvas's
 * own path box; both may run before a canvas has ever mounted, so a path with
 * nowhere to go is parked until one does.
 */
async function openPath(sessionId, path, openDetails) {
  if (!sessionId) {
    pendingPath = path;
    openDetails?.();
    return;
  }
  try {
    const envelope = await fetchEnvelope(path);
    setSelected(sessionId, envelope);
    openDetails?.();
  } catch (error) {
    setError(sessionId, `Could not open ${path}: ${error.message || error}`);
    openDetails?.();
  }
}

// ── renderers ───────────────────────────────────────────────────────────────

const fill = { width: "100%", height: "100%", border: "none" };

function HtmlRenderer({ envelope, preview }) {
  // Sandboxed iframe on an opaque origin: scripts may run, but the document
  // cannot reach the app's origin, cookies, or DOM.
  return h("iframe", {
    sandbox: "allow-scripts",
    srcDoc: envelope.content ?? "",
    title: envelope.title,
    // A preview is a thumbnail, not a viewport: suppress its scrollbar so the
    // card never looks scrollable.
    scrolling: preview ? "no" : undefined,
    style: { ...fill, background: "#fff" },
  });
}

function MarkdownRenderer({ envelope }) {
  return h(
    "div",
    { style: { padding: "16px", overflow: "auto", height: "100%" } },
    h(MarkdownText, { text: envelope.content ?? "" }),
  );
}

function CodeRenderer({ envelope }) {
  return h(
    "div",
    { style: { overflow: "auto", height: "100%" } },
    h(CodeBlock, {
      code: envelope.content ?? "",
      lang: envelope.language ?? "text",
      copyLabel: "Copy",
      copiedLabel: "Copied",
    }),
  );
}

function ImageRenderer({ envelope }) {
  // Checkerboard so transparent images read as transparent rather than as
  // whatever the current theme happens to be.
  const checker =
    "repeating-conic-gradient(var(--dsw-alias-bg-base) 0% 25%, var(--dsw-alias-bg-l2) 0% 50%) 50% / 16px 16px";
  return h(
    "div",
    {
      style: {
        height: "100%",
        overflow: "auto",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "16px",
        background: checker,
      },
    },
    h("img", {
      src: envelope.url,
      alt: envelope.title,
      style: { maxWidth: "100%", maxHeight: "100%", objectFit: "contain" },
    }),
  );
}

function PdfRenderer({ envelope, preview }) {
  return h("iframe", {
    src: envelope.url,
    title: envelope.title,
    scrolling: preview ? "no" : undefined,
    style: fill,
  });
}

function BinaryRenderer({ envelope }) {
  return h(
    "div",
    { style: { padding: "24px", height: "100%", color: "var(--dsw-alias-label-secondary)" } },
    h("p", { style: { margin: "0 0 8px" } }, `${envelope.title} is not a text file.`),
    h("p", { style: { margin: "0 0 16px", fontSize: "12px" } }, `${formatBytes(envelope.size)} · ${envelope.path}`),
    h("a", { href: envelope.url, download: envelope.title }, "Download"),
  );
}

function PendingRenderer({ envelope }) {
  return h(
    "div",
    { style: { padding: "24px", color: "var(--dsw-alias-label-tertiary)" } },
    `Opening ${envelope.path}…`,
  );
}

/** Last resort for an envelope type nothing has registered a renderer for. */
function RawFallback({ envelope }) {
  return h(
    "pre",
    {
      style: {
        margin: 0,
        padding: "12px",
        overflow: "auto",
        height: "100%",
        whiteSpace: "pre-wrap",
        fontFamily: "var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace)",
      },
    },
    envelope.content ?? `No renderer for "${envelope.type}".`,
  );
}

// ── helpers ─────────────────────────────────────────────────────────────────

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Types whose source is worth reading even though they preview as something else. */
function hasSource(envelope) {
  return typeof envelope.content === "string" && envelope.type !== "code";
}

// ── canvas ──────────────────────────────────────────────────────────────────

function FileCanvas(props) {
  const sessionId = props.sessionId;
  const state = useSession(sessionId);
  const envelope = state?.selected ?? null;
  const error = state?.error ?? null;
  const renderSlot = props.renderSlot;
  const closeDetails = props.closeDetails;
  const [view, setView] = useState("preview");
  const rootRef = useRef(null);

  // Claim the active session for the global path-click handler, and pick up a
  // path that was clicked before any canvas existed.
  useEffect(() => {
    if (!sessionId) return;
    activeSessionId = sessionId;
    if (pendingPath) {
      const path = pendingPath;
      pendingPath = null;
      void openPath(sessionId, path);
    }
  }, [sessionId]);

  if (error) {
    return h(
      "div",
      { style: { padding: "16px", color: "var(--dsw-alias-label-secondary)" } },
      h("p", { style: { margin: 0 } }, error),
    );
  }

  if (!envelope) {
    return h(
      "div",
      { style: { padding: "16px", color: "var(--dsw-alias-label-tertiary)" } },
      h(
        "p",
        { style: { margin: 0 } },
        "No artifact open. Ask for a file, or click a file path in the conversation.",
      ),
    );
  }

  const showSource = view === "source" && hasSource(envelope);
  // `renderSlot(key, owner, opts)` spreads `owner` as the entry's props, so the
  // owner must be the prop object itself — passing the envelope bare would give
  // every renderer `props.envelope === undefined`.
  const owner = { envelope };
  const body = showSource
    ? h(CodeRenderer, owner)
    : renderSlot?.("canvas.renderer", owner, {
        entryKey: envelope.type,
        fallback: h(RawFallback, owner),
      }) ?? h(RawFallback, owner);

  return h(
    "div",
    {
      ref: rootRef,
      style: {
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: "var(--dsw-alias-bg-base)",
      },
    },
    // ── header ──
    h(
      "div",
      {
        style: {
          display: "flex",
          alignItems: "center",
          gap: "8px",
          padding: "8px 12px",
          borderBottom: "1px solid var(--dsw-alias-border-l3)",
          flexShrink: 0,
        },
      },
      h("span", { style: { fontWeight: 600 } }, envelope.title),
      h(
        "span",
        {
          style: {
            opacity: 0.6,
            fontSize: "12px",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          },
          title: envelope.path,
        },
        envelope.path,
      ),
      h("span", { style: { flex: 1 } }),
      envelope.truncated
        ? h(
            "span",
            {
              style: { fontSize: "11px", color: "var(--dsw-alias-label-tertiary)" },
              title: "Only the first part of this file is shown",
            },
            "truncated",
          )
        : null,
      h("span", { style: { fontSize: "11px", opacity: 0.6 } }, formatBytes(envelope.size)),
      hasSource(envelope)
        ? h(
            "button",
            {
              onClick: () => setView(showSource ? "preview" : "source"),
              title: showSource ? "Show preview" : "Show source",
            },
            showSource ? "Preview" : "Source",
          )
        : null,
      renderSlot?.("canvas.chrome", owner) ?? null,
      closeDetails ? h("button", { onClick: closeDetails, title: "Close" }, "×") : null,
    ),
    // ── body ──
    h("div", { style: { flex: 1, minHeight: 0 } }, body),
  );
}

// ── inline tool card ────────────────────────────────────────────────────────

/** Types that fill their box, so the preview needs a fixed height to show them. */
const MEDIA_TYPES = new Set(["html", "image", "pdf"]);

/**
 * The clipped preview inside the chat card.
 *
 * Deliberately not `renderSlot`: the tool-view owner has none of the canvas's
 * child slots, so this mirrors the canvas's dispatch on the same envelope types
 * rather than pretending to be extensible here.
 */
function FilePreview({ envelope }) {
  if (envelope.type === "html") return h(HtmlRenderer, { envelope, preview: true });
  if (envelope.type === "image") return h(ImageRenderer, { envelope });
  if (envelope.type === "pdf") return h(PdfRenderer, { envelope, preview: true });
  if (envelope.type === "markdown") return h(MarkdownRenderer, { envelope });
  if (typeof envelope.content === "string") {
    // Enough to recognize the file, not enough to bloat the transcript.
    return h(
      "pre",
      {
        style: {
          margin: 0,
          padding: "8px",
          overflow: "hidden",
          whiteSpace: "pre-wrap",
          fontFamily: "var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace)",
          fontSize: "12px",
        },
      },
      envelope.content.slice(0, 2000),
    );
  }
  return h(
    "div",
    { style: { padding: "8px", fontSize: "12px", color: "var(--dsw-alias-label-tertiary)" } },
    `${formatBytes(envelope.size)} · no text preview`,
  );
}

function ShowFileToolRow(props) {
  const envelope = envelopeFromBlock(props.block);
  const sessionId = props.sessionId;
  const openCanvas = props.openCanvas;

  useEffect(() => {
    if (envelope && sessionId && envelope.type !== "pending") {
      activeSessionId = sessionId;
      noteFile(sessionId, envelope);
    }
  }, [sessionId, envelope?.artifact_id, envelope?.version]);

  if (!envelope) return null;
  const fixedHeight = MEDIA_TYPES.has(envelope.type);
  return h(
    "div",
    {
      style: {
        padding: "8px 12px",
        border: "1px solid var(--dsw-alias-border-l3)",
        borderRadius: "8px",
      },
    },
    h(
      "div",
      { style: { display: "flex", alignItems: "center", gap: "8px" } },
      h("span", { style: { fontWeight: 600 } }, envelope.title),
      h("span", { style: { opacity: 0.6, fontSize: "12px" } }, envelope.type),
      h("span", { style: { flex: 1 } }),
      h(
        "button",
        {
          onClick: () => {
            if (sessionId) setSelected(sessionId, envelope);
            (openCanvas ?? openCanvasPanel)();
          },
        },
        "Open artifact",
      ),
    ),
    envelope.type === "pending"
      ? null
      : h(
          "div",
          {
            style: {
              // Media fills its box, so it needs a height; text only needs a
              // ceiling, or a three-line file would sit in 220px of blank.
              // Embedded frames swallow the wheel, so a scroll that happens to
              // pass over the card would scroll the artifact instead of the
              // transcript — media previews are inert, text stays selectable.
              ...(fixedHeight
                ? { height: "220px", pointerEvents: "none" }
                : { maxHeight: "220px" }),
              overflow: "hidden",
              marginTop: "8px",
            },
          },
          h(FilePreview, { envelope }),
        ),
  );
}

// ── clicking a file path in the transcript ──────────────────────────────────

/**
 * Treat inline code in the transcript as a possible file path.
 *
 * There is no finer seam for decorating message prose, so rather than
 * re-implementing message rendering this listens in the capture phase and only
 * acts once the host confirms the text resolves to a readable file — a click on
 * ordinary inline code (`npm install`, a symbol name) is left completely alone.
 */
function installPathInterception(openDetails) {
  // path → readable?  Caches both answers; a miss must stay cheap because every
  // hover over inline code asks.
  const known = new Map();

  const looksLikePath = (text) =>
    text.length > 0 &&
    text.length < 512 &&
    !/\s/.test(text) &&
    !text.startsWith("-") &&
    /[./\\]/.test(text);

  async function readable(path) {
    if (known.has(path)) return known.get(path);
    let ok = false;
    try {
      const response = await fetch(fileQuery(path, "&meta=1"), { method: "HEAD" });
      ok = response.ok;
    } catch {
      ok = false;
    }
    known.set(path, ok);
    return ok;
  }

  const codeAncestor = (node) => {
    for (let el = node; el && el !== document.body; el = el.parentElement) {
      if (el.tagName === "CODE" || el.tagName === "KBD") return el;
    }
    return null;
  };

  // Hover marks a real path as clickable, so the affordance exists before the
  // click rather than the click failing silently.
  const onOver = (event) => {
    const el = codeAncestor(event.target);
    if (!el || el.dataset.canvasPath) return;
    const text = (el.textContent ?? "").trim();
    if (!looksLikePath(text)) return;
    void readable(text).then((ok) => {
      if (!ok) return;
      el.dataset.canvasPath = text;
      el.style.cursor = "pointer";
      el.style.textDecoration = "underline dotted";
      el.title = "Open artifact";
    });
  };

  const onClick = (event) => {
    const el = codeAncestor(event.target);
    if (!el) return;
    const text = (el.dataset.canvasPath ?? el.textContent ?? "").trim();
    if (!looksLikePath(text)) return;
    // Only claim the click once the path is known-readable; an unverified path
    // falls through to whatever the app would normally do.
    if (known.get(text) !== true) {
      void readable(text).then((ok) => {
        if (ok) void openPath(activeSessionId, text, openDetails);
      });
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    void openPath(activeSessionId, text, openDetails);
  };

  document.addEventListener("mouseover", onOver, true);
  document.addEventListener("click", onClick, true);
  return () => {
    document.removeEventListener("mouseover", onOver, true);
    document.removeEventListener("click", onClick, true);
  };
}

// ── plugin body ─────────────────────────────────────────────────────────────

function apply(ctx) {
  const layout = ctx.layout;
  layoutService = layout;

  ctx.slots.inject("details", () =>
    ctx.slots.register(
      {
        name: "details",
        // The single `details` seat goes to the lowest priority. -20 also wins
        // against the vendored artifact canvas at -10, so the two can coexist
        // during a migration without a coin flip deciding the panel.
        priority: -20,
        children: {
          "canvas.renderer": { kind: "keyed", scope: "session" },
          "canvas.chrome": { kind: "list", scope: "session" },
        },
        inject: (sessionId) => ({
          sessionId,
          closeDetails: () => layout.closeDetails(),
        }),
      },
      FileCanvas,
    ),
  );

  const renderers = {
    html: HtmlRenderer,
    markdown: MarkdownRenderer,
    code: CodeRenderer,
    image: ImageRenderer,
    pdf: PdfRenderer,
    binary: BinaryRenderer,
    pending: PendingRenderer,
  };
  for (const [key, component] of Object.entries(renderers)) {
    ctx.slots.inject("canvas.renderer", () =>
      ctx.slots.register({ name: "canvas.renderer", key }, component),
    );
  }

  ctx.slots.inject("tool.call.toolview", () =>
    ctx.slots.register(
      {
        name: "tool.call.toolview",
        key: "show_file",
        inject: (sessionId) => ({ sessionId, openCanvas: () => layout.openDetails() }),
      },
      ShowFileToolRow,
    ),
  );

  ctx.effect(
    () => installPathInterception(openCanvasPanel),
    "file-canvas: transcript path clicks",
  );
}

export { apply, inject, name };
