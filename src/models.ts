/**
 * Grok Build model catalog (official CLI proxy parity).
 *
 * Wire path via custom stream API `grok-build-cli` → openai-responses transport
 * with official CLI fingerprint headers (see stream.ts / identity.ts).
 */

import { GROK_BUILD_API, GROK_BUILD_BASE_URL } from "./constants";

export interface GrokBuildModelDef {
	id: string;
	name: string;
	api?: string;
	reasoning: boolean;
	input: ("text" | "image")[];
	cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
	contextWindow: number;
	maxTokens: number;
	headers?: Record<string, string>;
	thinking?: { mode: "effort"; efforts: readonly ("low" | "medium" | "high" | "xhigh")[] };
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
	thinking?: { mode: "effort"; efforts: readonly ("low" | "medium" | "high" | "xhigh")[] };
	compat?: Record<string, unknown>;
}

/** Same dial as `grok`: the chosen level is sent unchanged. */
const EFFORT_THINKING = {
	mode: "effort" as const,
	efforts: ["low", "medium", "high", "xhigh"] as const,
};

const EFFORT_COMPAT = {
	supportsReasoningEffort: true,
	supportsReasoningParams: true,
	promptCacheSessionHeader: "x-grok-conv-id",
} as const;

const CURATED: Record<string, CuratedOverlay> = {
	"grok-4.7": {
		name: "Grok 4.7 (Grok Build CLI)",
		reasoning: true,
		input: ["text", "image"],
		contextWindow: 500_000,
		maxTokens: 64_000,
		thinking: EFFORT_THINKING,
		compat: { ...EFFORT_COMPAT },
	},
	// CLI display name is "Grok 4.7 Fast". Wire id from GET /v1/models.
	"grok-4.7-build-fast": {
		name: "Grok 4.7 Fast (Grok Build CLI)",
		reasoning: true,
		input: ["text", "image"],
		contextWindow: 500_000,
		maxTokens: 64_000,
		thinking: EFFORT_THINKING,
		compat: { ...EFFORT_COMPAT },
	},
	"grok-4.6": {
		name: "Grok 4.6 (Grok Build CLI)",
		reasoning: true,
		input: ["text", "image"],
		contextWindow: 500_000,
		maxTokens: 64_000,
		thinking: EFFORT_THINKING,
		compat: { ...EFFORT_COMPAT },
	},
	"grok-4.5": {
		name: "Grok 4.5 (Grok Build CLI)",
		reasoning: true,
		input: ["text", "image"],
		contextWindow: 500_000,
		maxTokens: 64_000,
		thinking: EFFORT_THINKING,
		compat: { ...EFFORT_COMPAT },
	},
	"grok-build": {
		name: "Grok Build coding SKU (CLI)",
		reasoning: true,
		input: ["text", "image"],
		contextWindow: 512_000,
		maxTokens: 64_000,
		compat: {
			supportsReasoningEffort: false,
			supportsReasoningParams: false,
			promptCacheSessionHeader: "x-grok-conv-id",
		},
	},
	"grok-composer-2.5-fast": {
		name: "Composer 2.5 Fast (Grok Build CLI)",
		reasoning: false,
		input: ["text"],
		contextWindow: 200_000,
		maxTokens: 64_000,
		compat: {
			promptCacheSessionHeader: "x-grok-conv-id",
		},
	},
};

export const STATIC_SEED: readonly GrokBuildModelDef[] = Object.entries(CURATED).map(
	([id, curated]) => {
		const contextWindow = curated.contextWindow ?? 200_000;
		return {
			id,
			name: curated.name ?? id,
			api: GROK_BUILD_API,
			reasoning: curated.reasoning ?? false,
			input: curated.input ?? ["text"],
			cost: { ...ZERO_COST },
			contextWindow,
			maxTokens: curated.maxTokens ?? Math.min(contextWindow, 64_000),
			...(curated.thinking ? { thinking: curated.thinking } : {}),
			headers: {
				"x-grok-model-override": id,
			},
			compat: {
				...(curated.compat ?? {}),
			},
			baseUrl: GROK_BUILD_BASE_URL,
		};
	},
);
