/**
 * omp-grok-build
 *
 * Grok Build provider for Oh My Pi.
 *
 * Product surface matches official Grok Build CLI proxy:
 *   https://cli-chat-proxy.grok.com/v1/responses
 *
 * Fingerprint (from official grok-pager HAR / community reverse-engineering):
 * - X-XAI-Token-Auth: xai-grok-cli
 * - x-grok-client-identifier: grok-pager
 * - x-grok-client-version
 * - x-authenticateresponse
 * - x-grok-session-id + x-grok-conv-id (same id on main chat turns)
 * - x-grok-req-id (new uuid every request)
 * - x-grok-turn-idx (monotonic per conversation)
 * - x-grok-model-override
 *
 * Existing solutions in the wild: decolua/9router, IgorWarzocha/pi-grok-build,
 * Cherry Studio grokCli, justlovemaki/AIClient2API, Yeachan-Heo/gajae-code.
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
	GROK_BUILD_API,
	GROK_BUILD_BASE_URL,
	GROK_BUILD_HEADERS,
	PROVIDER_ID,
} from "./constants";
import { STATIC_SEED } from "./models";
import { streamGrokBuildCli } from "./stream";
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
		api: GROK_BUILD_API,
		// Custom stream injects per-request CLI fingerprint headers.
		streamSimple: streamGrokBuildCli,
		authHeader: true,
		headers: { ...GROK_BUILD_HEADERS },
		models: STATIC_SEED.map(model => ({
			id: model.id,
			name: model.name,
			api: GROK_BUILD_API,
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
					"  /login   →  Grok Build (CLI proxy)",
					"  /logout  →  Grok Build",
					"  /model grok-build/grok-4.5",
					"",
					"Auth is OAuth only (agent.db, provider id: grok-build).",
					"Do NOT put providers.grok-build.apiKey in models.yml —",
					"config apiKey beats OAuth and survives /logout.",
					"",
					"Route: cli-chat-proxy.grok.com /v1/responses",
					"IDs:   session=conv (stable), req=new each call, turn-idx",
					"Not:   xai-oauth / api.x.ai (SuperGrok API path)",
					"",
					"Note: ~/.grok/auth.json is official Grok CLI login.",
					"/logout does not delete that file (separate client).",
				].join("\n"),
				"info",
			);
		},
	});
}
