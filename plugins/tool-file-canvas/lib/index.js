// @my-dsh/tool-file-canvas — the `show_file` tool (agent context).
//
// Puts a workspace file on the canvas. The envelope rides
// `output.presentationMeta`, so the canvas rebuilds every opened file from the
// session log alone, and the file body never has to pass through the model.
//
// The companion route plugin (`@my-dsh/tool-file-canvas/route`) loads in the
// web context and serves the same envelopes' `url` field; the two halves are
// separate loader entries because `tools` and `webServer` live in different
// Cordis contexts.
import { defineTool } from "@deepseek-ai/dsh-tools";
import { buildEnvelope } from "./shared.js";

const name = "tool-file-canvas";
// `workspaceRegistry` is read defensively in shared.js when present. It is not
// required here because the authoritative root for a tool call is the calling
// session's own workspace, which arrives on the execution context.
const inject = ["tools", "systemPrompt", "fs", "workspaceRegistry"];

function apply(ctx) {
  ctx.systemPrompt.section({
    name: "tool:show_file",
    order: 101,
    text: [
      "Use the show_file tool to display a file from the workspace to the user as an artifact — source code, Markdown, HTML, images, PDFs, or data files.",
      "It is not an alternative to read: read pulls a file into your context so you can reason about it, while show_file puts the file in front of the user and never enters your context. Use show_file when the user wants to LOOK at a file, and read when YOU need its contents; neither one implies the other.",
      "Pass the path exactly as the user wrote it, relative to the workspace root. show_file does not modify anything, so it is always safe to call.",
    ].join(" "),
  });

  // Per-process revision counter keyed by artifact id. Durable tool results
  // still record every open, so the client rebuilds history from the log; this
  // only decides the next version number within a live process.
  const versions = new Map();

  ctx.tools.register(
    defineTool({
      name: "show_file",
      description:
        "Open a workspace file as an artifact: source code, Markdown, HTML, images, PDFs, or data files. Read-only.",
      parameters: {
        path: {
          type: "string",
          required: true,
          description:
            "Path to the file, absolute or relative to the workspace root. Must be inside the workspace.",
        },
        title: {
          type: "string",
          description: "Optional heading for the artifact; defaults to the file name.",
        },
      },
      output: {
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            artifact_id: { type: "string", required: true },
            title: { type: "string", required: true },
            path: { type: "string", required: true },
            type: { type: "string", required: true },
            language: { type: "string" },
            content: { type: "string" },
            url: { type: "string" },
            size: { type: "number", required: true },
            truncated: { type: "boolean", required: true },
            version: { type: "number", required: true },
          },
        },
        render: (_args, value) => [
          {
            type: "text",
            text: `Opened ${value.path} (${value.type}${value.language ? `/${value.language}` : ""}, ${value.size} bytes${value.truncated ? ", truncated in the artifact preview" : ""}) as an artifact.`,
          },
        ],
        presentationMeta: (_args, value) => value,
      },
      async execute(args, exec) {
        // The session's workspace is the base a relative path is meant to be
        // read against — the harness is routinely launched from somewhere else
        // entirely, so `process.cwd()` is the wrong answer far more often than
        // it is the right one.
        const sessionCwd = exec?.agent?.session?.header?.cwd;
        const envelope = await buildEnvelope(ctx, args.path, args.title, exec?.signal, {
          bases: [sessionCwd],
        });
        const next = (versions.get(envelope.artifact_id) ?? 0) + 1;
        versions.set(envelope.artifact_id, next);
        return { ...envelope, version: next };
      },
      presentCall(args) {
        return { card: "generic", title: `Open ${args.path}`, kind: "other" };
      },
      presentResult(_args, result) {
        // `ToolResult` is { content, isError, meta } — there is no `value` here.
        // `meta` is the presentationMeta payload threaded verbatim from the
        // tool/result event, and it is absent for a nested or composite call,
        // so a missing one keeps the pending title rather than throwing.
        if (result.isError) return void 0;
        const meta = result.meta;
        return meta && meta.title ? { card: "generic", title: `Artifact: ${meta.title}` } : void 0;
      },
    }),
  );
}

export { apply, inject, name };
