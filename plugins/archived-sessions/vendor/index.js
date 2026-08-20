/**
 * dsh-archived-sessions — host half.
 *
 * Self-contained Archived Sessions manager. Exposes a fenced JSON API under
 * /archived/api/* that the client Settings section calls:
 *   details { sessionId } → per-session detail snapshot
 *   delete  { sessionId } → permanently delete a session
 *
 * Detail reading is LENIENT: it prefers the strict persistence inspect, but
 * falls back to the raw artifact so a session written by a newer plugin
 * (unknown event types such as agent-teams/*) still renders counts, tool
 * usage, lineage, and cross-session recall instead of failing.
 *
 * Deletion reuses the host primitives when present (`workspaceRegistry.deleteSession`,
 * `agentLoop.disposeAgent`, `sessionPersistence.remove`) and degrades gracefully
 * on a stock Harness where they do not exist yet.
 */
import z from "schemastery";
import { decodeStorageRecord } from "@deepseek-ai/dsh-session";
import { readdir, realpath, stat, rm } from "node:fs/promises";
import { join, resolve, sep, dirname, relative, isAbsolute } from "node:path";
import { spawn } from "node:child_process";
import { homedir } from "node:os";

const name = "dsh-archived-sessions";
// agentLoop is an optional capability (when absent, delete degrades to 409),
// so it is deliberately kept out of inject: cordis inject declares REQUIRED
// dependencies (a missing one blocks startup), while ctx.get is a tolerant
// read needing no declaration — exactly right for use-if-present.
const inject = ["webServer", "sessions", "sessionPersistence", "workspaceRegistry", "agents"];
/** Empty configuration schema: this plugin owns no loader config. */
const Config = z.object({});

const FETCH_TOOL_RE = /search|fetch|download|browse/i;

// -- session storage layout (mirrors dsh-session-persistence-jsonl) ----------
/** Filesystem-safe session directory key derived from the project cwd. */
function projectKey(cwd) {
	if (cwd.length === 0) throw new Error("cannot encode an empty project path");
	let readable = "";
	let separatorRun = false;
	for (let i = 0; i < cwd.length; i++) {
		const code = cwd.charCodeAt(i);
		const ch = String.fromCharCode(code);
		if (ch === "/" || ch === "\\" || ch === ":") {
			if (!separatorRun) readable += "-";
			separatorRun = true;
		} else if (ch !== "~" && /^[A-Za-z0-9._-]$/.test(ch)) {
			readable += ch;
			separatorRun = false;
		} else {
			readable += "~" + code.toString(16).toUpperCase().padStart(4, "0");
			separatorRun = false;
		}
	}
	return `--${(readable.replace(/^-+/, "") || "root").slice(0, 251)}--`;
}
/** Filesystem-safe segment encoding for a session id. */
function encodeSegment(raw) {
	if (raw.length === 0) throw new Error("cannot encode an empty path segment");
	if (raw === ".") return "~002E";
	if (raw === "..") return "~002E~002E";
	let out = "";
	for (let i = 0; i < raw.length; i++) {
		const code = raw.charCodeAt(i);
		const ch = String.fromCharCode(code);
		if (ch !== "~" && /^[A-Za-z0-9._-]$/.test(ch)) out += ch;
		else out += "~" + code.toString(16).toUpperCase().padStart(4, "0");
	}
	return out;
}
/** The DSH home directory (matches `dshHomePath('sessions')`). */
function dshHome() {
	const raw = process.env.DSH_HOME;
	// A blank DSH_HOME counts as unset (matching the official resolveDshHome); a
	// leading ~ expands to the home directory; the result is normalized absolute.
	const configured = raw !== void 0 && raw.trim().length > 0 ? raw.trim() : void 0;
	let base = configured ?? join(homedir(), ".dsh");
	// m18: expand every "~" form ("~", "~/", "~\", "~foo") the same way, aligned
	// with the official resolveDshHome semantics
	if (base === "~") base = homedir();
	else if (base.startsWith("~/") || base.startsWith("~\\")) base = join(homedir(), base.slice(2));
	else if (base.startsWith("~")) base = join(homedir(), base.slice(1));
	return resolve(base);
}
/** Session root directory (`{DSH_HOME}/sessions`). */
function sessionsRoot() {
	return join(dshHome(), "sessions");
}
/** Resolve a session's storage directory from its header (project key + encoded id).
 * m6: a session without a cwd lands in the official `_no-cwd` layout (aligned
 * with dsh-session-persistence-jsonl's projectDir), so open-folder no longer
 * reports "no associated working directory" for it. */
function sessionDirFor(meta) {
	const cwd = typeof meta?.cwd === "string" && meta.cwd !== "" ? meta.cwd : void 0;
	if (cwd === void 0) return join(sessionsRoot(), "_no-cwd", encodeSegment(meta.id));
	return join(sessionsRoot(), projectKey(cwd), encodeSegment(meta.id));
}
/** Open a directory in the OS file manager (cross-platform, fire-and-forget).
 * s7: simple throttle — repeated opens of the same directory within 500ms are
 * collapsed, so hammering the button cannot spawn a pile of windows. */
let lastOpenedDir = "";
let lastOpenedAt = 0;
function openInFileManager(dir) {
	const now = Date.now();
	if (dir === lastOpenedDir && now - lastOpenedAt < 500) {
		return Promise.resolve({ throttled: true });
	}
	lastOpenedDir = dir;
	lastOpenedAt = now;
	const command = process.platform === "win32" ? "explorer" : process.platform === "darwin" ? "open" : "xdg-open";
	return new Promise((resolveOpen, rejectOpen) => {
		const child = spawn(command, [dir], {
			detached: true,
			stdio: "ignore",
			...(process.platform === "win32" ? { shell: false } : {})
		});
		// Race 'error' against 'spawn': report honestly when the command is missing
		// or fails to start, rather than reporting unconditional success
		let settled = false;
		child.once("error", (error) => {
			if (settled) return;
			settled = true;
			rejectOpen(error);
		});
		child.once("spawn", () => {
			if (settled) return;
			settled = true;
			resolveOpen();
		});
		child.unref();
	});
}
/** Locate a session header by id (live sessions first, then persisted meta). */
async function findSessionMeta(ctx, sessionId) {
	const live = ctx.get("sessions")?.get(sessionId);
	if (live !== void 0) return live.header;
	const persistence = ctx.get("sessionPersistence");
	if (persistence !== void 0 && typeof persistence.list === "function") {
		for (const meta of await persistence.list()) if (meta.id === sessionId) return meta;
	}
	return void 0;
}

// -- browser-trust fence (loopback + same-origin markers) --------------------
function header(headers, name) {
	const value = headers[name];
	return typeof value === "string" ? value : void 0;
}
function parseAuthority(authority) {
	try {
		return new URL(`http://${authority}`);
	} catch {
		return;
	}
}
function isLoopbackHostname(hostname) {
	if (hostname === "localhost" || hostname === "[::1]") return true;
	const parts = hostname.split(".");
	return parts.length === 4 && parts[0] === "127" && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}
function isTrustedApiRequest(request) {
	const host = header(request.headers, "host");
	if (host === void 0) return false;
	const hostUrl = parseAuthority(host);
	if (hostUrl === void 0) return false;
	if (!isLoopbackHostname(hostUrl.hostname)) return false;
	if (header(request.headers, "sec-fetch-site") === "cross-site") return false;
	const origin = header(request.headers, "origin");
	if (origin === void 0) return true;
	try {
		return new URL(origin).host === hostUrl.host;
	} catch {
		return false;
	}
}

// -- HTTP helpers ------------------------------------------------------------
/** Whitelist of archived API methods; anything else is a 404. */
const ARCHIVED_API_METHODS = new Set(["details", "delete", "delete-file", "open-folder", "archive", "unarchive"]);
const MAX_JSON_BODY_BYTES = 1024 * 1024;
async function readJsonBody(req) {
	// m16: a non-JSON content-type is 415 outright (absent is allowed — callers
	// with no body are not required to send one)
	const contentType = header(req.headers, "content-type");
	if (contentType !== void 0 && !/^application\/json\b/i.test(contentType.trim())) {
		const error = new Error("content-type must be application/json");
		error.status = 415;
		error.code = "unsupported-media-type";
		throw error;
	}
	const chunks = [];
	let total = 0;
	for await (const chunk of req) {
		const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
		total += buffer.length;
		if (total > MAX_JSON_BODY_BYTES) {
			const error = new Error("request body too large");
			error.status = 413;
			error.code = "body-too-large";
			throw error;
		}
		chunks.push(buffer);
	}
	const raw = Buffer.concat(chunks).toString("utf8");
	if (raw.trim() === "") return {};
	try {
		return JSON.parse(raw);
	} catch {
		const error = new Error("invalid JSON body");
		error.status = 400;
		error.code = "bad-json";
		throw error;
	}
}
function writeJson(res, status, body) {
	res.writeHead(status, { "content-type": "application/json" });
	res.end(JSON.stringify(body));
}
function writeOk(res, value) {
	writeJson(res, 200, { ok: true, value });
}
function writeFail(res, message, status = 500, code = "internal") {
	writeJson(res, status, { ok: false, error: { code, message } });
}

/** Inspect leniently: strict read first, raw-artifact fallback that skips unknown records. */
async function lenientInspect(persistence, sessionId, signal) {
	try {
		return await persistence.inspect(sessionId, signal);
	} catch (error) {
		if (typeof persistence.readRaw !== "function") throw error;
		const raw = await persistence.readRaw(sessionId, signal);
		if (raw === void 0) {
			// Session missing: inspect and readRaw both come up empty, so turn it into an
			// explicit 404 (the raw error carries no status and would fall through to 500)
			const notFound = new Error("No record found for this session (the session does not exist)");
			notFound.status = 404;
			notFound.code = "session-not-found";
			throw notFound;
		}
		const events = [];
		for (const line of raw.content.split("\n")) {
			if (line.trim() === "") continue;
			try {
				const decoded = decodeStorageRecord(JSON.parse(line));
				if (Array.isArray(decoded)) events.push(...decoded);
				else events.push(decoded);
			} catch {
				// torn tail / unreadable record — skip
			}
		}
		return { meta: raw.meta, events };
	}
}

// M8: cap the details response — keep only the first 50 fetches and the first
// 200 files, so a session with tens of thousands of fetches/writes cannot grow
// the details JSON to tens of MB and lock up the browser.
const MAX_FETCHES = 50;
const MAX_FILES = 200;

/** Build the per-session detail snapshot. */
async function buildDetails(ctx, sessionId) {
	const sessions = ctx.get("sessions");
	const persistence = ctx.get("sessionPersistence");
	const live = sessions?.get(sessionId);
	let meta;
	let events;
	if (live !== void 0) {
		meta = live.header;
		events = [...live.events];
	} else {
		if (persistence === void 0) throw new Error("session persistence is not available");
		const inspected = await lenientInspect(persistence, sessionId);
		if (inspected.meta === void 0) {
			// Session missing: explicit 404 (the error persistence.inspect throws carries
			// no status and would fall through to 500)
			const error = new Error("No record found for this session (the session does not exist)");
			error.status = 404;
			error.code = "session-not-found";
			throw error;
		}
		meta = inspected.meta;
		events = inspected.events;
	}
	let sizeBytes = null;
	if (persistence !== void 0 && typeof persistence.artifactInfo === "function") {
		const artifact = await persistence.artifactInfo(sessionId);
		sizeBytes = artifact?.sizeBytes ?? null;
	}
	let lastTime = typeof meta?.createdAt === "number" ? meta.createdAt : 0;
	const fileSet = new Map();
	const stats = {
		turns: 0,
		steps: 0,
		userMessages: 0,
		assistantMessages: 0,
		toolCalls: 0,
		attachments: 0,
		toolCounts: {},
		fetches: []
	};
	const turnSeen = new Set();
	const stepSeen = new Set();
	for (const event of events) {
		if (typeof event.time === "number" && event.time > lastTime) lastTime = event.time;
		const data = event.data;
		switch (event.type) {
			case "turn/start":
				if (typeof data?.turn === "number") turnSeen.add(data.turn);
				break;
			case "step/start":
				if (typeof data?.step === "number") stepSeen.add(data.step);
				break;
			case "user/message":
				stats.userMessages++;
				if (Array.isArray(data?.content)) for (const block of data.content) if (block?.type === "image") stats.attachments++;
				break;
			case "assistant/message":
				stats.assistantMessages++;
				break;
			case "tool/call":
				stats.toolCalls++;
				{
					const name = typeof data?.name === "string" ? data.name : "tool";
					stats.toolCounts[name] = (stats.toolCounts[name] ?? 0) + 1;
					if (FETCH_TOOL_RE.test(name)) {
						let query;
						try {
							const args = typeof data.arguments === "string" ? JSON.parse(data.arguments) : data.arguments;
							query = typeof args?.query === "string" ? args.query : typeof args?.url === "string" ? args.url : typeof args?.q === "string" ? args.q : void 0;
						} catch {
							query = void 0;
						}
						stats.fetches.push({
							tool: name,
							...query === void 0 || query === "" ? {} : { query }
						});
					}
				}
				break;
		}
		if (event.type === "tool/call") {
			const toolName = typeof data?.name === "string" ? data.name : "";
			if (toolName === "write" || toolName === "edit") {
				let args;
				try {
					args = typeof data.arguments === "string" ? JSON.parse(data.arguments) : data.arguments;
				} catch {
					continue;
				}
				const filePath = typeof args?.file_path === "string" ? args.file_path : void 0;
				if (filePath === void 0 || filePath === "") continue;
				if (!fileSet.has(filePath)) fileSet.set(filePath, toolName);
			}
		}
	}
	stats.turns = turnSeen.size;
	// NOTE: step de-duplication relies on step numbers increasing globally (a real
	// session runs 1..N without gaps). If step numbering is ever reset per turn,
	// this would undercount — switch to counting step/start events instead.
	stats.steps = stepSeen.size;
	// M8: truncate the response — keep the first MAX_FETCHES fetches (the client
	// truncates when rendering too) and the first MAX_FILES files; the statistics
	// are unaffected (toolCounts still covers everything).
	if (stats.fetches.length > MAX_FETCHES) stats.fetches = stats.fetches.slice(0, MAX_FETCHES);
	// The files list comes from the event log (write/edit file_path), so it is a
	// historical snapshot: a physically deleted file still has its record, which
	// would list it again in the details panel and delete dialog. stat filters out
	// paths gone from disk (only the first MAX_FILES*2 are checked, so a large
	// session does not pay for a full stat sweep).
	const fileEntries = [...fileSet.entries()].slice(0, MAX_FILES * 2);
	const fileExists = await Promise.all(fileEntries.map(([p]) => stat(p).then(() => true).catch(() => false)));
	const files = fileEntries.filter((_, i) => fileExists[i]).map(([path, tool]) => ({ path, tool })).slice(0, MAX_FILES);
	const lineage = {
		parentSessionId: typeof meta?.parentSession === "string" ? meta.parentSession : null,
		children: []
	};
	// M1: children is a Set because a live child session appears in both
	// persistence.list() and sessions.list(); m2: list() is typeof-guarded so a
	// non-jsonl backend without a list method does not turn into a 500.
	// children = forked child sessions (not subagents); subagents = subagent
	// sessions (origin === "subagent")
	const childrenSet = new Set();
	const subagentSet = new Set();
	if (persistence !== void 0 && typeof persistence.list === "function") {
		for (const h of await persistence.list()) {
			if (h.parentSession !== sessionId) continue;
			if (h.origin === "subagent") {
				subagentSet.add(h.id);
				continue;
			}
			childrenSet.add(h.id);
		}
	}
	for (const session of sessions?.list() ?? []) {
		if (session.header.parentSession !== sessionId) continue;
		if (session.header.origin === "subagent") {
			subagentSet.add(session.id);
			continue;
		}
		childrenSet.add(session.id);
	}
	lineage.children = [...childrenSet];
	lineage.subagents = [...subagentSet];
	return {
		sessionId,
		sizeBytes,
		createdAt: typeof meta?.createdAt === "number" ? meta.createdAt : null,
		updatedAt: lastTime || null,
		files,
		stats,
		lineage
	};
}

// -- serialized queue for registry state changes ------------------------------
// workspaceRegistry's requireState+setState is a read-modify-write pair, which
// the official core serializes through its own enqueueOperation. This plugin's
// unarchive and fallback-delete go through this queue for the same reason:
// otherwise a concurrent archive/unarchive could interleave and lose an update.
let mutationTail = Promise.resolve();
function enqueueMutation(operation) {
	const result = mutationTail.then(() => operation());
	mutationTail = result.then(() => {}, () => {});
	return result;
}

/** Prune empty parent directories upward (until one is non-empty or the
 * workspace root is reached), so deleting a file leaves no empty shell behind.
 * stopSet = the set of workspace roots (real paths included): pruning stops at a
 * root and never removes the root itself.
 * Note the boundary is stopSet alone — the delete target is a workspace file
 * and does not live under sessionsRoot. */
async function pruneEmptyDirs(dir, stopSet) {
	let current = dirname(dir);
	for (;;) {
		if (stopSet.has(current)) break;
		let empty = false;
		try {
			const entries = await readdir(current);
			empty = entries.length === 0;
		} catch {
			break;
		}
		if (!empty) break;
		try {
			await rm(current, { force: true, maxRetries: 3 });
		} catch {
			break;
		}
		current = dirname(current);
	}
}

/** Delete ONE session only (no subagent cascade): detach workspace accounting,
 * drop the archive-set entry through the public state primitives, and remove
 * the persisted artifact via its physical location. Subagent children are
 * intentionally LEFT ALONE — they surface as top-level rows afterwards unless
 * the user explicitly selected them for deletion.
 * File-removal modes:
 * - `filePaths` (non-empty array): delete only those files, then remove the
 *   record log, keeping every other file in the session directory.
 * - `deleteFiles === false`: remove the record log only, keep all files.
 * - otherwise (default): remove the whole session directory (log + files). */
async function deleteSessionSingle(ctx, sessionId, options = {}) {
	const { deleteFiles = true, filePaths } = options;
	const registry = ctx.get("workspaceRegistry");
	const persistence = ctx.get("sessionPersistence");
	const sessions = ctx.get("sessions");
	// m1: a missing session is an explicit 404, not a silent "success" the user
	// would read as "deleted". A running session is rejected with 409 earlier by
	// the caller (deleteSession); only stopped ones reach here.
	const meta = await findSessionMeta(ctx, sessionId);
	if (meta === void 0) {
		const error = new Error("No record found for this session (the session does not exist)");
		error.status = 404;
		error.code = "session-not-found";
		throw error;
	}
	// M2: detach is best-effort — one workspace's detachSession failing (its
	// requireState/setState persistence erroring, say) must not block the whole
	// delete, so it is recorded and skipped.
	for (const ws of registry?.list() ?? []) {
		if (!ws.sessionIds.includes(sessionId)) continue;
		try {
			await ws.detachSession(sessionId);
		} catch (error) {
			console.error(`[dsh-archived-sessions] detachSession failed for workspace "${ws.path}":`, error);
		}
	}
	if (registry !== void 0 && typeof registry.requireState === "function" && typeof registry.setState === "function") {
		await enqueueMutation(async () => {
			// M3: read the latest state inside the queue, never computing a write-back
			// from a stale snapshot held outside it. While this session is in the archive
			// set, orphaned entries pointing at sessions that no longer exist are swept
			// too (concurrent archive/unarchive/delete across queues can leave them).
			const state = registry.requireState();
			if (!state.archivedSessionIds.includes(sessionId)) return;
			const existing = new Set();
			for (const s of sessions?.list() ?? []) existing.add(s.id);
			if (persistence !== void 0 && typeof persistence.list === "function") {
				for (const h of await persistence.list()) existing.add(h.id);
			}
			const archivedSessionIds = state.archivedSessionIds.filter((id) => id !== sessionId && existing.has(id));
			await registry.setState({ ...state, archivedSessionIds });
		});
	}
	if (persistence !== void 0 && typeof persistence.locate === "function") {
		// Fine-grained file delete: remove the ticked files/folders (and directories
		// that result), then the record log. Note details.files are workspace output
		// files (write/edit file_path) and do NOT live in the session directory, so
		// the fence is the workspace root (as in deleteFile), not the session dir.
		if (Array.isArray(filePaths) && filePaths.length > 0) {
			const location = persistence.locate(meta);
			const root = sessionsRoot();
			const workspaceRoots = (registry?.list() ?? []).map((ws) => ws.path);
			const rootResolvedSet = new Set();
			for (const wroot of workspaceRoots) {
				let rr = resolve(wroot);
				try {
					rr = await realpath(rr);
				} catch {
					// The workspace root may have been moved or deleted: keep the resolved path
				}
				rootResolvedSet.add(rr.replace(/[\\/]+$/, ""));
			}
			for (const p of filePaths) {
				const resolved = resolve(p);
				// Prove the target sits inside some workspace (so no arbitrary path is removed)
				let allowed = false;
				let matchedRoot = "";
				for (const wroot of workspaceRoots) {
					let rootResolved = resolve(wroot);
					try {
						rootResolved = await realpath(rootResolved);
					} catch {
						// The workspace root may have been moved or deleted: keep the resolved path
					}
					rootResolved = rootResolved.replace(/[\\/]+$/, "");
					if (rootResolved !== "" && resolved.startsWith(rootResolved + sep) && resolved !== rootResolved) {
						allowed = true;
						matchedRoot = rootResolved;
						break;
					}
				}
				if (!allowed) continue;
				// Files and folders alike (folders recursively; empty parents pruned after)
				try {
					const info = await stat(resolved);
					await rm(resolved, { force: true, maxRetries: 3, recursive: info.isDirectory() });
					await pruneEmptyDirs(resolved, rootResolvedSet);
				} catch {
					// Target absent (already deleted, or never written): ignore
				}
			}
			// Delete the record log (leaving every other file)
			const logPath = location !== void 0 && typeof location.path === "string" ? location.path : void 0;
			if (logPath !== void 0) {
				const relLog = relative(root, logPath);
				if (logPath !== "" && relLog !== "" && !relLog.startsWith("..") && !isAbsolute(relLog)) {
					await rm(logPath, { force: true, maxRetries: 3 });
					return;
				}
			}
			if (persistence.remove !== void 0 && typeof persistence.remove === "function") {
				await persistence.remove(sessionId);
			}
			return;
		}
		// deleteFiles=false: delete only the record log, keeping downloads and output
		// files in the session directory
		if (deleteFiles === false) {
			const location = persistence.locate(meta);
			if (location !== void 0 && typeof location.path === "string") {
				const root = sessionsRoot();
				const rel = relative(root, location.path);
				const insideRoot = location.path !== "" && rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
				if (insideRoot) {
					await rm(location.path, { force: true, maxRetries: 3 });
				} else if (persistence.remove !== void 0 && typeof persistence.remove === "function") {
					// Record path unusable (third-party backend): fall back to the official remove
					await persistence.remove(sessionId);
				}
			}
			return;
		}
	}
	if (persistence !== void 0 && typeof persistence.remove === "function") {
		await persistence.remove(sessionId);
	} else if (persistence !== void 0 && typeof persistence.locate === "function") {
		// No remove primitive: locate the artifact and delete its directory.
		// The resolved directory must stay strictly INSIDE the sessions root —
		// a third-party or damaged backend could otherwise point the recursive
		// rm at the whole session library (or anything above it).
		{
			const location = persistence.locate(meta);
			if (location !== void 0 && typeof location.path === "string") {
				const dir = dirname(location.path);
				const root = sessionsRoot();
				const rel = relative(root, dir);
				const insideRoot = dir !== "" && rel !== "" && rel !== "." && !rel.startsWith("..") && !isAbsolute(rel);
				if (dir !== void 0 && dir !== "" && dir !== dirname(dir) && insideRoot) {
					await rm(dir, { recursive: true, force: true });
				} else if (dir !== void 0 && dir !== "" && !insideRoot) {
					throw new Error("Refusing to delete: the session record directory is not inside the session root");
				}
			}
		}
	}
}

/** Recursively collect every descendant subagent session id of sessionId,
 * including grandchildren and deeper. */
async function collectDescendants(ctx, sessionId) {
	const persistence = ctx.get("sessionPersistence");
	const sessions = ctx.get("sessions");
	const childrenOf = async (id) => {
		const kids = new Set();
		if (persistence !== void 0 && typeof persistence.list === "function") {
			for (const h of await persistence.list()) {
				if (h.parentSession === id) kids.add(h.id);
			}
		}
		for (const s of sessions?.list() ?? []) {
			if (s.header.parentSession === id) kids.add(s.id);
		}
		return kids;
	};
	const result = [];
	const seen = new Set([sessionId]);
	const stack = [sessionId];
	while (stack.length > 0) {
		const id = stack.pop();
		for (const kid of await childrenOf(id)) {
			if (seen.has(kid)) continue;
			seen.add(kid);
			result.push(kid);
			stack.push(kid);
		}
	}
	return result;
}

/** Permanently delete one session (live-agent teardown + single-session removal).
 * M7 note: the DSH host exposes no "current session" API (the sessions store's
 * current is a browser-side concept with no host-side equivalent, and agents'
 * selection.current is agent-internal state), so the host cannot reliably refuse
 * to delete "the session you have open". The protection is instead: a running
 * session is refused with 409 (below), the client disables the current row, and
 * the README states that a local process calling the API directly can still
 * delete the current session — matching the official deleteSession. */
async function deleteSession(ctx, sessionId, options = {}) {
	const { cascade = false, deleteFiles = true, subagentIds, filePaths } = options;
	const agents = ctx.get("agents");
	const agent = agents?.get(sessionId);
	if (agent !== void 0 && agent.status === "running") {
		const error = new Error("The session is running and cannot be deleted; stop it first");
		error.status = 409;
		error.code = "session-busy";
		throw error;
	}
	if (agent !== void 0) {
		// Best-effort teardown, matching the official deleteSession handler:
		// flush buffered writes, then dispose the agent when the primitive is
		// reachable. agentLoop sits behind an isolate realm on preset-mounted
		// deployments and is usually NOT resolvable from this root context —
		// that must not block deletion (the official handler skips dispose in
		// exactly that case and still deletes).
		try {
			const sessions = ctx.get("sessions");
			const session = sessions?.get(sessionId);
			if (session !== void 0 && typeof sessions.flush === "function") {
				await sessions.flush(session);
			}
		} catch {
			// flush failure is non-fatal: the artifact removal below wins
		}
		const loop = ctx.get("agentLoop");
		if (loop !== void 0 && typeof loop.disposeAgent === "function") {
			try {
				await loop.disposeAgent(sessionId);
			} catch {
				// dispose failure is non-fatal; continue with removal
			}
		}
	}
	// Always take the delete-only-myself path: registry.deleteSession (the patched
	// build) cascades into subagent children, and this plugin does not cascade by
	// default unless the user ticks it (cascade, or subagentIds). subagentIds is
	// the fine-grained set from the details panel; cascade=true means all
	// descendants.
	const descendants = Array.isArray(subagentIds) && subagentIds.length > 0 ? subagentIds : (cascade ? await collectDescendants(ctx, sessionId) : []);
	for (const descendant of descendants) {
		// Subagents inherit the parent's file-delete option; when filePaths is given,
		// a subagent deletes only its record and keeps its files
		await deleteSessionSingle(ctx, descendant, { deleteFiles: Array.isArray(filePaths) && filePaths.length > 0 ? false : deleteFiles });
	}
	await deleteSessionSingle(ctx, sessionId, { deleteFiles, filePaths });
	return { sessionId };
}

/** Delete one file, but only when it resolves strictly INSIDE a registered
 * workspace root (never the root itself — a recursive rm on the root would
 * erase the whole project directory).
 *
 * M6: only regular files may be deleted (lstat refuses directories, rm is not
 * recursive); when a sessionId is given, path must additionally belong to that
 * session's buildDetails.files output list, so a same-origin script cannot
 * delete arbitrary workspace files. m3: workspace roots go through realpath too,
 * so a symlink or case alias cannot make a legitimate delete look out of bounds.
 * m4: trailing separators are normalized, avoiding a doubled `root + sep`. */
async function deleteFile(ctx, path, sessionId) {
	const resolved = resolve(path);
	let target = resolved;
	try {
		// Resolve symlinks and case aliases: an existing target is fenced by its real
		// path, so a link inside the workspace pointing outside it is refused
		target = await realpath(resolved);
	} catch {
		// The target may already be gone (deleted since the last sync): keep the
		// resolved path, and the fence check still applies
	}
	// M6: regular files only — a directory would take rm recursive with it and
	// destroy the whole tree
	try {
		const info = await stat(target);
		if (info.isDirectory()) {
			const error = new Error("Only files can be deleted, not directories");
			error.status = 403;
			error.code = "not-a-file";
			throw error;
		}
	} catch (error) {
		if (error?.code === "not-a-file") throw error;
		// Target absent (deleted since the last sync): still fence-check it, and rm
		// force is idempotent
	}
	// M6: ownership check — with a sessionId, path must be one of that session's
	// output files
	if (typeof sessionId === "string" && sessionId !== "") {
		const details = await buildDetails(ctx, sessionId);
		const known = new Set();
		for (const file of details?.files ?? []) known.add(file.path);
		if (!known.has(path)) {
			const error = new Error("Only files listed among this session's output files can be deleted");
			error.status = 403;
			error.code = "not-produced-file";
			throw error;
		}
	}
	const registry = ctx.get("workspaceRegistry");
	const roots = (registry?.list() ?? []).map((ws) => ws.path);
	const rootResolvedSet = new Set();
	let allowed = false;
	for (const root of roots) {
		let rootResolved = resolve(root);
		try {
			// m3: resolve the root's real path too, so it is compared with target (already
			// realpath'd) in the same coordinate system
			rootResolved = await realpath(rootResolved);
		} catch {
			// The workspace root may have been moved or deleted: keep the resolved path
		}
		// m4: strip duplicated trailing separators (`C:\` and `C:\\` both normalize
		// to `C:\`)
		rootResolved = rootResolved.replace(/[\\/]+$/, "");
		if (rootResolved === "") continue;
		rootResolvedSet.add(rootResolved);
		if (target.startsWith(rootResolved + sep) && target !== rootResolved) {
			allowed = true;
		}
	}
	if (!allowed) {
		const error = new Error("Only files inside the workspace can be deleted");
		error.status = 403;
		error.code = "outside-workspace";
		throw error;
	}
	await rm(target, { recursive: false, force: true });
	// Consistent with delete's filePaths branch: prune empty parents upward after
	// removal (until one is non-empty, or the workspace root)
	await pruneEmptyDirs(target, rootResolvedSet);
	return { path: target, deleted: true };
}

/** Open a session's record folder in the OS file manager. */
async function openSessionFolder(ctx, sessionId) {
	const meta = await findSessionMeta(ctx, sessionId);
	if (meta === void 0) {
		const error = new Error("No record directory found for this session (the session does not exist)");
		error.status = 404;
		error.code = "session-not-found";
		throw error;
	}
	const dir = sessionDirFor(meta);
	if (dir === void 0) {
		const error = new Error("This session has no associated working directory, so its record folder cannot be located");
		error.status = 404;
		error.code = "no-cwd";
		throw error;
	}
	// M10: a friendly error when the directory is missing, so the OS does not throw
	// a native dialog
	try {
		await stat(dir);
	} catch {
		const error = new Error("The session record folder does not exist (it may have been deleted)");
		error.status = 404;
		error.code = "folder-not-found";
		throw error;
	}
	await openInFileManager(dir);
	return { sessionId, path: dir, opened: true };
}

/** Archive one session into the registry-global archive set. */
async function archiveSession(ctx, sessionId) {
	const registry = ctx.get("workspaceRegistry");
	if (registry === void 0 || typeof registry.archiveSession !== "function") {
		const error = new Error("This Harness version does not support archiving sessions (workspaceRegistry.archiveSession is missing)");
		error.status = 501;
		error.code = "unsupported";
		throw error;
	}
	// Explicit 404 for a missing session (the official archiveSession throws an
	// error with no status, which would fall through to 500)
	const meta = await findSessionMeta(ctx, sessionId);
	if (meta === void 0) {
		const error = new Error("No record found for this session (the session does not exist)");
		error.status = 404;
		error.code = "session-not-found";
		throw error;
	}
	await registry.archiveSession(sessionId);
	return { sessionId, archived: true };
}

/**
* Unarchive one session back into the active list. Uses the same public
* registry primitives the official archiveSession is built on
* (`requireState` + `setState`), so it works on a stock Harness without
* any core patch. The read-modify-write runs inside the plugin's serialized
* mutation queue so concurrent archive/unarchive requests cannot lose updates.
* M3 note: this plugin's mutationTail queue and the official archiveSession's
* enqueueOperation are two independent queues, so extreme concurrency (an archive
* interleaving with an unarchive or delete within the same millisecond) can still
* lose an update. Delete self-heals by sweeping orphaned archive entries as it
* goes; the remaining window is described in the README's concurrency notes.
*/
async function unarchiveSession(ctx, sessionId) {
	const registry = ctx.get("workspaceRegistry");
	if (registry === void 0 || typeof registry.requireState !== "function" || typeof registry.setState !== "function") {
		const error = new Error("This Harness version does not support unarchiving (the workspaceRegistry state primitives are missing)");
		error.status = 501;
		error.code = "unsupported";
		throw error;
	}
	// Explicit 404 for a missing session, consistent with archive/delete/details
	const meta = await findSessionMeta(ctx, sessionId);
	if (meta === void 0) {
		const error = new Error("No record found for this session (the session does not exist)");
		error.status = 404;
		error.code = "session-not-found";
		throw error;
	}
	await enqueueMutation(async () => {
		const state = registry.requireState();
		if (!state.archivedSessionIds.includes(sessionId)) return;
		await registry.setState({
			...state,
			archivedSessionIds: state.archivedSessionIds.filter((id) => id !== sessionId)
		});
	});
	return { sessionId, archived: false };
}

function apply(ctx) {
	ctx.effect(() => ctx.get("webServer")?.register({
		kind: "prefix",
		path: "/archived/api",
		handler: async (req, res) => {
			if (!isTrustedApiRequest(req)) {
				writeJson(res, 403, { ok: false, error: { code: "forbidden", message: "forbidden" } });
				return;
			}
			if (req.method !== "POST") {
				writeJson(res, 405, { ok: false, error: { code: "method-error", message: "method not allowed" } });
				return;
			}
			const pathname = new URL(req.url ?? "/", "http://dsh.internal").pathname;
			const method = pathname.startsWith("/archived/api/") ? pathname.slice("/archived/api/".length) : void 0;
			if (method === void 0 || method.includes("/") || method === "") {
				writeJson(res, 404, { ok: false, error: { code: "not-found", message: "unknown archived API method" } });
				return;
			}
			// Method allowlist: an unknown method is a 404 rather than falling through to
			// the 400 from argument validation
			if (!ARCHIVED_API_METHODS.has(method)) {
				writeJson(res, 404, { ok: false, error: { code: "not-found", message: `unknown archived API method "${method}"` } });
				return;
			}
			try {
				const payload = await readJsonBody(req);
				if (method === "delete-file") {
					const path = typeof payload.path === "string" ? payload.path : "";
					if (path === "") {
						writeJson(res, 400, { ok: false, error: { code: "bad-request", message: "path is required" } });
						return;
					}
					// M6: the ownership check needs sessionId — the client always sends it when
					// acting from the details files list
					const ownerSessionId = typeof payload.sessionId === "string" ? payload.sessionId : "";
					writeOk(res, await deleteFile(ctx, path, ownerSessionId));
					return;
				}
				const sessionId = typeof payload.sessionId === "string" ? payload.sessionId : "";
				if (sessionId === "" || sessionId.length > 200) {
					// m17: bound the sessionId length, so an overlong string cannot burn resources
					// in a full list comparison
					writeJson(res, 400, { ok: false, error: { code: "bad-request", message: sessionId === "" ? "sessionId is required" : "sessionId is too long" } });
					return;
				}
				if (method === "details") {
					// NOTE: do NOT pass req.signal — the node http IncomingMessage
					// signal auto-aborts the moment the body is fully read, which
					// would abort every persistence read with "This operation was
					// aborted". Detail reads are bounded enough to run uncancelled.
					writeOk(res, await buildDetails(ctx, sessionId));
				} else if (method === "delete") {
					// subagentIds/filePaths: the details panel's fine-grained ticks;
					// cascade/deleteFiles are the select-all shortcuts
					writeOk(res, await deleteSession(ctx, sessionId, {
						cascade: payload.cascade === true,
						deleteFiles: payload.deleteFiles !== false,
						subagentIds: Array.isArray(payload.subagentIds) ? payload.subagentIds.filter((id) => typeof id === "string") : void 0,
						filePaths: Array.isArray(payload.filePaths) ? payload.filePaths.filter((p) => typeof p === "string") : void 0
					}));
				} else if (method === "open-folder") {
					writeOk(res, await openSessionFolder(ctx, sessionId));
				} else if (method === "archive") {
					writeOk(res, await archiveSession(ctx, sessionId));
				} else if (method === "unarchive") {
					writeOk(res, await unarchiveSession(ctx, sessionId));
				} else {
					writeJson(res, 404, { ok: false, error: { code: "not-found", message: `unknown archived API method "${method}"` } });
				}
			} catch (error) {
				writeFail(res, error instanceof Error ? error.message : String(error), typeof error?.status === "number" ? error.status : 500, typeof error?.code === "string" ? error.code : "internal");
			}
		}
	}), "dsh-archived-sessions: /archived/api routes");
}

export { Config, apply, inject, name };
