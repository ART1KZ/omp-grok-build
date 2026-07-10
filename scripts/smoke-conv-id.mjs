/**
 * Self-contained smoke that mirrors omp's cache-affinity injection logic.
 *
 * Source of truth in omp:
 * - getOpenAIPromptCacheKey(options) => normalize(promptCacheKey || sessionId)
 * - resolveOpenAIRequestSetup:
 *     if (promptCacheSessionId && model.compat.promptCacheSessionHeader)
 *       headers[promptCacheSessionHeader] = promptCacheSessionId
 *
 * This proves:
 * 1) enabling compat.promptCacheSessionHeader="x-grok-conv-id" injects header
 * 2) one sessionId => same header on every tool-step request
 * 3) without compat field, header is absent
 */

function normalizeOpenAIStableId(sessionId, maxLen = 64, prefix = "pc_") {
	if (!sessionId) return undefined;
	const cleaned = String(sessionId).trim();
	if (!cleaned) return undefined;
	// omp keeps alnum/_/- mostly; for smoke just truncate safely
	const compact = cleaned.replace(/[^a-zA-Z0-9._-]/g, "_");
	if (compact.length <= maxLen) return compact;
	return `${prefix}${compact.slice(0, maxLen - prefix.length)}`;
}

function getOpenAIPromptCacheKey(options) {
	if (options?.cacheRetention === "none") return undefined;
	return normalizeOpenAIStableId(options?.promptCacheKey ?? options?.sessionId);
}

function setHeaderIfAbsent(headers, name, value) {
	const normalizedName = name.toLowerCase();
	for (const existingName of Object.keys(headers)) {
		if (existingName.toLowerCase() === normalizedName) return;
	}
	headers[name] = value;
}

function resolveOpenAIRequestSetup(model, options) {
	const headers = { ...(model.headers ?? {}) };
	Object.assign(headers, options.extraHeaders ?? {});
	if (options.promptCacheSessionId && model.compat?.promptCacheSessionHeader) {
		setHeaderIfAbsent(headers, model.compat.promptCacheSessionHeader, options.promptCacheSessionId);
	}
	headers.Authorization ??= `Bearer ${options.apiKey}`;
	return { headers };
}

const modelWithCompat = {
	provider: "grok-build",
	baseUrl: "https://cli-chat-proxy.grok.com/v1",
	headers: {
		"X-XAI-Token-Auth": "xai-grok-cli",
		"x-grok-client-surface": "grok-build",
		"x-grok-model-override": "grok-4.5",
	},
	compat: {
		promptCacheSessionHeader: "x-grok-conv-id",
	},
};

const modelNoCompat = {
	...modelWithCompat,
	compat: {},
};

const sessionId = "omp-session-abc-1234567890";

function once(model, label) {
	const promptCacheSessionId = getOpenAIPromptCacheKey({ sessionId });
	const setup = resolveOpenAIRequestSetup(model, {
		apiKey: "test-token",
		promptCacheSessionId,
		extraHeaders: {},
	});
	return {
		label,
		promptCacheSessionId,
		convId: setup.headers["x-grok-conv-id"] ?? null,
		tokenAuth: setup.headers["X-XAI-Token-Auth"] ?? setup.headers["x-xai-token-auth"] ?? null,
		surface: setup.headers["x-grok-client-surface"] ?? null,
		override: setup.headers["x-grok-model-override"] ?? null,
	};
}

const rows = [once(modelWithCompat, "t1"), once(modelWithCompat, "t2"), once(modelWithCompat, "t3")];
const control = once(modelNoCompat, "control");
console.log("with compat:", rows);
console.log("without compat:", control);

const ids = rows.map(r => r.convId);
const keys = rows.map(r => r.promptCacheSessionId);
const sameConv = ids.every(v => v && v === ids[0]);
const sameKey = keys.every(v => v && v === keys[0]);
const cli =
	rows.every(r => r.tokenAuth === "xai-grok-cli") &&
	rows.every(r => r.surface === "grok-build") &&
	rows.every(r => r.override === "grok-4.5");

if (!sameConv) {
	console.error("FAIL: conv id not stable", ids);
	process.exit(1);
}
if (!sameKey) {
	console.error("FAIL: cache key not stable", keys);
	process.exit(1);
}
if (!cli) {
	console.error("FAIL: CLI headers missing");
	process.exit(1);
}
if (control.convId) {
	console.error("FAIL: expected no header without compat");
	process.exit(1);
}
if (ids[0] !== keys[0]) {
	console.error("FAIL: header/key mismatch", ids[0], keys[0]);
	process.exit(1);
}

// also verify seed models carry the compat flag
const { STATIC_SEED } = await import("../src/models.ts");
const bad = STATIC_SEED.filter(m => m.compat?.promptCacheSessionHeader !== "x-grok-conv-id");
if (bad.length) {
	console.error(
		"FAIL: seed models missing promptCacheSessionHeader",
		bad.map(m => m.id),
	);
	process.exit(1);
}

console.log("PASS");
console.log("1 omp session/conversation => 1 x-grok-conv-id:", ids[0]);
console.log("same identity for prompt_cache_key:", keys[0]);
console.log(
	"all seed models have promptCacheSessionHeader:",
	STATIC_SEED.map(m => m.id).join(", "),
);
