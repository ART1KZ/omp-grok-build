/**
 * Grok Build model catalog: static seed + live /v1/models merge.
 *
 * Lifecycle (how long models "stick"):
 * 1. No credentials → return STATIC_SEED only (boot / logged-out).
 * 2. After /login → fetchDynamicModels is called with the bearer.
 * 3. omp caches the returned list in models.db for ~24h
 *    (extension runtime managers use cacheTtlMs = 24h, authoritative).
 * 4. On later sessions within TTL → cached list is reused (no network).
 * 5. After TTL / explicit model refresh / cache miss → re-fetch live list.
 * 6. Live list is account-tier dependent: models appear/disappear over time.
 *
 * So models are NOT permanently frozen after first login. They refresh on the
 * normal omp discovery cadence. Static seed always backfills known SKUs so a
 * flaky / empty live response does not empty the picker.
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
	cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
	contextWindow: number;
	maxTokens: number;
	headers?: Record<string, string>;
	compat?: Record<string, unknown>;
	baseUrl?: string;
}

const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } as const;

/** Curated overlays for known SKUs (headers/compat/context that /v1/models may omit). */
interface CuratedOverlay {
	name?: string;
	reasoning?: boolean;
	input?: ("text" | "image")[];
	contextWindow?: number;
	maxTokens?: number;
	compat?: Record<string, unknown>;
	api?: "openai-completions" | "openai-responses";
}

const CURATED: Record<string, CuratedOverlay> = {
	"grok-4.5": {
		name: "Grok 4.5 (Grok Build CLI)",
		reasoning: true,
		input: ["text", "image"],
		contextWindow: 500_000,
		maxTokens: 64_000,
		api: "openai-responses",
		compat: {
			supportsReasoningEffort: true,
			omitReasoningEffort: false,
			supportsReasoningParams: true,
			reasoningContentField: "reasoning_content",
			reasoningEffortMap: { minimal: "low", xhigh: "high" },
			requiresReasoningContentForToolCalls: false,
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
			supportsReasoningEffort: false,
			omitReasoningEffort: true,
			supportsReasoningParams: false,
			reasoningContentField: "reasoning_content",
			requiresReasoningContentForToolCalls: false,
		},
	},
	"grok-composer-2.5-fast": {
		name: "Composer 2.5 Fast (Grok Build CLI)",
		reasoning: false,
		input: ["text"],
		contextWindow: 200_000,
		maxTokens: 64_000,
		api: "openai-responses",
	},
};

/** Boot-safe seed when unauthenticated or live fetch fails. */
export const STATIC_SEED: readonly GrokBuildModelDef[] = Object.entries(CURATED).map(
	([id, curated]) => finalizeModelDef(id, curated),
);

function finalizeModelDef(id: string, curated: CuratedOverlay, live?: LiveModelRow): GrokBuildModelDef {
	const contextWindow =
		live?.context_window && live.context_window > 0
			? live.context_window
			: (curated.contextWindow ?? 200_000);
	const maxTokens = curated.maxTokens ?? Math.min(contextWindow, 64_000);
	const name = live?.name
		? `${live.name} (Grok Build CLI)`
		: (curated.name ?? id);
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
		},
		compat: curated.compat,
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

/**
 * Hybrid discovery entry used by pi.registerProvider({ fetchDynamicModels }).
 *
 * - no apiKey → STATIC_SEED
 * - with apiKey → live /v1/models merged with curated overlays + seed backfill
 */
export async function fetchGrokBuildModels(
	apiKey: string | undefined,
): Promise<GrokBuildModelDef[]> {
	if (!apiKey) {
		return STATIC_SEED.map(m => ({ ...m, headers: { ...m.headers } }));
	}

	let liveRows: LiveModelRow[] = [];
	try {
		liveRows = await fetchLiveModelRows(apiKey);
	} catch {
		// Network/auth blip: keep seed so picker never goes empty mid-session.
		return STATIC_SEED.map(m => ({ ...m, headers: { ...m.headers } }));
	}

	const byId = new Map<string, GrokBuildModelDef>();

	// Seed first so known SKUs exist even if live omits them temporarily.
	for (const seed of STATIC_SEED) {
		byId.set(seed.id, { ...seed, headers: { ...seed.headers } });
	}

	for (const live of liveRows) {
		const id = String(live.id ?? "").trim();
		if (!id) continue;
		// Skip non-chat tool surfaces if they ever appear on this proxy.
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

	// Prefer curated headline order, then any extra live-only ids.
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
	if (!list) {
		throw new Error("Grok Build /v1/models: missing data array");
	}
	const rows: LiveModelRow[] = [];
	for (const item of list) {
		const row = asLiveRow(item);
		if (row) rows.push(row);
	}
	return rows;
}
