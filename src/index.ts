/**
 * omp-grok-build
 *
 * Grok Build provider for Oh My Pi.
 *
 * Product surface matches official Grok Build CLI proxy:
 *   https://cli-chat-proxy.grok.com/v1/responses
 *
 * Install:
 *   omp plugin install github:ART1KZ/omp-grok-build
 *
 * Use:
 *   /login  → Grok Build (CLI proxy)
 *   /model grok-build/grok-4.5
 *   /grok-build-usage
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
import { fetchGrokBillingUsage, formatGrokUsage } from "./usage";
import {
	loginGrokBuildOAuth,
	refreshGrokBuildOAuthToken,
	type OAuthCredentials,
} from "./xai-device-oauth";

function getApiKey(credentials: OAuthCredentials): string {
	return credentials.access;
}

async function resolveAccessToken(
	modelRegistry: {
		getApiKeyForProvider(provider: string, sessionId?: string): Promise<string | undefined>;
	},
): Promise<string | undefined> {
	const fromBuild = await modelRegistry.getApiKeyForProvider(PROVIDER_ID);
	if (fromBuild) return fromBuild;
	return modelRegistry.getApiKeyForProvider("xai-oauth");
}

export default function ompGrokBuildExtension(pi: ExtensionAPI): void {
	pi.setLabel("Grok Build (CLI proxy)");

	pi.registerProvider(PROVIDER_ID, {
		baseUrl: GROK_BUILD_BASE_URL,
		api: GROK_BUILD_API,
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
					"  /login             →  Grok Build (CLI proxy)",
					"  /logout            →  Grok Build",
					"  /model grok-build/grok-4.5",
					"  /grok-build-usage  →  Build/Imagine quota",
					"",
					"Auth is OAuth only (agent.db, provider id: grok-build).",
					"Route: cli-chat-proxy.grok.com /v1/responses",
					"Not:   xai-oauth / api.x.ai (SuperGrok API path)",
				].join("\n"),
				"info",
			);
		},
	});

	pi.registerCommand("grok-build-usage", {
		description: "Show Grok Build / subscription quota from CLI billing",
		handler: async (_args, ctx) => {
			try {
				const access = await resolveAccessToken(ctx.modelRegistry);
				if (!access) {
					ctx.ui.notify(
						"No Grok token found. Run /login → Grok Build (CLI proxy) first.",
						"error",
					);
					return;
				}
				const snapshot = await fetchGrokBillingUsage(access);
				ctx.ui.notify(formatGrokUsage(snapshot), "info");
			} catch (error) {
				ctx.ui.notify(
					`Usage fetch failed: ${error instanceof Error ? error.message : String(error)}`,
					"error",
				);
			}
		},
	});
}
