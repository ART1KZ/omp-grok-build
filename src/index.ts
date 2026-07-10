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
 * - CLI-style conversation ids: conv-<uuid> (stable per omp session)
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
import { toGrokBuildConvId } from "./conv-id";
import { STATIC_SEED } from "./models";
import {
	loginGrokBuildOAuth,
	refreshGrokBuildOAuthToken,
	type OAuthCredentials,
} from "./xai-device-oauth";

function getApiKey(credentials: OAuthCredentials): string {
	return credentials.access;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

/**
 * Rewrite Responses body cache identity into CLI-style conv-<uuid>.
 *
 * omp injects prompt_cache_key from sessionId. Official Grok CLI evidence uses
 * prefix+uuid ids (e.g. recap-<uuid>). We keep one stable id per omp session,
 * but reshape it to conv-<uuid> in case backend affinity prefers that form.
 */
function rewriteProviderPayload(payload: unknown, sessionId: string | undefined): unknown {
	if (!isRecord(payload)) return payload;

	const next: Record<string, unknown> = { ...payload };
	const source =
		(typeof next.prompt_cache_key === "string" && next.prompt_cache_key) ||
		sessionId ||
		undefined;
	const convId = toGrokBuildConvId(source);
	if (!convId) return payload;

	next.prompt_cache_key = convId;
	return next;
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

	// Reshape cache identity to CLI-like conv-<uuid> for Grok Build requests.
	pi.on("before_provider_request", async (event, ctx) => {
		const model = ctx.model;
		if (!model || model.provider !== PROVIDER_ID) {
			return event.payload;
		}
		const sessionManager = ctx.sessionManager;
		const sessionId =
			sessionManager && typeof sessionManager.getSessionId === "function"
				? sessionManager.getSessionId()
				: undefined;
		return rewriteProviderPayload(event.payload, sessionId);
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
					"Conv:  stable conv-<uuid> per omp session",
					"Not:   xai-oauth / api.x.ai (SuperGrok API path)",
				].join("\n"),
				"info",
			);
		},
	});
}
