/**
 * Smoke official-like identity rules (main chat, not recap jobs):
 * - conversation id stable per session
 * - session-id == conv-id
 * - req-id changes every request
 * - turn-idx monotonic
 * - no recap- prefix on main chat
 */
import {
	buildGrokCliRequestHeaders,
	countUserTurns,
	newRequestId,
	nextTurnIndex,
	resolveConversationId,
} from "../src/identity.ts";
import { STATIC_SEED } from "../src/models.ts";
import { GROK_BUILD_API, GROK_BUILD_HEADERS } from "../src/constants.ts";

const sessionA = "019f4c25-2a4a-7000-b800-434fe0a039cc";
const sessionB = "019f4ba1-3103-7000-9181-3d3e8f450430";

const convA1 = resolveConversationId(sessionA);
const convA2 = resolveConversationId(sessionA);
const convB = resolveConversationId(sessionB);

if (convA1 !== sessionA || convA2 !== sessionA) {
	console.error("FAIL: main chat conv id should equal session id", convA1, convA2);
	process.exit(1);
}
if (convB === convA1) {
	console.error("FAIL: different sessions must differ");
	process.exit(1);
}
if (String(convA1).startsWith("recap-")) {
	console.error("FAIL: main chat must not use recap- prefix");
	process.exit(1);
}

const req1 = newRequestId();
const req2 = newRequestId();
if (!req1 || !req2 || req1 === req2) {
	console.error("FAIL: request ids must be unique", req1, req2);
	process.exit(1);
}

const t1 = nextTurnIndex(convA1, 1);
const t2 = nextTurnIndex(convA1, 2);
const t3 = nextTurnIndex(convA1, 2); // observed same => do not go backwards
if (!(t1 === 1 && t2 === 2 && t3 === 2)) {
	console.error("FAIL: turn index logic", { t1, t2, t3 });
	process.exit(1);
}

const h1 = buildGrokCliRequestHeaders({
	conversationId: convA1,
	requestId: req1,
	turnIndex: t1,
	modelId: "grok-4.5",
	base: { ...GROK_BUILD_HEADERS },
});
const h2 = buildGrokCliRequestHeaders({
	conversationId: convA1,
	requestId: req2,
	turnIndex: t2,
	modelId: "grok-4.5",
	base: { ...GROK_BUILD_HEADERS },
});

console.log("headers call1", h1);
console.log("headers call2", h2);

if (h1["x-grok-session-id"] !== h1["x-grok-conv-id"]) {
	console.error("FAIL: session-id must equal conv-id on main chat");
	process.exit(1);
}
if (h1["x-grok-conv-id"] !== h2["x-grok-conv-id"]) {
	console.error("FAIL: conv id must be stable across requests");
	process.exit(1);
}
if (h1["x-grok-req-id"] === h2["x-grok-req-id"]) {
	console.error("FAIL: req id must change every request");
	process.exit(1);
}
if (h1["x-grok-req-id"].startsWith("xai-recap-") || h1["x-grok-req-id"].startsWith("recap-")) {
	console.error("FAIL: main-chat req id should not use recap prefixes");
	process.exit(1);
}
if (h1["x-grok-turn-idx"] !== "1" || h2["x-grok-turn-idx"] !== "2") {
	console.error("FAIL: turn idx", h1["x-grok-turn-idx"], h2["x-grok-turn-idx"]);
	process.exit(1);
}
if (h1["X-XAI-Token-Auth"] !== "xai-grok-cli") {
	console.error("FAIL: missing token auth");
	process.exit(1);
}
if (h1["x-grok-client-identifier"] !== "grok-pager") {
	console.error("FAIL: client identifier should be grok-pager");
	process.exit(1);
}

if (countUserTurns([{ role: "user" }, { role: "assistant" }, { role: "user" }]) !== 2) {
	console.error("FAIL: countUserTurns");
	process.exit(1);
}

if (!STATIC_SEED.every(m => m.api === GROK_BUILD_API)) {
	console.error(
		"FAIL: seed api",
		STATIC_SEED.map(m => m.api),
	);
	process.exit(1);
}

console.log("PASS");
console.log("main chat: session=conv stable; req changes; turn grows; no recap- prefix");
