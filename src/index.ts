/**
 * omp-grok-build
 * ==============
 *
 * First-class Grok Build provider for Oh My Pi — without forking omp and without
 * depending on SuperGrok (`xai-oauth`) billing.
 *
 * ## Why this extension exists
 *
 * There are TWO different product surfaces that people mix up:
 *
 * 1) `xai-oauth` (built into omp)
 *    - Auth: SuperGrok / X Premium+ OAuth
 *    - Inference: https://api.x.ai/v1 (Responses)
 *    - Model ids like `xai-oauth/grok-build` still bill through SuperGrok path
 *    - This is what "eats" SuperGrok account quota
 *
 * 2) Grok Build CLI product (`grok` binary)
 *    - Auth: same xAI OAuth client, but session is used as CLI token
 *    - Inference: https://cli-chat-proxy.grok.com/v1
 *    - Required headers:
 *        Authorization: Bearer <token>
 *        X-XAI-Token-Auth: xai-grok-cli
 *        x-grok-model-override: <model>
 *        x-grok-client-surface: grok-build   (client identity)
 *    - Billing/limits are the Build/CLI free/subscription window, not SuperGrok API
 *
 * This extension registers provider id `grok-build` as (2), with its own
 * `/login` + credential store. It intentionally does NOT use
 * `storeCredentialsAs: "xai-oauth"`.
 *
 * ## Install (any machine)
 *
 * ```bash
 * # option A: link a clone
 * git clone https://github.com/ART1KZ/omp-grok-build.git
 * omp plugin link ./omp-grok-build
 *
 * # option B: install from GitHub
 * omp plugin install github:ART1KZ/omp-grok-build
 *
 * # option C: drop-in extension file path
 * # copy/link src into ~/.omp/agent/extensions/ or set:
 * # extensions: ["~/code/omp-grok-build/src/index.ts"]
 * ```
 *
 * Then in omp:
 *   /login  →  Grok Build (CLI proxy)
 *   /model grok-build/grok-4.5
 *
 * Recommended config.yml bits (optional):
 *   disabledProviders: [xai-oauth]   # avoid accidental SuperGrok use
 *   modelRoles.default: grok-build/grok-4.5
 */

import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import {
	loginGrokBuildOAuth,
	refreshGrokBuildOAuthToken,
	type OAuthCredentials,
} from "./xai-device-oauth";

/** Provider id used in selectors: grok-build/<model> */
export const PROVIDER_ID = "grok-build";

/** Official Grok Build CLI chat proxy. */
export const GROK_BUILD_BASE_URL = "https://cli-chat-proxy.grok.com/v1";

/**
 * Headers that make the proxy treat the request as Grok Build CLI traffic.
 * Without X-XAI-Token-Auth the bearer is rejected as a non-CLI token.
 * Without x-grok-model-override the proxy may not route to the right cluster.
 */
export const GROK_BUILD_HEADERS = {
	"X-XAI-Token-Auth": "xai-grok-cli",
	"x-grok-client-version": "0.2.93",
	"x-grok-client-surface": "grok-build",
} as const;

const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } as const;

/**
 * Static catalog seed. Live /v1/models varies by account tier; these two are
 * the stable CLI surface models (see `grok models` + models_cache.json).
 *
 * Per-model `x-grok-model-override` is critical: the proxy routes by header,
 * not only by JSON body model field.
 */
const MODELS = [
	{
		id: "grok-4.5",
		name: "Grok 4.5 (Grok Build CLI)",
		api: "openai-completions" as const,
		reasoning: true,
		input: ["text", "image"] as ("text" | "image")[],
		cost: { ...ZERO_COST },
		contextWindow: 500_000,
		maxTokens: 64_000,
		headers: {
			"x-grok-model-override": "grok-4.5",
		},
		compat: {
			// CLI proxy returns reasoning_content dialect.
			supportsReasoningEffort: true,
			omitReasoningEffort: false,
			supportsReasoningParams: true,
			reasoningContentField: "reasoning_content",
			reasoningEffortMap: {
				minimal: "low",
				xhigh: "high",
			},
			requiresReasoningContentForToolCalls: false,
		},
	},
	{
		id: "grok-build",
		name: "Grok Build coding SKU (CLI)",
		api: "openai-completions" as const,
		reasoning: true,
		input: ["text", "image"] as ("text" | "image")[],
		cost: { ...ZERO_COST },
		contextWindow: 512_000,
		maxTokens: 64_000,
		headers: {
			"x-grok-model-override": "grok-build",
		},
		compat: {
			// This SKU thinks natively but rejects reasoning.effort on some paths.
			supportsReasoningEffort: false,
			omitReasoningEffort: true,
			supportsReasoningParams: false,
			reasoningContentField: "reasoning_content",
			requiresReasoningContentForToolCalls: false,
		},
	},
	{
		id: "grok-composer-2.5-fast",
		name: "Composer 2.5 Fast (Grok Build CLI)",
		api: "openai-completions" as const,
		reasoning: false,
		input: ["text"] as ("text" | "image")[],
		cost: { ...ZERO_COST },
		contextWindow: 200_000,
		maxTokens: 64_000,
		headers: {
			"x-grok-model-override": "grok-composer-2.5-fast",
		},
	},
];

function getApiKey(credentials: OAuthCredentials): string {
	return credentials.access;
}

export default function ompGrokBuildExtension(pi: ExtensionAPI): void {
	pi.setLabel("Grok Build (CLI proxy)");

	pi.registerProvider(PROVIDER_ID, {
		baseUrl: GROK_BUILD_BASE_URL,
		api: "openai-completions",
		// Bearer from OAuth storage after /login. authHeader injects Authorization.
		authHeader: true,
		headers: { ...GROK_BUILD_HEADERS },
		models: MODELS,
		oauth: {
			name: "Grok Build (CLI proxy)",
			/**
			 * Device-code flow (same client as official `grok login --device-auth`).
			 * Credentials are stored under provider id `grok-build` only.
			 */
			login: async callbacks => loginGrokBuildOAuth(callbacks),
			refreshToken: async credentials =>
				refreshGrokBuildOAuthToken(credentials.refresh),
			getApiKey,
		},
	});

	pi.registerCommand("grok-build-help", {
		description: "Explain Grok Build provider vs xai-oauth SuperGrok",
		handler: async (_args, ctx) => {
			ctx.ui.notify(
				[
					"Grok Build extension loaded.",
					"",
					"Use:",
					"  /login  →  Grok Build (CLI proxy)",
					"  /model grok-build/grok-4.5",
					"",
					"NOT the same as built-in xai-oauth:",
					"  xai-oauth/*  → SuperGrok / api.x.ai quota",
					"  grok-build/* → cli-chat-proxy.grok.com Build/CLI surface",
					"",
					"Tip: disable xai-oauth in config.yml if you only want Build.",
				].join("\n"),
				"info",
			);
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		// Quiet by default — only useful once so users know /login exists.
		// Avoid spam on every session: notify only if nothing is selected yet.
		const model = ctx.model;
		if (!model) {
			ctx.ui.notify(
				"Grok Build extension ready. /login → Grok Build (CLI proxy), then /model grok-build/grok-4.5",
				"info",
			);
		}
	});
}
