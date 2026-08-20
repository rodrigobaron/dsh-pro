// @my-dsh/tool-file-canvas — the `show_file` tool (profile entry).
//
// This is a PROFILE row, not an agent-preset row, so the tool is available
// under every preset — standard, code, minimal, anything — instead of only the
// one preset that happened to list it.
//
// A profile-level plugin has no agent `tools` service of its own, but it does
// have `agents`: it watches `agent/created` and registers into that agent's own
// `agent.ctx.tools`. That is how the vision toolkit mounts its tools too.
//
// Exposure is progressive, mirroring the same plugin: the tool is registered
// into every agent and then immediately restricted, so it costs nothing in the
// tool schema until the model loads this plugin's skill. Calling
// `skill("file-artifacts")` lifts the restriction for that agent alone.
import { defineTool } from "@deepseek-ai/dsh-tools";
import { buildEnvelope } from "./shared.js";

const name = "tool-file-canvas";

// `workspaceRegistry` is read defensively in shared.js, so it is not required
// here — a composition without it still resolves against the session cwd.
const inject = ["skills", "agents", "fs"];

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
          text: `Showed ${value.path} (${value.type}${value.language ? `/${value.language}` : ""}, ${value.size} bytes${value.truncated ? ", truncated in the artifact preview" : ""}) to the user.`,
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
  /** Per-agent bookkeeping: what to dispose, and how to reveal the tool. */
  const mounted = new Map();

  function attach(agent) {
    if (agent === undefined || mounted.has(agent)) return;
    const disposers = [agent.ctx.tools.register(definition)];
    // `restrict` returns the disposer that LIFTS the restriction, so holding it
    // is what lets the skill reveal the tool later.
    const reveal = agent.ctx.tools.restrict({ deny: [TOOL_NAME] });
    mounted.set(agent, { disposers, reveal });
  }

  function detach(agent) {
    const state = mounted.get(agent);
    if (state === undefined) return;
    mounted.delete(agent);
    state.reveal?.();
    for (const dispose of state.disposers) {
      try {
        dispose();
      } catch {
        // An agent already torn down by the framework needs nothing from us.
      }
    }
  }

  function revealFor(agent) {
    const state = mounted.get(agent);
    if (state?.reveal === undefined) return;
    state.reveal();
    // Cleared so a second skill call is a no-op rather than a double dispose.
    state.reveal = undefined;
  }

  ctx.effect(() => {
    const offs = [
      ctx.on("agent/created", ({ agent }) => attach(agent)),
      ctx.on("agent/disposed", ({ agent }) => detach(agent)),
      ctx.on("tools/result", (exec, result) => {
        if (result?.isError !== false) return;
        if (exec?.name !== "skill" || exec.agent === undefined) return;
        const args = exec.arguments;
        if (args === null || typeof args !== "object") return;
        if (args.name !== SKILL_NAME) return;
        revealFor(exec.agent);
      }),
    ];

    // Agents that already exist when this plugin loads (a reload, or HMR) never
    // emit `agent/created` again, so they are attached directly.
    try {
      for (const agent of ctx.agents.list?.() ?? []) attach(agent);
    } catch {
      // A registry that cannot list yet still yields agents through the event.
    }

    return () => {
      for (const off of offs) off();
      for (const agent of [...mounted.keys()]) detach(agent);
    };
  }, "file-canvas: per-agent tool mounting");
}

export { apply, inject, name };
