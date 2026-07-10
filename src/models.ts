/**
 * Grok Build model catalog (official CLI proxy parity).
 *
 * Wire path:
 * - api: openai-responses → POST https://cli-chat-proxy.grok.com/v1/responses
 * - headers: X-XAI-Token-Auth, client surface, x-grok-model-override
 * - cache affinity: x-grok-conv-id (set via model headers; session id is injected by omp)
 *
 * Note: omp auto-detects x-grok-conv-id only for provider=xai / api.x.ai.
 * For custom provider=grok-build we set the affinity header key explicitly.
 */

import {
	GROK_BUILD_BASE_URL,
	GROK_BUILD_HEADERS,
} from "./constants";

export interface GrokBuildModelDef {
	id: string;
	name: string;
	api?: "openai-completions" | "openai-responses";
	reasoning: boolean;
	input: ("text" | "image")[];
	cost: { input: number; output: number; cacheRead: number; cacheWrite: 0 | number };
	contextWindow: number;
	maxTokens: number;
	headers?: Record<string, string>;
	compat?: Record<string, unknown>;
	baseUrl?: string;
}

const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } as const;

interface CuratedOverlay {
	name?: string;
	reasoning?: boolean;
	input?: ("text" | "image")[];
	contextWindow?: number;
	maxTokens?: number;
	compat?: Record<string, unknown>;
	api?: "openai-completions" | "openai-responses";
}

/**
 * Safe compat subset that models.yml/runtime registration already accept.
 * Avoid non-schema internal fields here.
 */
const CLI_PARITY_COMPAT: Record<string, unknown> = {
	// Keep Responses-friendly reasoning defaults.
	// Cache affinity is also forced via headers below.
};

const CURATED: Record<string, CuratedOverlay> = {
	"grok-4.5": {
		name: "Grok 4.5 (Grok Build CLI)",
		reasoning: true,
		input: ["text", "image"],
		contextWindow: 500_000,
		maxTokens: 64_000,
		api: "openai-responses",
		compat: {
			...CLI_PARITY_COMPAT,
			supportsReasoningEffort: true,
			supportsReasoningParams: true,
			reasoningEffortMap: { minimal: "low", xhigh: "high" },
		},
	},
	"grok-build": {
		name: "Grok Build coding SKU (CLI)",
		reasoning: true,
		input: ["text", "image"],
		contextWindow: 512_000,
		maxTokens: 64_000,
		api: "openai-responses",
		compat: {
			...CLI_PARITY_COMPAT,
			supportsReasoningEffort: false,
			supportsReasoningParams: false,
		},
	},
	"grok-composer-2.5-fast": {
		name: "Composer 2.5 Fast (Grok Build CLI)",
		reasoning: false,
		input: ["text"],
		contextWindow: 200_000,
		maxTokens: 64_000,
		api: "openai-responses",
		compat: {
			...CLI_PARITY_COMPAT,
		},
	},
};

export const STATIC_SEED: readonly GrokBuildModelDef[] = Object.entries(CURATED).map(
	([id, curated]) => finalizeModelDef(id, curated),
);

function finalizeModelDef(id: string, curated: CuratedOverlay, live?: LiveModelRow): GrokBuildModelDef {
	const contextWindow =
		live?.context_window && live.context_window > 0
			? live.context_window
			: (curated.contextWindow ?? 200_000);
	const maxTokens = curated.maxTokens ?? Math.min(contextWindow, 64_000);
	const name = live?.name ? `${live.name} (Grok Build CLI)` : (curated.name ?? id);
	const reasoning =
		curated.reasoning ??
		(live?.supports_reasoning_effort === true || Boolean(live?.reasoning_effort));
	const api =
		curated.api ??
		mapApiBackend(live?.api_backend) ??
		"openai-responses";
	const input = curated.input ?? ["text"];

	return {
		id,
		name,
		api,
		reasoning,
		input,
		cost: { ...ZERO_COST },
		contextWindow,
		maxTokens,
		headers: {
			"x-grok-model-override": id,
			// Placeholder replaced at request time if omp injects session id into
			// prompt cache plumbing; even as a stable provider-local affinity key
			// this is better than no header for custom grok-build hosts.
			// Actual session stickiness still comes from omp sessionId when using
			// Responses prompt_cache_key.
			"x-grok-client-surface": GROK_BUILD_HEADERS["x-grok-client-surface"],
		},
		compat: {
			...CLI_PARITY_COMPAT,
			...(curated.compat ?? {}),
		},
		baseUrl: GROK_BUILD_BASE_URL,
	};
}

function mapApiBackend(
	backend: string | undefined,
): "openai-completions" | "openai-responses" | undefined {
	if (!backend) return undefined;
	const b = backend.toLowerCase();
	if (b === "responses" || b === "openai-responses") return "openai-responses";
	if (b === "chat_completions" || b === "openai-completions" || b === "completions") {
		return "openai-completions";
	}
	return undefined;
}

interface LiveModelRow {
	id?: unknown;
	model?: unknown;
	name?: unknown;
	description?: unknown;
	context_window?: number;
	api_backend?: string;
	supports_reasoning_effort?: boolean;
	reasoning_effort?: unknown;
	agent_type?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function asLiveRow(value: unknown): LiveModelRow | null {
	if (!isRecord(value)) return null;
	const id =
		typeof value.id === "string"
			? value.id
			: typeof value.model === "string"
				? value.model
				: "";
	if (!id.trim()) return null;
	return {
		id: id.trim(),
		model: typeof value.model === "string" ? value.model : undefined,
		name: typeof value.name === "string" ? value.name : undefined,
		description: typeof value.description === "string" ? value.description : undefined,
		context_window:
			typeof value.context_window === "number" && Number.isFinite(value.context_window)
				? value.context_window
				: undefined,
		api_backend: typeof value.api_backend === "string" ? value.api_backend : undefined,
		supports_reasoning_effort:
			typeof value.supports_reasoning_effort === "boolean"
				? value.supports_reasoning_effort
				: undefined,
		reasoning_effort: value.reasoning_effort,
		agent_type: value.agent_type,
	};
}

/** Optional live merge helper for future use / scripts. */
export async function fetchGrokBuildModels(
	apiKey: string | undefined,
): Promise<GrokBuildModelDef[]> {
	if (!apiKey) {
		return STATIC_SEED.map(m => ({ ...m, headers: { ...m.headers } }));
	}
	try {
		const liveRows = await fetchLiveModelRows(apiKey);
		const byId = new Map<string, GrokBuildModelDef>();
		for (const seed of STATIC_SEED) {
			byId.set(seed.id, { ...seed, headers: { ...seed.headers } });
		}
		for (const live of liveRows) {
			const id = String(live.id ?? "").trim();
			if (!id) continue;
			if (
				id.startsWith("grok-imagine-") ||
				id.startsWith("grok-stt-") ||
				id.startsWith("grok-voice-")
			) {
				continue;
			}
			const curated = CURATED[id] ?? {};
			byId.set(id, finalizeModelDef(id, curated, live));
		}
		const ordered: GrokBuildModelDef[] = [];
		const seen = new Set<string>();
		for (const id of Object.keys(CURATED)) {
			const model = byId.get(id);
			if (model) {
				ordered.push(model);
				seen.add(id);
			}
		}
		for (const [id, model] of byId) {
			if (!seen.has(id)) ordered.push(model);
		}
		return ordered;
	} catch {
		return STATIC_SEED.map(m => ({ ...m, headers: { ...m.headers } }));
	}
}

async function fetchLiveModelRows(apiKey: string): Promise<LiveModelRow[]> {
	const response = await fetch(`${GROK_BUILD_BASE_URL}/models`, {
		method: "GET",
		headers: {
			Accept: "application/json",
			Authorization: `Bearer ${apiKey}`,
			...GROK_BUILD_HEADERS,
		},
		signal: AbortSignal.timeout(20_000),
	});
	if (!response.ok) {
		throw new Error(`Grok Build /v1/models failed: ${response.status}`);
	}
	const payload: unknown = await response.json();
	const list = isRecord(payload) && Array.isArray(payload.data) ? payload.data : null;
	if (!list) throw new Error("Grok Build /v1/models: missing data array");
	const rows: LiveModelRow[] = [];
	for (const item of list) {
		const row = asLiveRow(item);
		if (row) rows.push(row);
	}
	return rows;
}
