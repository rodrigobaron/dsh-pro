/**
 * dsh-recall — Browser half.
 *
 * Message recall (撤回) UI for the DSH Web UI:
 *   - one undo button beside EVERY user message (this is the only entry
 *     point): clicking it recalls the current turn — the user message itself
 *     and everything after it up to the recall operation.
 *   - a "recalled message" notice rendered at each durable session/recall
 *     tombstone (chat node kind "recall").
 *
 * The button lives on the user message by overriding the keyed Chat Node
 * seat for kind "user" (priority -1 shadows the framework's default
 * renderer). The user node's `data.seq` IS the durable seq of the user
 * message, so it doubles as the recall boundary directly — no turn lookup
 * needed. The framework's own user bubble look (right-aligned rounded
 * bubble, image gallery) is recreated with plugin-owned CSS so the recall
 * entry point does not degrade the message.
 *
 * The recall request goes to the plugin's own host route (POST /recall) — no
 * custom RPC plumbing. Recalled events never reach the conversation assembler
 * (the client runtime Session prunes them), so this bundle only renders the
 * button and the notice. Recall NEVER reverts filesystem changes: the host
 * appends a tombstone to the append-only log and nothing else.
 *
 * After a recall commits, the recalled user message's text is restored into
 * the session's composer draft (input box) so the user can edit and resend it
 * — the same recovery affordance opencode's undo has. The restore happens only
 * AFTER the recall request settles, never before, so a fast re-submit cannot
 * race the tombstone. Image attachments are not carried back (they have no
 * draft-side identity here); a message that is all images restores nothing.
 */
window.__ModuleLoader__.load({
	id: "dsh-recall",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let UiAttachment = require("@deepseek-ai/dsh-client-ui-attachment");
		const ImageGallery = UiAttachment?.ImageGallery;

		// ── live client root context (captured at apply time) ────────────────
		/** The client root ctx, used to reach the session composer draft. */
		let recallCtx = null;

		// ── styles (injected once at materialization) ─────────────────────────
		const css = [
			// recall action button
			".dsr-action{width:28px;height:28px;color:var(--dsw-alias-label-tertiary);cursor:pointer;background:transparent;border:none;border-radius:28px;justify-content:center;align-items:center;padding:6px;display:inline-flex}",
			".dsr-action:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}",
			".dsr-action:disabled{cursor:default;opacity:.4}",
			".dsr-failure{color:var(--dsw-alias-label-tertiary);padding-left:4px;font-size:13px;line-height:28px}",
			// user message bubble — mirrors the framework's user row so the
			// overridden renderer keeps the same look (CSS vars stay intact)
			".dsr-user-row{flex-direction:column;align-items:flex-end;gap:6px;display:flex}",
			".dsr-user-stack{flex-direction:column;align-items:flex-end;gap:8px;min-width:0;max-width:min(525px,82%);display:flex}",
			".dsr-user-bubble{background:var(--dsw-specific-bubble);max-width:100%;color:var(--dsw-alias-label-primary);border-radius:22px;padding:10px 16px;font-size:16px;line-height:24px}",
			".dsr-ref-chip{color:var(--dsw-alias-label-primary);white-space:nowrap;vertical-align:baseline;background:#6187d838;border-radius:6px;margin:0 2px;padding:0 8px;font-size:.85em;line-height:1.6;display:inline-block}",
			// fallback JSON block for non-text/non-image user content
			".dsr-json-block{color:var(--dsw-alias-label-secondary);border:1px solid var(--dsw-alias-line-strong, rgba(128,128,128,.25));border-radius:8px;padding:6px 10px;font-size:12px;line-height:18px;max-width:100%;overflow:auto}",
			".dsr-json-label{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;margin-bottom:2px}",
			// recalled-message notice
			".dsr-notice-row{align-items:center;justify-content:center;display:flex}",
			".dsr-notice{color:var(--dsw-alias-label-caption);background:var(--dsw-alias-interactive-bg-hover-solid);border-radius:14px;padding:2px 12px;font-size:12px;line-height:20px}"
		].join("");
		const CSS_TAG = "dsh-recall/Recall.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(CSS_TAG) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-recall";
			tag.dataset.pluginCss = CSS_TAG;
			tag.textContent = css;
			document.head.appendChild(tag);
		}

		// ── undo icon (inline; no icon dependency) ────────────────────────────
		const UNDO_SVG = react.createElement("svg", {
			width: 14,
			height: 14,
			viewBox: "0 0 24 24",
			fill: "none",
			stroke: "currentColor",
			strokeWidth: 2,
			strokeLinecap: "round",
			strokeLinejoin: "round",
			"aria-hidden": true
		},
			react.createElement("polyline", { points: "1 4 1 10 7 10" }),
			react.createElement("path", { d: "M3.51 15a9 9 0 1 0 2.13-9.36L1 10" })
		);

		// ── locales ───────────────────────────────────────────────────────────
		/** `recall` namespace dictionaries. */
		/** Simplified Chinese dictionary (the key-set source of truth). */
		const zh = {
			"action": "撤回本轮对话",
			"confirmTurn": "撤回本轮对话及其后的全部内容？该消息会恢复到输入框，可修改后重新发送。已产生的代码/文件改动不会回退。",
			"notice": "已撤回的消息",
			"errorBusy": "智能体正在运行，请先停止当前回合再撤回",
			"error": "撤回失败：{reason}",
			"imageLabel": "图片",
			"imageOpen": "查看原图",
			"imageOpenNamed": "查看 {label}",
			"imageLoading": "加载中",
			"imageLoadFailed": "加载失败",
			"lightboxDialog": "图片预览",
			"lightboxClose": "关闭",
			"extraBlock": "附加内容",
			"jsonTruncated": "已截断，共 {total} 项"
		};
		/** English dictionary, checked complete against the zh key set. */
		const en = {
			"action": "Recall this turn",
			"confirmTurn": "Recall this turn and everything after it? The message will be restored to the input box for editing and resending. Any code or file changes it produced will NOT be reverted.",
			"notice": "Recalled message",
			"errorBusy": "The agent is running; stop the current turn before recalling",
			"error": "Recall failed: {reason}",
			"imageLabel": "Image",
			"imageOpen": "Open original",
			"imageOpenNamed": "Open {label}",
			"imageLoading": "Loading",
			"imageLoadFailed": "Failed to load",
			"lightboxDialog": "Image preview",
			"lightboxClose": "Close",
			"extraBlock": "Additional content",
			"jsonTruncated": "Truncated, {total} items total"
		};

		// ── recall request (plugin's own host route) ──────────────────────────
		/** POST one recall request; settles to the host envelope `{ok, value|error}`. */
		async function recallRequest(payload) {
			try {
				const response = await fetch("/recall", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(payload)
				});
				let body = null;
				try {
					body = await response.json();
				} catch {}
				if (body === null || typeof body !== "object") {
					return { ok: false, error: { code: "transport", message: "HTTP " + response.status } };
				}
				return body;
			} catch (error) {
				return { ok: false, error: { code: "transport", message: error instanceof Error ? error.message : String(error) } };
			}
		}

		// ── restore the recalled text into the composer draft ────────────────
		/**
		 * Write `text` back into the session's composer draft — the "back to the
		 * input box" half of recall (the opencode undo affordance). Resolved
		 * lazily through the client root ctx: `sessions.scope(sessionId)` hands
		 * the agent-scoped ctx the conversation service's `input.for` ticket
		 * needs. Degrades to a logged no-op when the services are unavailable,
		 * never a crash.
		 * @param sessionId - the session whose composer receives the text.
		 * @param text - the recalled message's plain text (empty = no-op).
		 * @returns whether the draft write was attempted.
		 */
		function restoreDraft(sessionId, text) {
			if (typeof text !== "string" || text === "") return false;
			const ctx = recallCtx;
			if (ctx === null) return false;
			try {
				const actx = typeof ctx.sessions?.scope === "function" ? ctx.sessions.scope(sessionId) : void 0;
				if (actx === void 0) return false;
				const conversation = ctx.get("conversation");
				const input = conversation?.input;
				if (input === void 0 || typeof input.for !== "function") return false;
				const facade = input.for(actx);
				if (typeof facade?.setDraft !== "function") return false;
				facade.setDraft(text);
				return true;
			} catch (error) {
				console.warn("[dsh-recall] draft restore failed:", error);
				return false;
			}
		}

		// ── user message rendering helpers (mirror of the framework's own) ─────
		/** Split a message content block list into text, images, and other blocks. */
		function contentParts(content) {
			const texts = [];
			const images = [];
			const rest = [];
			for (const block of Array.isArray(content) ? content : []) {
				if (block?.type === "text" && typeof block.text === "string") texts.push(block.text);
				else if (block?.type === "image" && block.attachment !== void 0) images.push({ attachment: block.attachment });
				else rest.push(block);
			}
			return {
				text: texts.join(""),
				images,
				rest
			};
		}

		/** Project user text, highlighting /skill and @subagent mentions as chips. */
		function projectUserText(text) {
			if (typeof text !== "string" || text === "") return null;
			const re = /(^|\s)([/@][\w-]+)(?=\s|$)/g;
			const parts = [];
			let cursor = 0;
			let m;
			while ((m = re.exec(text)) !== null) {
				const tokenStart = m.index + (m[1]?.length ?? 0);
				const label = m[2] ?? "";
				if (tokenStart > cursor) parts.push(react.createElement("span", { key: cursor }, text.slice(cursor, tokenStart)));
				parts.push(react.createElement("span", {
					key: tokenStart,
					className: "dsr-ref-chip",
					"data-ref-chip": label.startsWith("@") ? "subagent" : "skill"
				}, label));
				cursor = tokenStart + label.length;
			}
			if (parts.length === 0) return react.createElement("span", null, text);
			if (cursor < text.length) parts.push(react.createElement("span", { key: cursor }, text.slice(cursor)));
			return react.createElement(react.Fragment, null, parts);
		}

		/** User-message image gallery labels, resolved from the recall dictionary. */
		function imageLabels(t) {
			return {
				image: t("imageLabel"),
				open: t("imageOpen"),
				openNamed: (label) => t("imageOpenNamed", { label }),
				loading: t("imageLoading"),
				loadFailed: t("imageLoadFailed"),
				lightbox: {
					dialog: t("lightboxDialog"),
					close: t("lightboxClose")
				}
			};
		}

		/** Compact JSON display for non-text, non-image user blocks. */
		function JsonBlockFallback({ label, payload }) {
			return react.createElement("div", { className: "dsr-json-block", role: "status" },
				react.createElement("div", { className: "dsr-json-label" }, label),
				react.createElement("pre", { style: { margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word" } }, JSON.stringify(payload))
			);
		}

		// ── components ─────────────────────────────────────────────────────────
		/**
		* One recall control: an undo button with mandatory confirmation and an
		* inline failure note. The action never reverts filesystem changes.
		*/
		function RecallControl({ ariaLabel, confirmMessage, doRecall, disabled = false, t }) {
			const [pending, setPending] = react.useState(false);
			const [failure, setFailure] = react.useState(null);
			const alive = react.useRef(true);
			react.useEffect(() => () => {
				alive.current = false;
			}, []);
			const onClick = () => {
				if (!window.confirm(confirmMessage)) return;
				setPending(true);
				setFailure(null);
				Promise.resolve(doRecall()).then((result) => {
					if (!alive.current) return;
					setPending(false);
					if (result?.ok === true) return;
					const code = result?.error?.code;
					setFailure(code === "agent-busy" ? t("errorBusy") : t("error", {
						reason: result?.error?.message ?? code ?? ""
					}));
				});
			};
			return react.createElement(react.Fragment, null,
				react.createElement("button", {
					type: "button",
					className: "dsr-action",
					"aria-label": ariaLabel,
					title: ariaLabel,
					disabled: pending || disabled,
					onClick
				}, UNDO_SVG),
				failure !== null ? react.createElement("span", { className: "dsr-failure", role: "status" }, failure) : null
			);
		}

		/**
		* The user-message renderer (shadows the framework default at priority
		* -1): the same right-aligned bubble, plus one undo button that recalls
		* this turn and everything after it. The user message seq is the recall
		* boundary — the host removes that event and every later one.
		*/
		function UserRecallNodeView(props) {
			const { node, loadImage, sessionId, useSession, t } = props;
			const data = node?.data;
			if (data === void 0 || sessionId === void 0) return null;
			const boundary = data.seq;
			const running = typeof useSession === "function" ? useSession((snapshot) => snapshot.running) : false;
			const { text, images, rest } = contentParts(data.content);
			const showBubble = text !== "" || rest.length > 0;
			return react.createElement("div", { className: "dsr-user-row", "data-time-hover-root": true },
				react.createElement("div", { className: "dsr-user-stack" },
					images.length > 0 && typeof ImageGallery === "function" ? react.createElement(ImageGallery, {
						images,
						load: loadImage,
						align: "end",
						labels: imageLabels(t)
					}) : null,
					showBubble ? react.createElement("div", { className: "dsr-user-bubble" },
						projectUserText(text),
						rest.map((block, i) => react.createElement(JsonBlockFallback, {
							key: i,
							label: t("extraBlock"),
							payload: block
						}))
					) : null
				),
				react.createElement(RecallControl, {
					ariaLabel: t("action"),
					confirmMessage: t("confirmTurn"),
					doRecall: () => recallRequest({ sessionId, boundary }).then((result) => {
						// restore only AFTER the recall commits — never before, so a
						// fast re-submit cannot race the tombstone (the opencode
						// undo-restore race)
						if (result?.ok === true) restoreDraft(sessionId, text);
						return result;
					}),
					disabled: running === true,
					t
				})
			);
		}

		/** Recalled-message notice rendered at the recall tombstone's position. */
		function RecallNotice(props) {
			const { t } = props;
			return react.createElement("div", { className: "dsr-notice-row", "data-recall": true },
				react.createElement("span", { className: "dsr-notice" }, t("notice"))
			);
		}

		// ── conversation definition: the recall notice node ────────────────────
		/** Build one final Chat target Node (the shape the chat view builder expects). */
		function chatNode(context, kind, anchorSeq, data) {
			return {
				key: context.key,
				kind,
				id: context.id,
				target: "chat",
				anchorSeq,
				location: context.start?.location ?? context.matches[0]?.location ?? { kind: "unresolved" },
				visibility: "visible",
				data
			};
		}

		/**
		* One durable message recall: a system notice anchored at the recall
		* tombstone's seq. The recalled events themselves never reach the
		* assembler (the runtime Session prunes them), so this node is the only
		* trace of the recall in the chat flow.
		*/
		const recallDefinition = {
			kind: "recall",
			target: "chat",
			match: (event) => event.type === "session/recall" ? {
				id: String(event.seq),
				role: "start"
			} : null,
			start: (_context, match) => {
				if (match.event.type !== "session/recall") throw new Error("recall start requires session/recall");
				return {
					kind: "recall",
					seq: match.event.seq,
					time: match.event.time,
					boundary: match.event.data.boundary
				};
			},
			update: (context) => context.state,
			buildViewNode: (context) => context.state === void 0 ? null : chatNode(context, "recall", context.state.seq, context.state)
		};

		// ── plugin body ─────────────────────────────────────────────────────────
		/** Dictionary namespace owned by this plugin. */
		const NS = "recall";
		/** Required services. */
		const inject = ["slots", "locale", "sessions", "conversationEvents"];

		/**
		* Client plugin body: the user-message recall button (keyed Chat Node
		* seat override, key "user", priority -1) plus the recalled-message
		* notice.
		* @param ctx - client root context.
		*/
		function apply(ctx) {
			recallCtx = ctx;
			const slots = ctx.get("slots");
			const locale = ctx.get("locale");
			const conversationEvents = ctx.get("conversationEvents");
			if (slots === void 0 || locale === void 0 || conversationEvents === void 0) return;
			if (typeof ctx.effect === "function") ctx.effect(() => locale.register(NS, {
				zh,
				en
			}), "dsh-recall: dictionaries");
			else locale.register(NS, { zh, en });
			conversationEvents.register(recallDefinition);
			slots.inject("conversation.chat.node", () => slots.register({
				name: "conversation.chat.node",
				key: "user",
				priority: -1,
				locale: NS
			}, UserRecallNodeView));
			slots.inject("conversation.chat.node", () => slots.register({
				name: "conversation.chat.node",
				key: "recall",
				locale: NS
			}, RecallNotice));
		}

		exports.apply = apply;
		exports.inject = inject;
		exports.recallDefinition = recallDefinition;
		exports.contentParts = contentParts;
		exports.projectUserText = projectUserText;
		exports.recallRequest = recallRequest;
		exports.restoreDraft = restoreDraft;
		return module.exports;
	}
});
