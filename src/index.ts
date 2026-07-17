/**
 * omp-grok-build — Grok Build provider for Oh My Pi.
 *
 * Chat: cli-chat-proxy.grok.com (Build product path)
 * Usage: patches AuthStorage so stock `/usage` lists grok-build
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
	backfillGrokOAuthIdentity,
	installGrokUsageIntoAuthStorage,
	type AuthStorageLike,
} from "./usage";
import {
	loginGrokBuildOAuth,
	refreshGrokBuildOAuthToken,
	type OAuthCredentials,
} from "./xai-device-oauth";

function getApiKey(credentials: OAuthCredentials): string {
	return credentials.access;
}

function installUsageFromRegistry(modelRegistry: { authStorage?: unknown }): void {
	const authStorage = modelRegistry.authStorage;
	if (!authStorage || typeof authStorage !== "object") return;
	installGrokUsageIntoAuthStorage(authStorage);
	// Fire-and-forget identity backfill for existing oauth rows missing email/accountId.
	// Soft-fails inside; never blocks session_start.
	void backfillGrokOAuthIdentity(authStorage as AuthStorageLike);
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
				refreshGrokBuildOAuthToken(credentials.refresh, undefined, {
					email: credentials.email,
					accountId: credentials.accountId,
				}),
			getApiKey,
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		installUsageFromRegistry(ctx.modelRegistry);
	});

	pi.registerCommand("grok-build-help", {
		description: "Grok Build provider help",
		handler: async (_args, ctx) => {
			installUsageFromRegistry(ctx.modelRegistry);
			ctx.ui.notify(
				[
					"Grok Build provider",
					"",
					"  /login   → Grok Build (CLI proxy)",
					"  /logout  → Grok Build",
					"  /model grok-build/grok-4.5",
					"  /usage   → quota (Grok Build section)",
					"",
					"Chat:  cli-chat-proxy.grok.com (Build path)",
					"Not:   xai-oauth / api.x.ai SuperGrok API path",
				].join("\n"),
				"info",
			);
		},
	});
}
