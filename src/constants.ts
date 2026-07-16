/** Provider id used in selectors: grok-build/<model> */
export const PROVIDER_ID = "grok-build";

/**
 * Custom stream API id for this extension.
 * Built-in "openai-responses" is reserved; we wrap it under a private API name
 * so we can inject official CLI fingerprint headers per request.
 */
export const GROK_BUILD_API = "grok-build-cli";

/** Official Grok Build CLI chat proxy. */
export const GROK_BUILD_BASE_URL = "https://cli-chat-proxy.grok.com/v1";

/** Pin near current official grok CLI (9router HAR / local install 0.2.101). */
export const GROK_CLI_VERSION = "0.2.101";

/**
 * Static fingerprint headers from official grok-shell traffic
 * to cli-chat-proxy.grok.com (see decolua/9router grok-cli registry).
 *
 * Per-request ids (session/conv/req/turn) are added in stream.ts.
 */
export const GROK_BUILD_HEADERS = {
	"User-Agent": `grok-shell/${GROK_CLI_VERSION}`,
	"X-XAI-Token-Auth": "xai-grok-cli",
	"x-grok-client-identifier": "grok-shell",
	"x-grok-client-version": GROK_CLI_VERSION,
	"x-authenticateresponse": "authenticate-response",
} as const;
