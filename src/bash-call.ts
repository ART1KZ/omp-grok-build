/**
 * Grok fills omp bash's service fields (`name`, `ready`, `async`) on ordinary
 * commands. omp then validates `ready.port` or rejects `timeout` in service
 * mode before the command runs. Drop those fields and keep the one-shot call.
 */

export function rewriteGrokBashInput(
	input: Record<string, unknown>,
): Record<string, unknown> | undefined {
	const named = typeof input.name === "string" && input.name.trim().length > 0;
	const hasReady = input.ready !== undefined && input.ready !== null;
	const hasAsync = input.async === true;
	if (!named && !hasReady && !hasAsync) return undefined;

	const next = { ...input };
	delete next.name;
	delete next.ready;
	delete next.async;
	return next;
}
