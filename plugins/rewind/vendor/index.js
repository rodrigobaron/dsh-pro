/**
 * dsh-recall — Host half.
 *
 * Message recall (撤回) for the DSH Web UI. Serves one same-origin HTTP route:
 *
 *   POST /recall   { sessionId, messageId }  → recall one message by its
 *                                              durable id (user or assistant)
 *                  { sessionId, boundary }   → recall the event at `boundary`
 *                                              (seq of a user/assistant message)
 *
 * Semantics: the recalled message AND everything after it up to the recall
 * operation are removed from the conversation — the model-visible history
 * (surface) and the browser transcript — by appending a durable
 * `session/recall` tombstone to the session's append-only log. The log keeps
 * every event, so NO filesystem state is ever reverted: code changes produced
 * by the recalled turn stay in place by design. The tombstone is persisted by
 * the regular session flush path and survives restarts.
 *
 * Refusals (with explicit error codes):
 *   - the session is not attached (live agent missing)     → session-not-found
 *   - the session is owned by subagent routing              → subagent-owned
 *   - the agent is currently running a turn                → agent-busy
 *   - no recallable message matches the request            → message-not-found
 *   - the session rejected the boundary (already recalled,
 *     non-message boundary, …)                             → recall-rejected
 *
 * Trust boundary: same as the filetree/scm plugins — any same-origin browser
 * client can recall messages in live sessions.
 */

import { deriveEventMessage, isAppendSurfaceEvent } from "@deepseek-ai/dsh-session";
import { hasApiRemoteSubagentOwner } from "@deepseek-ai/dsh-api-remotes";

const name = "recall";

/** Services required by the recall host half. */
const inject = ["webServer", "sessions", "agents"];

/** Write a JSON response with no-store caching. */
function sendJson(res, status, body) {
	const payload = JSON.stringify(body);
	res.writeHead(status, {
		"Content-Type": "application/json; charset=utf-8",
		"Cache-Control": "no-store",
		"Content-Length": Buffer.byteLength(payload)
	});
	res.end(payload);
}

/** Build one structured failure branch. */
function errorBody(code, message, details) {
	return {
		ok: false,
		error: {
			code,
			message,
			...details === void 0 ? {} : { details }
		}
	};
}

/** Read a bounded JSON request body. */
function readBody(req) {
	return new Promise((resolve, reject) => {
		const chunks = [];
		let size = 0;
		req.on("data", (chunk) => {
			size += chunk.length;
			if (size > 64 * 1024) {
				reject(new Error("request body too large"));
				req.destroy();
				return;
			}
			chunks.push(chunk);
		});
		req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
		req.on("error", reject);
	});
}

/**
 * Resolve the recall boundary from the request: either an explicit event seq
 * (must address a user/assistant message event) or the first append-origin
 * user/assistant message whose durable id matches. Returns null when no
 * recallable message matches.
 */
function resolveBoundary(session, payload) {
	const events = session.events;
	if (typeof payload.boundary === "number" && Number.isSafeInteger(payload.boundary)) {
		const boundary = payload.boundary;
		if (boundary < 0 || boundary >= events.length) return null;
		const target = events[boundary];
		if (target.type !== "user/message" && target.type !== "assistant/message") return null;
		if (!isAppendSurfaceEvent(target)) return null;
		return boundary;
	}
	const messageId = payload.messageId;
	if (typeof messageId !== "string" || messageId === "") return null;
	for (const event of events) {
		if (!isAppendSurfaceEvent(event)) continue;
		const message = deriveEventMessage(event);
		if (message !== null && message.id === messageId) return event.seq;
	}
	return null;
}

/** The recall plugin body: register the /recall POST route. */
function apply(ctx) {
	const { webServer, sessions, agents } = ctx;
	webServer.register({
		kind: "prefix",
		path: "/recall",
		handler: async (req, res) => {
			if (req.method !== "POST") {
				res.writeHead(405);
				res.end();
				return;
			}
			let payload;
			try {
				payload = JSON.parse(await readBody(req) || "{}");
			} catch {
				sendJson(res, 400, errorBody("BAD_REQUEST", "request body must be JSON"));
				return;
			}
			const sessionId = typeof payload?.sessionId === "string" && payload.sessionId !== "" ? payload.sessionId : null;
			if (sessionId === null) {
				sendJson(res, 400, errorBody("BAD_REQUEST", "missing sessionId"));
				return;
			}
			const agent = agents.get(sessionId);
			if (agent === void 0) {
				sendJson(res, 404, errorBody("session-not-found", `session "${sessionId}" not found (not attached)`));
				return;
			}
			if (hasApiRemoteSubagentOwner(ctx, agent.session, agent)) {
				sendJson(res, 403, errorBody("subagent-owned", "session is owned by subagent routing"));
				return;
			}
			if (agent.status === "running") {
				sendJson(res, 409, errorBody("agent-busy", `session "${sessionId}" is running; stop the current turn before recalling a message`, { sessionId }));
				return;
			}
			const boundary = resolveBoundary(agent.session, payload);
			if (boundary === null) {
				sendJson(res, 404, errorBody("message-not-found", `session "${sessionId}" has no recallable message matching the request`, { sessionId }));
				return;
			}
			try {
				const logged = agent.session.recall(boundary);
				await sessions.flush(agent.session);
				sendJson(res, 200, { ok: true, value: { boundary, seq: logged.seq } });
			} catch (error) {
				sendJson(res, 422, errorBody("recall-rejected", error instanceof Error ? error.message : String(error), { sessionId, boundary }));
			}
		}
	});
}

export { apply, inject, name };
