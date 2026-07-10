/**
 * omp-grok-build
 *
 * Grok Build provider for Oh My Pi.
 *
 * Registers provider `grok-build` against the official CLI proxy:
 *   https://cli-chat-proxy.grok.com/v1
 *
 * Compared with stock `xai-oauth` (api.x.ai / SuperGrok API path):
 * - native /login for Grok Build
 * - credentials stored under `grok-build`
 * - CLI headers and Build/CLI limits
 *
 * Model discovery is hybrid:
 * - no auth  → static seed
 * - with auth → GET /v1/models + curated overlays
 * omp caches the result (~24h); force with `omp models refresh`.
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
import { fetchGrokBuildModels } from "./models";
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
		// Hybrid catalog. Do not also pass `models` — omp treats that as exclusive.
		fetchDynamicModels: async apiKey => fetchGrokBuildModels(apiKey),
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
					"  omp models refresh",
					"",
					"Route: cli-chat-proxy.grok.com (Build/CLI limits)",
					"Not:   xai-oauth / api.x.ai (SuperGrok API path)",
				].join("\n"),
				"info",
			);
		},
	});
}
