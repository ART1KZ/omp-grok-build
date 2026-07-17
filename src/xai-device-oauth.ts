/**
 * xAI device-code OAuth for the Grok Build CLI surface.
 *
 * - issuer: auth.x.ai
 * - public CLI client id: b1a00492-073a-47ea-816f-4c329264a828
 * - scopes include grok-cli:access
 * - credentials are intended for provider id `grok-build`
 *   (cli-chat-proxy.grok.com), not stock SuperGrok api.x.ai routing
 *
 * Adapted from oh-my-pi packages/ai xAI OAuth + hermes-agent (MIT).
 */

export interface OAuthCredentials {
	access: string;
	refresh: string;
	expires: number;
	accountId?: string;
	email?: string;
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
const XAI_OAUTH_USERINFO_URL = `${XAI_OAUTH_ISSUER}/oauth2/userinfo`;
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
const USERINFO_TIMEOUT_MS = 10_000;
const DEFAULT_POLL_INTERVAL_SECONDS = 5;
const DEFAULT_DEVICE_EXPIRES_SECONDS = 15 * 60;

interface XAIOAuthDiscovery {
	token_endpoint: string;
	userinfo_endpoint?: string;
}

interface XAIDeviceAuthorization {
	deviceCode: string;
	userCode: string;
	verificationUriComplete: string;
	expiresInSeconds: number;
	intervalSeconds: number;
}

interface ParsedTokenResponse {
	credentials: OAuthCredentials;
	idToken?: string;
}

type DevicePollStatus =
	| { status: "pending" }
	| { status: "slow_down" }
	| { status: "complete"; value: ParsedTokenResponse };

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

/** Decode JWT middle segment without signature verification. */
export function decodeJwtPayload(token: string): Record<string, unknown> | undefined {
	if (typeof token !== "string") return undefined;
	const parts = token.split(".");
	if (parts.length < 2) return undefined;
	const segment = parts[1]?.trim();
	if (!segment) return undefined;
	try {
		const padded = segment.replace(/-/g, "+").replace(/_/g, "/");
		const padLen = (4 - (padded.length % 4)) % 4;
		const b64 = padded + "=".repeat(padLen);
		const json =
			typeof atob === "function"
				? atob(b64)
				: Buffer.from(b64, "base64").toString("utf8");
		const payload: unknown = JSON.parse(json);
		return isRecord(payload) ? payload : undefined;
	} catch {
		return undefined;
	}
}

/** Prefer principal_id, then sub, when non-empty strings. */
export function resolveAccountIdFromAccess(access: string): string | undefined {
	const payload = decodeJwtPayload(access);
	if (!payload) return undefined;
	const principal =
		typeof payload.principal_id === "string" ? payload.principal_id.trim() : "";
	if (principal) return principal;
	const sub = typeof payload.sub === "string" ? payload.sub.trim() : "";
	return sub || undefined;
}

/** Soft-fail userinfo lookup for email claim. */
export async function fetchXAIUserEmail(
	access: string,
	fetchImpl: typeof fetch = fetch,
	signal?: AbortSignal,
	userinfoEndpoint: string = XAI_OAUTH_USERINFO_URL,
): Promise<string | undefined> {
	if (typeof access !== "string" || !access.trim()) return undefined;
	let endpoint: string;
	try {
		endpoint = validateXAIEndpoint(userinfoEndpoint, "userinfo_endpoint");
	} catch {
		return undefined;
	}
	try {
		const timeoutSignal = AbortSignal.timeout(USERINFO_TIMEOUT_MS);
		const response = await fetchImpl(endpoint, {
			method: "GET",
			headers: {
				Authorization: `Bearer ${access.trim()}`,
				Accept: "application/json",
			},
			signal: signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal,
		});
		if (response.status !== 200) return undefined;
		const payload: unknown = await response.json().catch(() => null);
		if (!isRecord(payload)) return undefined;
		const email = typeof payload.email === "string" ? payload.email.trim() : "";
		return email || undefined;
	} catch {
		return undefined;
	}
}

export async function enrichOAuthIdentity(
	creds: OAuthCredentials,
	opts: {
		fetchImpl?: typeof fetch;
		signal?: AbortSignal;
		idToken?: string;
		previous?: Pick<OAuthCredentials, "email" | "accountId">;
		userinfoEndpoint?: string;
	} = {},
): Promise<OAuthCredentials> {
	const accountId =
		resolveAccountIdFromAccess(creds.access) ?? opts.previous?.accountId;

	let email: string | undefined;
	if (opts.idToken) {
		const idPayload = decodeJwtPayload(opts.idToken);
		const idEmail =
			idPayload && typeof idPayload.email === "string" ? idPayload.email.trim() : "";
		email = idEmail || undefined;
	}
	if (!email) {
		email = await fetchXAIUserEmail(
			creds.access,
			opts.fetchImpl ?? fetch,
			opts.signal,
			opts.userinfoEndpoint ?? XAI_OAUTH_USERINFO_URL,
		);
	}
	if (!email) {
		email = opts.previous?.email;
	}

	return {
		...creds,
		...(accountId ? { accountId } : {}),
		...(email ? { email } : {}),
	};
}

function parseXAITokenResponse(
	payload: unknown,
	context: string,
	fallbackRefresh?: string,
): ParsedTokenResponse {
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
	const idToken =
		typeof payload.id_token === "string" && payload.id_token.trim()
			? payload.id_token.trim()
			: undefined;
	return {
		credentials: { access, refresh, expires },
		...(idToken ? { idToken } : {}),
	};
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
	const userinfoRaw =
		typeof payload.userinfo_endpoint === "string" ? payload.userinfo_endpoint.trim() : "";
	let userinfo_endpoint: string | undefined;
	if (userinfoRaw) {
		try {
			userinfo_endpoint = validateXAIEndpoint(userinfoRaw, "userinfo_endpoint");
		} catch {
			// ignore invalid discovery userinfo; fall back later
		}
	}
	return {
		token_endpoint: validateXAIEndpoint(tokenEndpoint, "token_endpoint"),
		...(userinfo_endpoint ? { userinfo_endpoint } : {}),
	};
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
		if (result.status === "complete") {
			return enrichOAuthIdentity(result.value.credentials, {
				fetchImpl,
				signal: ctrl.signal,
				idToken: result.value.idToken,
				userinfoEndpoint: discovery.userinfo_endpoint,
			});
		}
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
	previous?: Pick<OAuthCredentials, "email" | "accountId">,
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
	const parsed = parseXAITokenResponse(payload, "xAI token refresh response", refreshToken);
	return enrichOAuthIdentity(parsed.credentials, {
		fetchImpl,
		idToken: parsed.idToken,
		previous,
		userinfoEndpoint: discovery.userinfo_endpoint,
	});
}
