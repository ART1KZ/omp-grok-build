/** Provider id used in selectors: grok-build/<model> */
export const PROVIDER_ID = "grok-build";

/** Official Grok Build CLI chat proxy. */
export const GROK_BUILD_BASE_URL = "https://cli-chat-proxy.grok.com/v1";

/**
 * Headers that make the proxy treat the request as Grok Build CLI traffic.
 * Without X-XAI-Token-Auth the bearer is rejected as a non-CLI token.
 * Without x-grok-model-override (per model) the proxy may not route correctly.
 */
export const GROK_BUILD_HEADERS = {
	"X-XAI-Token-Auth": "xai-grok-cli",
	"x-grok-client-version": "0.2.93",
	"x-grok-client-surface": "grok-build",
} as const;
