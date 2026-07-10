/**
 * omp-grok-build
 *
 * Grok Build provider for Oh My Pi.
 *
 * Registers provider `grok-build` against the official CLI proxy:
 *   https://cli-chat-proxy.grok.com/v1
 *
 * Wire parity with official Grok Build CLI:
 * - api: openai-responses  → POST /v1/responses
 * - CLI auth headers
 * - x-grok-model-override
 * - promptCacheSessionHeader: x-grok-conv-id
 *
 * Compared with stock `xai-oauth` (api.x.ai / SuperGrok API path):
 * - native /login for Grok Build
 * - credentials stored under `grok-build`
 * - CLI headers and Build/CLI limits
 *
 * Install:
 *   omp plugin install github:ART1KZ/omp-grok-build
 *
 * Use:
 *   /login  → Grok Build (CLI proxy)
 *   /model grok-build/grok-4.5
 */

import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import {
	GROK_BUILD_BASE_URL,
	GROK_BUILD_HEADERS,
	PROVIDER_ID,
} from "./constants";
import { STATIC_SEED } from "./models";
import {
	loginGrokBuildOAuth,
	refreshGrokBuildOAuthToken,
	type OAuthCredentials,
} from "./xai-device-oauth";

function getApiKey(credentials: OAuthCredentials): string {
	return credentials.access;
}

export default function ompGrokBuildExtension(pi: ExtensionAPI): void {
	pi.setLabel("Grok Build (CLI proxy)");

	pi.registerProvider(PROVIDER_ID, {
		baseUrl: GROK_BUILD_BASE_URL,
		api: "openai-responses",
		authHeader: true,
		headers: { ...GROK_BUILD_HEADERS },
		// Static seed keeps models visible before/without auth.
		// Official CLI wire: /v1/responses + CLI headers + x-grok-conv-id affinity.
		// omp treats `models` and `fetchDynamicModels` exclusively; seed is used
		// for reliability and boot visibility.
		models: STATIC_SEED.map(model => ({
			id: model.id,
			name: model.name,
			api: model.api,
			reasoning: model.reasoning,
			input: model.input,
			cost: model.cost,
			contextWindow: model.contextWindow,
			maxTokens: model.maxTokens,
			headers: model.headers,
			compat: model.compat,
		})),
		oauth: {
			name: "Grok Build (CLI proxy)",
			login: async callbacks => loginGrokBuildOAuth(callbacks),
			refreshToken: async credentials =>
				refreshGrokBuildOAuthToken(credentials.refresh),
			getApiKey,
		},
	});

	pi.registerCommand("grok-build-help", {
		description: "Grok Build provider help",
		handler: async (_args, ctx) => {
			ctx.ui.notify(
				[
					"Grok Build provider",
					"",
					"  /login  →  Grok Build (CLI proxy)",
					"  /model grok-build/grok-4.5",
					"",
					"Route: cli-chat-proxy.grok.com /v1/responses",
					"Not:   xai-oauth / api.x.ai (SuperGrok API path)",
				].join("\n"),
				"info",
			);
		},
	});
}
