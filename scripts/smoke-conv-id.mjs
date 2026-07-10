/**
 * Smoke:
 * 1) promptCacheSessionHeader enables x-grok-conv-id injection
 * 2) one session => one stable id across tool steps
 * 3) generator reshapes omp session strings to conv-<uuid> CLI-like form
 */
import { createHash } from "node:crypto";
import { toGrokBuildConvId, stableUuidFromString } from "../src/conv-id.ts";
import { STATIC_SEED } from "../src/models.ts";

function normalizeOpenAIStableId(sessionId, maxLen = 64) {
	if (!sessionId) return undefined;
	const cleaned = String(sessionId).trim();
	if (!cleaned) return undefined;
	const compact = cleaned.replace(/[^a-zA-Z0-9._-]/g, "_");
	return compact.length <= maxLen ? compact : compact.slice(0, maxLen);
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
	if (options.promptCacheSessionId && model.compat?.promptCacheSessionHeader) {
		setHeaderIfAbsent(headers, model.compat.promptCacheSessionHeader, options.promptCacheSessionId);
	}
	headers.Authorization ??= `Bearer ${options.apiKey}`;
	return { headers };
}

function rewriteProviderPayload(payload, sessionId) {
	if (!payload || typeof payload !== "object") return payload;
	const next = { ...payload };
	const source =
		(typeof next.prompt_cache_key === "string" && next.prompt_cache_key) ||
		sessionId ||
		undefined;
	const convId = toGrokBuildConvId(source);
	if (convId) next.prompt_cache_key = convId;
	return next;
}

const modelWithCompat = {
	provider: "grok-build",
	headers: {
		"X-XAI-Token-Auth": "xai-grok-cli",
		"x-grok-client-surface": "grok-build",
		"x-grok-model-override": "grok-4.5",
	},
	compat: { promptCacheSessionHeader: "x-grok-conv-id" },
};

const ompSessionId = "019f4c25-2a4a-7000-b800-434fe0a039cc";
const convId = toGrokBuildConvId(ompSessionId);
if (!convId || !/^conv-[0-9a-f-]{36}$/i.test(convId)) {
	console.error("FAIL: expected conv-<uuid>, got", convId);
	process.exit(1);
}

// same omp session => same conv id
const again = toGrokBuildConvId(ompSessionId);
if (again !== convId) {
	console.error("FAIL: conv id not stable", convId, again);
	process.exit(1);
}

// different session => different conv id
const other = toGrokBuildConvId("019f4ba1-3103-7000-9181-3d3e8f450430");
if (other === convId) {
	console.error("FAIL: different sessions produced same conv id");
	process.exit(1);
}

// already-prefixed ids preserved
if (toGrokBuildConvId("recap-3b4c21ad-5262-4f47-a276-a25ef75edbd8") !== "recap-3b4c21ad-5262-4f47-a276-a25ef75edbd8") {
	console.error("FAIL: recap id should pass through");
	process.exit(1);
}

// header injection uses session identity; then body rewrite reshapes to conv-<uuid>
const rows = [];
for (const label of ["t1", "t2", "t3"]) {
	const promptCacheSessionId = getOpenAIPromptCacheKey({ sessionId: ompSessionId });
	const setup = resolveOpenAIRequestSetup(modelWithCompat, {
		apiKey: "test-token",
		promptCacheSessionId,
	});
	const body = rewriteProviderPayload(
		{ model: "grok-4.5", prompt_cache_key: promptCacheSessionId, stream: true },
		ompSessionId,
	);
	rows.push({
		label,
		headerConvId: setup.headers["x-grok-conv-id"] ?? null,
		bodyConvId: body.prompt_cache_key ?? null,
	});
}

console.log("generator:", { ompSessionId, convId, other });
console.log("requests:", rows);

const bodyIds = rows.map(r => r.bodyConvId);
const headerIds = rows.map(r => r.headerConvId);
if (!bodyIds.every(v => v === convId)) {
	console.error("FAIL: body conv ids not all CLI-style stable", bodyIds, convId);
	process.exit(1);
}
if (!headerIds.every(v => v && v === headerIds[0])) {
	console.error("FAIL: header ids not stable", headerIds);
	process.exit(1);
}

// seed models still request header injection
const bad = STATIC_SEED.filter(m => m.compat?.promptCacheSessionHeader !== "x-grok-conv-id");
if (bad.length) {
	console.error(
		"FAIL: seed models missing promptCacheSessionHeader",
		bad.map(m => m.id),
	);
	process.exit(1);
}

// sanity: hash path works for non-uuid session strings
const pathLike = toGrokBuildConvId("C:/Users/Arem/.omp/agent/sessions/foo");
if (!pathLike || !/^conv-[0-9a-f-]{36}$/i.test(pathLike)) {
	console.error("FAIL: path-like session id not converted", pathLike);
	process.exit(1);
}
// deterministic
if (pathLike !== toGrokBuildConvId("C:/Users/Arem/.omp/agent/sessions/foo")) {
	console.error("FAIL: path-like id not deterministic");
	process.exit(1);
}
// uuid bits look versioned
const u = stableUuidFromString("x");
const ver = Number.parseInt(u.split("-")[2][0], 16);
if ((ver & 0xf) !== 5) {
	// version nibble should be 5
	console.error("FAIL: expected version 5 uuid layout", u);
	process.exit(1);
}

console.log("PASS");
console.log("1 omp session => 1 CLI-style conv id:", convId);
console.log("body prompt_cache_key rewritten to CLI-style on every tool step");
console.log("header affinity still stable for the same omp session");
// keep createHash import used in case tree-shaken analysis looks at this file alone
void createHash;
