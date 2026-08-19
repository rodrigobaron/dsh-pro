// @my-dsh/tool-file-canvas/route — the contained file route (web context).
//
// `GET /canvas/file?path=…` lets the browser open a path the model never
// touched (clicking a path in the transcript) and stream image/PDF bytes rather
// than carrying base64 through the session log. Containment is `shared.js`'s,
// identical to the tool's: resolution goes through `ctx.fs`, so symlink escapes
// are caught by the backend's canonicalization, not by prefix matching here.
import { classify } from "./filetype.js";
import {
  MAX_STREAM_BYTES,
  PathDenied,
  ROUTE,
  buildEnvelope,
  readCapped,
  resolveContained,
} from "./shared.js";

const name = "tool-file-canvas-route";
// `workspaceRegistry` is required, not optional: it is what makes every open
// workspace readable. Leaving it undeclared meant Cordis refused the access and
// the cwd became the only root, so a click on a path in any other workspace was
// reported as an escape attempt.
const inject = ["webServer", "fs", "workspaceRegistry"];

/**
 * Headers applied to every response.
 *
 * `nosniff` keeps the browser on the declared type, and the CSP neutralizes the
 * one real hazard: a workspace file navigated to directly would otherwise
 * execute on the app's own origin. HTML is additionally downgraded to
 * text/plain below — the canvas renders HTML from the envelope in a sandboxed
 * iframe, so nothing legitimate needs it served as markup.
 */
function securityHeaders() {
  return {
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    "Cache-Control": "no-store",
  };
}

function fail(res, status, message) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8", ...securityHeaders() });
  res.end(message);
}

async function handleFileRequest(ctx, req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") return fail(res, 405, "method not allowed");

  const url = new URL(req.url ?? "", "http://localhost");
  const path = url.searchParams.get("path");
  if (!path) return fail(res, 400, "missing ?path");

  // `?meta=1` answers with the same envelope the tool emits, so a file opened
  // by clicking a path in the transcript and one opened by the model reach the
  // canvas as the identical shape — one renderer path, not two.
  if (url.searchParams.get("meta") === "1") {
    // `base` lets the canvas resolve a relative path from the transcript
    // against the file already on screen before falling back to the roots.
    const base = url.searchParams.get("base");
    let envelope;
    try {
      envelope = await buildEnvelope(ctx, path, undefined, undefined, { bases: [base] });
    } catch (error) {
      if (error instanceof PathDenied) return fail(res, 403, "path is outside the workspace");
      return fail(res, 404, "not found");
    }
    const body = Buffer.from(JSON.stringify({ ...envelope, version: 1 }), "utf-8");
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": String(body.byteLength),
      ...securityHeaders(),
    });
    if (req.method === "HEAD") return void res.end();
    return void res.end(body);
  }

  let target;
  try {
    target = await resolveContained(ctx, path, { bases: [url.searchParams.get("base")] });
  } catch (error) {
    // Denied and missing are reported distinctly: the canvas tells the user
    // "outside the workspace" rather than a misleading "not found".
    if (error instanceof PathDenied) return fail(res, 403, "path is outside the workspace");
    return fail(res, 404, "not found");
  }

  let payload;
  try {
    payload = await readCapped(ctx, target, MAX_STREAM_BYTES);
  } catch {
    return fail(res, 404, "not found");
  }

  const kind = classify(path);
  const contentType = kind.type === "html" ? "text/plain; charset=utf-8" : kind.mime;
  res.writeHead(200, {
    "Content-Type": contentType,
    "Content-Length": String(payload.bytes.byteLength),
    ...securityHeaders(),
  });
  if (req.method === "HEAD") return void res.end();
  res.end(Buffer.from(payload.bytes));
}

function apply(ctx) {
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: "exact",
        path: ROUTE,
        handler: (req, res) =>
          handleFileRequest(ctx, req, res).catch(() => {
            if (!res.headersSent) fail(res, 500, "read failed");
            else res.end();
          }),
      }),
    "file-canvas: file route",
  );
}

export { apply, inject, name };
