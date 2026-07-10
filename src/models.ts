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
}

const CURATED: Record<string, CuratedOverlay> = {
	"grok-4.5": {
		name: "Grok 4.5 (Grok Build CLI)",
		reasoning: true,
		input: ["text", "image"],
		contextWindow: 500_000,
		maxTokens: 64_000,
		compat: {
			supportsReasoningEffort: true,
			supportsReasoningParams: true,
			reasoningEffortMap: { minimal: "low", xhigh: "high" },
			promptCacheSessionHeader: "x-grok-conv-id",
		},
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
