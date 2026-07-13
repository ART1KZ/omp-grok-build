import { describe, expect, test } from "bun:test";
import {
	installGrokUsageIntoAuthStorage,
	type AuthStorageLike,
	type StoredCredentialLike,
} from "./usage";

function billingResponse(creditUsagePercent: number): Response {
	return new Response(
		JSON.stringify({
			config: {
				creditUsagePercent,
				currentPeriod: {
					start: "2026-07-01T00:00:00.000Z",
					end: "2026-07-08T00:00:00.000Z",
					type: "USAGE_PERIOD_TYPE_WEEKLY",
					},
				productUsage: [{ product: "GrokBuild", usagePercent: creditUsagePercent }],
			},
		}),
		{ status: 200, headers: { "Content-Type": "application/json" } },
	);
}

function storageWith(credentials: StoredCredentialLike[]): AuthStorageLike {
	return {
		fetchUsageReports: async () => [],
		listStoredCredentials: provider =>
			provider === "grok-build" ? credentials : [],
	};
}

describe("Grok Build usage integration", () => {
	test("returns one distinct quota report for every stored OAuth account", async () => {
		const credentials: StoredCredentialLike[] = [
			{
				id: 1,
				provider: "grok-build",
				credential: {
					type: "oauth",
					access: "test-token-alpha",
					expires: Date.now() + 60_000,
					email: "alpha@example.test",
				},
			},
			{
				id: 2,
				provider: "grok-build",
				credential: {
					type: "oauth",
					access: "test-token-beta",
					expires: Date.now() + 60_000,
					email: "beta@example.test",
				},
			},
		];
		const storage = storageWith(credentials);
		const requestedTokens: string[] = [];
		const fetchMock: typeof fetch = async (_input, init) => {
			const token = new Headers(init?.headers).get("Authorization");
			requestedTokens.push(token ?? "");
			return billingResponse(token === "Bearer test-token-alpha" ? 12 : 68);
		};

		installGrokUsageIntoAuthStorage(storage, { fetch: fetchMock });
		const reports = await storage.fetchUsageReports?.();

		expect(reports).toHaveLength(2);
		expect(reports?.map(report => report.metadata?.email)).toEqual([
			"alpha@example.test",
			"beta@example.test",
		]);
		expect(reports?.map(report => report.limits[0]?.amount.used)).toEqual([12, 68]);
		expect(requestedTokens).toEqual(["Bearer test-token-alpha", "Bearer test-token-beta"]);
	});

	test("keeps the existing single-account behavior", async () => {
		const storage = storageWith([
			{
				id: 1,
				provider: "grok-build",
				credential: {
					type: "oauth",
					access: "test-token-only",
					expires: Date.now() + 60_000,
					email: "only@example.test",
				},
			},
		]);
		const fetchMock: typeof fetch = async () => billingResponse(37);

		installGrokUsageIntoAuthStorage(storage, { fetch: fetchMock });
		const reports = await storage.fetchUsageReports?.();

		expect(reports).toHaveLength(1);
		expect(reports?.[0]?.metadata?.email).toBe("only@example.test");
		expect(reports?.[0]?.limits[0]?.amount.used).toBe(37);
	});
});
