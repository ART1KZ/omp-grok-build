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
 * ## Model discovery (hybrid)
 *
 * Extension API: `models` and `fetchDynamicModels` are mutually exclusive.
 * We use only `fetchDynamicModels`:
 *   - no auth  → static seed (always available offline)
 *   - with auth → GET /v1/models, merge with curated overlays + seed backfill
 *
 * omp caches the discovered list in models.db for ~24h (authoritative runtime
 * manager). Models are NOT frozen forever after first login — they refresh on
 * cache expiry / model refresh. Account tier can change which models appear.
 *
 * ## Install
 *
 * ```bash
 * omp plugin install github:ART1KZ/omp-grok-build
 * # or: omp plugin link ./omp-grok-build
 * ```
 *
 * Then: /login → Grok Build (CLI proxy) · /model grok-build/grok-4.5
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
		// Bearer from OAuth storage after /login. authHeader injects Authorization.
		authHeader: true,
		headers: { ...GROK_BUILD_HEADERS },
		// Hybrid: seed when logged out, live /v1/models when authenticated.
		// Do NOT also pass `models` — omp treats that as exclusive and would
		// skip fetchDynamicModels entirely.
		fetchDynamicModels: async apiKey => fetchGrokBuildModels(apiKey),
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
					"Grok Build extension loaded (hybrid catalog).",
					"",
					"Use:",
					"  /login  →  Grok Build (CLI proxy)",
					"  /model grok-build/grok-4.5",
					"",
					"Models:",
					"  - offline: static seed",
					"  - after login: live /v1/models + curated overlays",
					"  - omp caches ~24h, then refreshes (not forever frozen)",
					"",
					"NOT the same as built-in xai-oauth:",
					"  xai-oauth/*  → SuperGrok / api.x.ai quota",
					"  grok-build/* → cli-chat-proxy.grok.com Build/CLI surface",
				].join("\n"),
				"info",
			);
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		const model = ctx.model;
		if (!model) {
			ctx.ui.notify(
				"Grok Build extension ready. /login → Grok Build (CLI proxy), then /model grok-build/grok-4.5",
				"info",
			);
		}
	});
}
