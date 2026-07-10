/**
 * Grok-Build-style conversation ids for omp.
 *
 * Official CLI evidence (local sessions) shows ids like:
 *   recap-<uuid>   // side jobs (title/recap)
 * and per-request:
 *   xai-recap-<uuid>
 *
 * Main-chat conv ids are not fully exposed in plain logs, but the stable
 * pattern is: prefix + UUID, not a raw path/session string.
 *
 * We map one omp sessionId -> one stable conv-<uuid>, so:
 * - format looks like official Grok ids
 * - same omp conversation always gets the same id
 * - no backend dependency on omp's internal session string shape
 */

import { createHash } from "node:crypto";

const UUID_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Convert 16 bytes to UUID string. */
function bytesToUuid(bytes: Uint8Array): string {
	const hex = Buffer.from(bytes).toString("hex");
	return [
		hex.slice(0, 8),
		hex.slice(8, 12),
		hex.slice(12, 16),
		hex.slice(16, 20),
		hex.slice(20, 32),
	].join("-");
}

/**
 * Stable UUIDv5-ish id from an arbitrary session string.
 * Not network UUID registry based — local deterministic hash in UUID layout.
 */
export function stableUuidFromString(input: string): string {
	const hash = createHash("sha1").update("omp-grok-build-conv-v1:").update(input).digest();
	const bytes = Uint8Array.from(hash.subarray(0, 16));
	// RFC-ish version/variant bits so it looks like a real UUID.
	bytes[6] = (bytes[6] & 0x0f) | 0x50; // version 5
	bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10
	return bytesToUuid(bytes);
}

/**
 * Build a Grok-Build-like conversation id for an omp session.
 *
 * Examples:
 *   toGrokBuildConvId("019f4c25-...") -> "conv-7b2e...."
 *   toGrokBuildConvId("conv-...")     -> unchanged if already well-formed
 */
export function toGrokBuildConvId(sessionId: string | undefined | null): string | undefined {
	if (!sessionId) return undefined;
	const raw = String(sessionId).trim();
	if (!raw) return undefined;

	// Already in official-ish form.
	if (/^(conv|recap)-[0-9a-f-]{36}$/i.test(raw)) return raw.toLowerCase();
	if (UUID_RE.test(raw)) return `conv-${raw.toLowerCase()}`;

	// omp session ids / paths / random strings -> stable UUID, then prefix.
	return `conv-${stableUuidFromString(raw)}`;
}
