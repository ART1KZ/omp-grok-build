/**
 * Conversation / request identity for Grok Build CLI parity.
 *
 * Official CLI (9router HAR reverse-engineering of grok-shell 0.2.101):
 * - main chat: x-grok-session-id === x-grok-conv-id (same stable id)
 * - each HTTP call: new x-grok-req-id (uuid)
 * - x-grok-turn-idx: 1-based user-turn index, monotonic per session
 * - recap-* / xai-recap-* prefixes are for recap side-jobs only, NOT main chat
 */

import { randomUUID } from "node:crypto";

const turnBySession = new Map<string, number>();

/** Stable conversation/session id for main chat (no recap- prefix). */
export function resolveConversationId(sessionId: string | undefined): string {
	const raw = typeof sessionId === "string" ? sessionId.trim() : "";
	return raw.length > 0 ? raw : randomUUID();
}

/** Fresh per-request id for main chat. */
export function newRequestId(): string {
	return randomUUID();
}

/**
 * Monotonic turn index for a conversation.
 * If observedUserTurns is provided, never go below previous or observed.
 * If omitted, increment by 1.
 */
export function nextTurnIndex(conversationId: string, observedUserTurns?: number): number {
	const prev = turnBySession.get(conversationId) ?? 0;
	let resolved: number;
	if (observedUserTurns === undefined) {
		resolved = Math.max(prev + 1, 1);
	} else {
		const observed = Math.max(1, Math.floor(observedUserTurns));
		resolved = Math.max(observed, prev, 1);
	}
	turnBySession.set(conversationId, resolved);
	return resolved;
}

/** Count user roles in a chat/messages or responses input-like array. */
export function countUserTurns(messages: unknown): number {
	if (!Array.isArray(messages)) return 1;
	let n = 0;
	for (const item of messages) {
		if (!item || typeof item !== "object") continue;
		const role = "role" in item ? item.role : undefined;
		const type = "type" in item ? item.type : undefined;
		if (role === "user" && (type === undefined || type === "message" || type === "text")) {
			n += 1;
		}
	}
	return Math.max(1, n);
}

/** Build official-like per-request CLI headers. */
export function buildGrokCliRequestHeaders(args: {
	conversationId: string;
	requestId: string;
	turnIndex: number;
	modelId: string;
	base?: Record<string, string>;
}): Record<string, string> {
	return {
		...(args.base ?? {}),
		"x-grok-session-id": args.conversationId,
		// HAR: CLI uses the same id for conv + session on chat turns
		"x-grok-conv-id": args.conversationId,
		"x-grok-req-id": args.requestId,
		"x-grok-turn-idx": String(args.turnIndex),
		"x-grok-model-override": args.modelId,
	};
}
