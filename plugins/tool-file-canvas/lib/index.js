// @my-dsh/tool-file-canvas — the `show_file` tool (profile entry).
//
// This is a PROFILE row, not an agent-preset row, so the tool is available
// under every preset — standard, code, minimal, anything — instead of only the
// one preset that happened to list it.
//
// A profile-level plugin has no agent `tools` service of its own, but a tool
// execution carries its agent: the `tools/result` for a `skill` call gives
// `exec.agent`, whose `agent.ctx.tools` accepts the registration. That is how
// the vision toolkit mounts its tools too.
//
// Exposure is progressive: the tool is registered into an agent only once that
// agent calls `skill("file-artifacts")`, so it costs nothing in the tool schema
// until it is wanted, and nothing at all in agents that never need it.
import { defineTool } from "@deepseek-ai/dsh-tools";
import { buildEnvelope } from "./shared.js";

const name = "tool-file-canvas";

// `workspaceRegistry` is read defensively in shared.js, so it is not required
// here — a composition without it still resolves against the session cwd.
const inject = ["skills", "fs"];

/** Skill the model loads to reveal the tool. */
const SKILL_NAME = "file-artifacts";

/** The tool this plugin gates. */
const TOOL_NAME = "show_file";

const SKILL_BODY = [
  "# Showing files to the user",
  "",
  `Use the \`${TOOL_NAME}\` tool to put a workspace file in front of the user as an artifact:`,
  "source code, Markdown, HTML, images, PDFs, or data files. It renders the file with",
  "syntax highlighting or a real preview in a side panel.",
  "",
  "The panel opens by itself when the tool succeeds — the user does not have to click",
  "anything. Say the file is open, not that it is available to open.",
  "",
  "## show_file is not read",
  "",
  "`read` pulls a file into YOUR context so you can reason about it. `show_file` puts the",
  "file in front of the USER and never enters your context. Use `show_file` when the user",
  "wants to LOOK at a file, and `read` when you need its contents. Neither implies the other,",
  "and needing both is normal.",
  "",
  "## Usage",
  "",
  `- \`${TOOL_NAME}({ path })\` — the path exactly as the user wrote it, relative to the workspace root.`,
  "- Pass `title` to override the heading; it defaults to the file name.",
  "- It never modifies anything, so it is always safe to call.",
  "- Prefer it over pasting a file's contents into your reply: the user gets a better view and",
  "  it does not spend context on the file body.",
].join("\n");

function apply(ctx) {
  ctx.effect(
    () =>
      ctx.skills.register({
        name: SKILL_NAME,
        // Required by SkillRegistration and easy to miss, because it is not one
        // of the fields the type omits. Without it the registry accepts the
        // skill but fails when the model loads it: "source must be a string".
        source: "runtime",
        description:
          "Show a workspace file to the user as a rendered artifact — source code, Markdown, HTML, images, PDFs, or data files — in a side panel, without spending context on the file body.",
        whenToUse:
          "Use when the user wants to LOOK at a file rather than have you reason about its contents; this is distinct from read, which loads a file into your own context.",
        content: SKILL_BODY,
      }),
    "file-canvas: skill",
  );

  // Per-process revision counter keyed by artifact id. Durable tool results
  // still record every open, so the client rebuilds history from the log; this
  // only decides the next version number within a live process.
  const versions = new Map();

  const definition = defineTool({
    name: TOOL_NAME,
    description:
      "Show a workspace file to the user as an artifact: source code, Markdown, HTML, images, PDFs, or data files. Read-only.",
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
          text: `Opened ${value.path} in the artifact side panel (${value.type}${value.language ? `/${value.language}` : ""}, ${value.size} bytes${value.truncated ? ", truncated in the preview" : ""}). The panel is now showing it, so tell the user it is open rather than asking them to click anything.`,
        },
      ],
      presentationMeta: (_args, value) => value,
    },
    async execute(args, exec) {
      // The session's workspace is the base a relative path is meant to be read
      // against — the harness is routinely launched from somewhere else
      // entirely, so `process.cwd()` is the wrong answer far more often than it
      // is the right one.
      const sessionCwd = exec?.agent?.session?.header?.cwd;
      const envelope = await buildEnvelope(ctx, args.path, args.title, exec?.signal, {
        bases: [sessionCwd],
      });
      const next = (versions.get(envelope.artifact_id) ?? 0) + 1;
      versions.set(envelope.artifact_id, next);
      return { ...envelope, version: next };
    },
    presentCall(args) {
      return { card: "generic", title: `Show ${args.path}`, kind: "other" };
    },
    presentResult(_args, result) {
      // `ToolResult` is { content, isError, meta } — there is no `value` here.
      if (result.isError) return void 0;
      const meta = result.meta;
      return meta && meta.title ? { card: "generic", title: `Artifact: ${meta.title}` } : void 0;
    },
  });

  // ── progressive exposure ──────────────────────────────────────────────────
  // The tool is registered into an agent ONLY once that agent loads the skill.
  //
  // The first attempt did the opposite — register into every agent, then hide
  // it with `agent.ctx.tools.restrict({ deny: ['show_file'] })`. That throws:
  // restrict() filters the GLOBAL tool surface, and an agent-scoped
  // registration is not part of it ("names unknown global tool"). The throw
  // happened inside the agent/created handler on every agent, which is what
  // made the UI flash.
  //
  // Registering on demand needs no restriction at all, so there is nothing to
  // reject. (The vision toolkit restricts a genuinely global activation tool,
  // which is why the same call works there.)
  /** agent -> disposers for the tools registered into it. */
  const mounted = new Map();

  function revealFor(agent) {
    if (agent === undefined || agent === null || mounted.has(agent)) return;
    const tools = agent.ctx?.tools;
    if (tools === undefined) return;
    mounted.set(agent, [tools.register(definition)]);
  }

  function detach(agent) {
    const disposers = mounted.get(agent);
    if (disposers === undefined) return;
    mounted.delete(agent);
    for (const dispose of disposers) {
      try {
        dispose();
      } catch {
        // An agent already torn down by the framework needs nothing from us.
      }
    }
  }

  ctx.effect(() => {
    const offs = [
      ctx.on("agent/disposed", ({ agent }) => detach(agent)),
      ctx.on("tools/result", (exec, result) => {
        if (result?.isError !== false) return;
        if (exec?.name !== "skill" || exec.agent === undefined) return;
        const args = exec.arguments;
        if (args === null || typeof args !== "object") return;
        if (args.name !== SKILL_NAME) return;
        try {
          revealFor(exec.agent);
        } catch {
          // A registry that refuses the registration leaves the agent without
          // the tool; it must never take down the tool-result pipeline.
        }
      }),
    ];
    return () => {
      for (const off of offs) off();
      for (const agent of [...mounted.keys()]) detach(agent);
    };
  }, "file-canvas: reveal show_file when the skill loads");
}

export { apply, inject, name };
