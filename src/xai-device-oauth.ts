/**
 * xAI device-code OAuth for Grok Build CLI surface.
 *
 * Why this exists:
 * - Official Grok Build CLI (`grok`) authenticates via auth.x.ai with client_id
 *   b1a00492-073a-47ea-816f-4c329264a828 and scopes including grok-cli:access.
 * - Stock omp `xai-oauth` uses the same OAuth client family, but routes inference
 *   through SuperGrok / api.x.ai. For SuperGrok / SuperGrok Heavy users that often
 *   burns the shared weekly Grok quota like API usage.
 * - Real Grok Build path is different: cli-chat-proxy.grok.com + CLI headers,
 *   with higher CLI limits, so weekly SuperGrok quota can be preserved.
 * - We reimplement the same device-code grant so /login works inside omp without
 *   requiring the `grok` binary, and store credentials under provider id
 *   `grok-build` so they never mix with SuperGrok account pools.
 *
 * Adapted from oh-my-pi packages/ai xAI OAuth + hermes-agent (MIT).
 */

export interface OAuthCredentials {
	access: string;
	refresh: string;
	expires: number;
}

export interface OAuthAuthInfo {
	url: string;
	instructions?: string;
}

export interface OAuthLoginCallbacks {
	onAuth?: (info: OAuthAuthInfo) => void;
	onProgress?: (message: string) => void;
	/** Optional abort for cancelable login. */
	signal?: AbortSignal;
	/** Optional fetch override (tests). */
	fetch?: typeof fetch;
}

const XAI_OAUTH_ISSUER = "https://auth.x.ai";
const XAI_OAUTH_DISCOVERY_URL = `${XAI_OAUTH_ISSUER}/.well-known/openid-configuration`;
const XAI_OAUTH_DEVICE_CODE_URL = `${XAI_OAUTH_ISSUER}/oauth2/device/code`;
/** Same public client used by Grok Build CLI and omp xai-oauth. */
export const XAI_OAUTH_CLIENT_ID = "b1a00492-073a-47ea-816f-4c329264a828";
/**
 * grok-cli:access is what marks this as CLI/Build session token family.
 * conversations:* appears on current CLI tokens and is safe to request.
 */
export const XAI_OAUTH_SCOPE =
	"openid profile email offline_access grok-cli:access api:access conversations:read conversations:write";

const ACCESS_TOKEN_CLIENT_SKEW_MS = 5 * 60 * 1000;
const DISCOVERY_TIMEOUT_MS = 15_000;
const TOKEN_REQUEST_TIMEOUT_MS = 20_000;
const DEFAULT_POLL_INTERVAL_SECONDS = 5;
const DEFAULT_DEVICE_EXPIRES_SECONDS = 15 * 60;

interface XAIOAuthDiscovery {
	token_endpoint: string;
}

interface XAIDeviceAuthorization {
	deviceCode: string;
	userCode: string;
	verificationUriComplete: string;
	expiresInSeconds: number;
	intervalSeconds: number;
}

type DevicePollStatus =
	| { status: "pending" }
	| { status: "slow_down" }
	| { status: "complete"; value: OAuthCredentials };

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	if (signal?.aborted) {
		return Promise.reject(new Error("Login cancelled"));
	}
	const { promise, resolve, reject } = Promise.withResolvers<void>();
	const timer = setTimeout(() => {
		cleanup();
		resolve();
	}, ms);
	const onAbort = () => {
		cleanup();
		reject(new Error("Login cancelled"));
	};
	const cleanup = () => {
		clearTimeout(timer);
		signal?.removeEventListener("abort", onAbort);
	};
	signal?.addEventListener("abort", onAbort, { once: true });
	return promise;
}

/** Pin token endpoint to https + x.ai hosts only. */
export function validateXAIEndpoint(url: string, field: string): string {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		throw new Error(`Invalid xAI ${field}: ${url}`);
	}
	if (parsed.protocol !== "https:") {
		throw new Error(`Invalid xAI ${field}: ${url}`);
	}
	const host = parsed.hostname.toLowerCase();
	if (!host || (host !== "x.ai" && !host.endsWith(".x.ai"))) {
		throw new Error(`Invalid xAI ${field}: ${url}`);
	}
	return url;
}

function parseXAITokenResponse(
	payload: unknown,
	context: string,
	fallbackRefresh?: string,
): OAuthCredentials {
	if (!isRecord(payload)) {
		throw new Error(`${context} was not a JSON object`);
	}
	const access =
		typeof payload.access_token === "string" ? payload.access_token.trim() : "";
	if (!access) {
		throw new Error(`${context} missing access_token`);
	}
	const refreshRaw =
		typeof payload.refresh_token === "string" ? payload.refresh_token.trim() : "";
	const refresh = refreshRaw || (fallbackRefresh ?? "");
	if (!refresh) {
		throw new Error(`${context} missing refresh_token`);
	}

	const expiresIn =
		typeof payload.expires_in === "number" && Number.isFinite(payload.expires_in)
			? payload.expires_in
			: 3600;
	const expires = Date.now() + Math.max(0, expiresIn) * 1000 - ACCESS_TOKEN_CLIENT_SKEW_MS;
	return { access, refresh, expires };
}

async function xaiOAuthDiscovery(
	timeoutMs: number = DISCOVERY_TIMEOUT_MS,
	fetchImpl: typeof fetch = fetch,
): Promise<XAIOAuthDiscovery> {
	let response: Response;
	try {
		response = await fetchImpl(XAI_OAUTH_DISCOVERY_URL, {
			method: "GET",
			headers: { Accept: "application/json" },
			signal: AbortSignal.timeout(timeoutMs),
		});
	} catch (error) {
		throw new Error(
			`xAI OIDC discovery failed: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	if (response.status !== 200) {
		throw new Error(`xAI OIDC discovery returned status ${response.status}`);
	}
	const payload: unknown = await response.json();
	if (!isRecord(payload)) {
		throw new Error("xAI OIDC discovery response was not a JSON object");
	}
	const tokenEndpoint =
		typeof payload.token_endpoint === "string" ? payload.token_endpoint.trim() : "";
	if (!tokenEndpoint) {
		throw new Error("xAI OIDC discovery response was missing token_endpoint");
	}
	return { token_endpoint: validateXAIEndpoint(tokenEndpoint, "token_endpoint") };
}

async function requestXAIDeviceAuthorization(
	fetchImpl: typeof fetch,
	signal?: AbortSignal,
): Promise<XAIDeviceAuthorization> {
	let response: Response;
	try {
		const timeoutSignal = AbortSignal.timeout(TOKEN_REQUEST_TIMEOUT_MS);
		response = await fetchImpl(XAI_OAUTH_DEVICE_CODE_URL, {
			method: "POST",
			headers: {
				"Content-Type": "application/x-www-form-urlencoded",
				Accept: "application/json",
			},
			body: new URLSearchParams({
				client_id: XAI_OAUTH_CLIENT_ID,
				scope: XAI_OAUTH_SCOPE,
			}),
			signal: signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal,
		});
	} catch (error) {
		if (signal?.aborted) throw new Error("Login cancelled");
		throw new Error(
			`xAI device-code request failed: ${error instanceof Error ? error.message : String(error)}`,
		);
	}

	if (!response.ok) {
		let detail = "";
		try {
			detail = (await response.text()).trim();
		} catch {
			// status is enough
		}
		throw new Error(
			`xAI device-code request failed: ${response.status}${detail ? ` ${detail}` : ""}`,
		);
	}

	const payload: unknown = await response.json();
	if (!isRecord(payload)) {
		throw new Error("xAI device-code response was not a JSON object");
	}
	const deviceCode = typeof payload.device_code === "string" ? payload.device_code.trim() : "";
	const userCode = typeof payload.user_code === "string" ? payload.user_code.trim() : "";
	const verificationUriComplete =
		typeof payload.verification_uri_complete === "string"
			? payload.verification_uri_complete.trim()
			: typeof payload.verification_uri === "string"
				? payload.verification_uri.trim()
				: "";
	if (!deviceCode || !userCode || !verificationUriComplete) {
		throw new Error("xAI device-code response missing device_code/user_code/verification_uri");
	}
	const expiresInSeconds =
		typeof payload.expires_in === "number" && Number.isFinite(payload.expires_in)
			? payload.expires_in
			: DEFAULT_DEVICE_EXPIRES_SECONDS;
	const intervalSeconds =
		typeof payload.interval === "number" && Number.isFinite(payload.interval)
			? payload.interval
			: DEFAULT_POLL_INTERVAL_SECONDS;
	return {
		deviceCode,
		userCode,
		verificationUriComplete,
		expiresInSeconds,
		intervalSeconds,
	};
}

async function pollXAIDeviceToken(
	tokenEndpoint: string,
	deviceCode: string,
	fetchImpl: typeof fetch,
	signal?: AbortSignal,
): Promise<DevicePollStatus> {
	let response: Response;
	try {
		const timeoutSignal = AbortSignal.timeout(TOKEN_REQUEST_TIMEOUT_MS);
		response = await fetchImpl(tokenEndpoint, {
			method: "POST",
			headers: {
				"Content-Type": "application/x-www-form-urlencoded",
				Accept: "application/json",
			},
			body: new URLSearchParams({
				grant_type: "urn:ietf:params:oauth:grant-type:device_code",
				client_id: XAI_OAUTH_CLIENT_ID,
				device_code: deviceCode,
			}),
			signal: signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal,
		});
	} catch (error) {
		if (signal?.aborted) throw new Error("Login cancelled");
		throw new Error(
			`xAI device-code token polling failed: ${error instanceof Error ? error.message : String(error)}`,
		);
	}

	const payload: unknown = await response.json().catch(() => null);
	if (response.ok) {
		return {
			status: "complete",
			value: parseXAITokenResponse(payload, "xAI device-code token response"),
		};
	}
	if (!isRecord(payload)) {
		throw new Error(`xAI device-code token polling failed: ${response.status}`);
	}
	const errorCode = typeof payload.error === "string" ? payload.error : "";
	if (errorCode === "authorization_pending") return { status: "pending" };
	if (errorCode === "slow_down") return { status: "slow_down" };
	const errorDescription =
		typeof payload.error_description === "string" ? payload.error_description : "";
	const detail = errorDescription || errorCode || String(response.status);
	throw new Error(`xAI device-code token polling failed: ${detail}`);
}

/** Interactive RFC 8628 device authorization login. */
export async function loginGrokBuildOAuth(
	ctrl: OAuthLoginCallbacks,
): Promise<OAuthCredentials> {
	const fetchImpl = ctrl.fetch ?? fetch;
	const discovery = await xaiOAuthDiscovery(DISCOVERY_TIMEOUT_MS, fetchImpl);
	const device = await requestXAIDeviceAuthorization(fetchImpl, ctrl.signal);
	ctrl.onAuth?.({
		url: device.verificationUriComplete,
		instructions: `Enter code: ${device.userCode}`,
	});
	ctrl.onProgress?.("Waiting for xAI device authorization (Grok Build)...");

	const deadline = Date.now() + device.expiresInSeconds * 1000;
	let intervalMs = Math.max(1, device.intervalSeconds) * 1000;

	while (Date.now() < deadline) {
		if (ctrl.signal?.aborted) throw new Error("Login cancelled");
		const result = await pollXAIDeviceToken(
			discovery.token_endpoint,
			device.deviceCode,
			fetchImpl,
			ctrl.signal,
		);
		if (result.status === "complete") return result.value;
		if (result.status === "slow_down") {
			intervalMs += 1000;
		}
		await sleep(intervalMs, ctrl.signal);
	}
	throw new Error("xAI device authorization timed out");
}

/** Refresh access token from stored refresh_token. */
export async function refreshGrokBuildOAuthToken(
	refreshToken: string,
	fetchOverride?: typeof fetch,
): Promise<OAuthCredentials> {
	const fetchImpl = fetchOverride ?? fetch;
	if (typeof refreshToken !== "string" || !refreshToken.trim()) {
		throw new Error("missing refresh_token");
	}
	const discovery = await xaiOAuthDiscovery(DISCOVERY_TIMEOUT_MS, fetchImpl);
	const tokenEndpoint = validateXAIEndpoint(discovery.token_endpoint, "token_endpoint");
	const response = await fetchImpl(tokenEndpoint, {
		method: "POST",
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
			Accept: "application/json",
		},
		body: new URLSearchParams({
			grant_type: "refresh_token",
			client_id: XAI_OAUTH_CLIENT_ID,
			refresh_token: refreshToken,
		}),
		signal: AbortSignal.timeout(TOKEN_REQUEST_TIMEOUT_MS),
	});
	if (!response.ok) {
		let detail = "";
		try {
			detail = (await response.text()).trim();
		} catch {
			// status is enough
		}
		throw new Error(
			`xAI token refresh failed: ${response.status}${detail ? ` ${detail}` : ""}`,
		);
	}
	const payload: unknown = await response.json();
	return parseXAITokenResponse(payload, "xAI token refresh response", refreshToken);
}
