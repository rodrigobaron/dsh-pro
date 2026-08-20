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
  `The \`${TOOL_NAME}\` tool is always available — this skill is the longer explanation,`,
  "not a prerequisite. Its essentials are already in the tool description; read on when",
  "you want the reasoning behind them.",
  "",
  "## Why a card and not an open panel",
  "",
  "The tool places a card in the transcript. Opening the side panel is the user's",
  "gesture, not yours, because a panel that opens itself replaces whatever they were",
  "already reading. So the honest sentence is that the artifact is ready — claiming you",
  "opened or displayed it describes something that did not happen, and the user sees an",
  "unopened card while being told otherwise.",
  "",
  "## Why one at a time",
  "",
  "The panel holds a single artifact, so each call discards what the user is currently",
  "looking at. Showing five files in sequence means showing four files to nobody. Pick",
  "the one they would open first, name the rest in prose, and show another when the",
  "conversation moves to it.",
  "",
  "## Why it is not read",
  "",
  "`read` spends YOUR context to give you a file's contents. `show_file` spends none and",
  "gives the USER a rendered view. They answer different questions — 'what does this say'",
  "versus 'let me look at this' — so neither implies the other, and a task often wants",
  "both.",
  "",
  "## Usage",
  "",
  `- \`${TOOL_NAME}({ path })\` — the path as the user wrote it, relative to the workspace root.`,
  "- `title` overrides the heading; it defaults to the file name.",
  "- Read-only, so it is always safe to call.",
  "- Prefer it to pasting a file into your reply: a better view for them, no context spent",
  "  by you.",
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
    description: [
      "Show a workspace file to the user as a rendered artifact: source code, Markdown, HTML,",
      "images, PDFs, or data files. Read-only.",
      "",
      "This is how the user LOOKS at a file. It is not `read`: `read` pulls a file into your",
      "context so you can reason about it, while this puts the file in front of the user and",
      "never enters your context. Needing both is normal.",
      "",
      "Use it to present the DELIVERABLE of your work — when a task produces or changes a file",
      "the user should see, end by showing that file rather than describing it.",
      "",
      "It does NOT open the panel: it places a card in the transcript that the user clicks. Say",
      "the artifact is ready, never that you have opened, displayed, or shown it on screen.",
      "",
      "The panel holds ONE artifact at a time and each call replaces the last, so show the single",
      "file that matters most right now and mention the rest in prose.",
    ].join("\n"),
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
          text: `${value.path} is ready as an artifact (${value.type}${value.language ? `/${value.language}` : ""}, ${value.size} bytes${value.truncated ? ", truncated in the preview" : ""}). It is NOT on screen yet: the user opens it from the card in the transcript. Do not claim you have opened or displayed it.`,
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

  // ── exposure ──────────────────────────────────────────────────────────────
  // Every agent gets the tool at creation. Showing the user a file is core GUI
  // behaviour rather than a specialist capability, and gating it behind the
  // skill meant an agent that never thought to load the skill could not do it
  // at all — which is exactly what happened.
  //
  // The rules that used to live only in the skill (present the deliverable, one
  // artifact at a time, the card is not an opened panel) are in the tool
  // description now, because a model that never loads the skill still reads
  // that. The skill remains for the longer explanation.
  //
  // Registering is safe here; RESTRICTING is not. An early version registered
  // into every agent and then hid the tool with
  // `agent.ctx.tools.restrict({ deny: ['show_file'] })`, which throws — restrict
  // filters the GLOBAL tool surface and an agent-scoped registration is not
  // part of it ("names unknown global tool"). That throw fired inside
  // agent/created for every agent and made the UI flash. Nothing here restricts
  // anything, so there is nothing to reject.
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
      ctx.on("agent/created", ({ agent }) => {
        try {
          revealFor(agent);
        } catch {
          // A registry that refuses leaves this agent without the tool; it must
          // never take down agent creation.
        }
      }),
      // Kept as a backstop for an agent created before this listener attached.
      // revealFor is idempotent, so a second call is a no-op.
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
  }, "file-canvas: mount show_file for every agent");
}

export { apply, inject, name };
