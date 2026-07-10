/**
 * Stream wrapper that injects official Grok Build CLI fingerprint headers.
 *
 * Uses built-in openai-responses transport under a private API id so we can
 * attach per-request x-grok-req-id / turn-idx without replacing the global
 * openai-responses handler.
 */

import type {
	Api,
	AssistantMessageEventStream,
	Context,
	Model,
	SimpleStreamOptions,
} from "@oh-my-pi/pi-ai";
import { streamOpenAIResponses } from "@oh-my-pi/pi-ai/providers/openai-responses";
import { GROK_BUILD_HEADERS } from "./constants";
import {
	buildGrokCliRequestHeaders,
	countUserTurns,
	newRequestId,
	nextTurnIndex,
	resolveConversationId,
} from "./identity";

export function streamGrokBuildCli(
	model: Model<Api>,
	context: Context,
	options?: SimpleStreamOptions,
): AssistantMessageEventStream {
	const conversationId = resolveConversationId(options?.sessionId ?? options?.promptCacheKey);
	const requestId = newRequestId();
	const userTurns = countUserTurns(context.messages);
	const turnIndex = nextTurnIndex(conversationId, userTurns);

	const cliHeaders = buildGrokCliRequestHeaders({
		conversationId,
		requestId,
		turnIndex,
		modelId: model.id,
		base: {
			...GROK_BUILD_HEADERS,
			...(model.headers ?? {}),
			...(options?.headers ?? {}),
		},
	});

	// Built-in Responses transport requires api:"openai-responses".
	const wireModel: Model<"openai-responses"> = {
		...(model as Model<"openai-responses">),
		api: "openai-responses",
		headers: cliHeaders,
		compat: {
			...(model.compat ?? {}),
			promptCacheSessionHeader: "x-grok-conv-id",
		},
	};

	return streamOpenAIResponses(wireModel, context, {
		...options,
		// Main chat: session id == conv id (official CLI HAR)
		sessionId: conversationId,
		promptCacheKey: conversationId,
		headers: cliHeaders,
	});
}
