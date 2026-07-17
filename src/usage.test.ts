import { describe, expect, test } from "bun:test";
import {
	backfillGrokOAuthIdentity,
	installGrokUsageIntoAuthStorage,
	type AuthStorageLike,
	type StoredCredentialLike,
} from "./usage";

function b64urlJson(value: unknown): string {
	return Buffer.from(JSON.stringify(value), "utf8")
		.toString("base64")
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/g, "");
}

function fakeJwt(payload: Record<string, unknown>): string {
	const header = b64urlJson({ alg: "none", typ: "JWT" });
	const body = b64urlJson(payload);
	return `${header}.${body}.sig`;
}

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

function currentBillingResponse(): Response {
	return new Response(
		JSON.stringify({
			config: {
				billingPeriodStart: "2026-07-01T00:00:00.000Z",
				billingPeriodEnd: "2026-07-31T00:00:00.000Z",
				currentPeriod: {
					start: "2026-07-01T00:00:00.000Z",
					end: "2026-07-31T00:00:00.000Z",
					type: "USAGE_PERIOD_TYPE_MONTHLY",
				},
				onDemandCap: { val: 0 },
				onDemandUsed: { val: 0 },
				prepaidBalance: { val: 25 },
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

	test("reports a prepaid balance when billing omits subscription percentages", async () => {
		const storage = storageWith([
			{
				id: 1,
				provider: "grok-build",
				credential: {
					type: "oauth",
					access: "test-token-current-schema",
					expires: Date.now() + 60_000,
				},
			},
		]);

		installGrokUsageIntoAuthStorage(storage, {
			fetch: async () => currentBillingResponse(),
		});
		const reports = await storage.fetchUsageReports?.();
		const report = reports?.[0];

		expect(reports).toHaveLength(1);
		expect(report?.limits).toEqual([
			expect.objectContaining({
				label: "Prepaid balance",
				amount: { remaining: 25, unit: "usd" },
			}),
		]);
	});
});

describe("backfillGrokOAuthIdentity", () => {
	test("fills missing email via set() when enrich succeeds", async () => {
		const access = fakeJwt({ principal_id: "acc-backfill-1" });
		const stored: StoredCredentialLike[] = [
			{
				id: 10,
				provider: "grok-build",
				credential: {
					type: "oauth",
					access,
					refresh: "refresh-backfill",
					expires: Date.now() + 120_000,
				},
			},
		];

		const setCalls: Array<{ provider: string; credentials: unknown }> = [];
		const storage: AuthStorageLike = {
			listStoredCredentials: provider =>
				provider === "grok-build" ? stored.map(row => ({ ...row, credential: { ...row.credential } })) : [],
			set: async (provider, credential) => {
				setCalls.push({ provider, credentials: credential });
				const list = Array.isArray(credential) ? credential : [credential];
				stored.splice(
					0,
					stored.length,
					...list.map((c, i) => ({
						id: stored[i]?.id ?? i + 1,
						provider,
						credential: c as StoredCredentialLike["credential"],
					})),
				);
			},
			upsertCredential: () => {
				throw new Error("upsert should not be used when set is available");
			},
		};

		const fetchMock: typeof fetch = async () =>
			new Response(JSON.stringify({ email: "backfill@x.ai" }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});

		await backfillGrokOAuthIdentity(storage, { fetch: fetchMock });

		expect(setCalls).toHaveLength(1);
		expect(setCalls[0]?.provider).toBe("grok-build");
		const written = setCalls[0]?.credentials;
		expect(Array.isArray(written)).toBe(true);
		const first = (written as Array<StoredCredentialLike["credential"]>)[0];
		expect(first?.type).toBe("oauth");
		expect(first?.email).toBe("backfill@x.ai");
		expect(first?.accountId).toBe("acc-backfill-1");
		expect(first?.access).toBe(access);
		expect(first?.refresh).toBe("refresh-backfill");

		// WeakSet: second call is a no-op
		await backfillGrokOAuthIdentity(storage, { fetch: fetchMock });
		expect(setCalls).toHaveLength(1);
	});

	test("upserts partial-identity rows when only upsertCredential exists", async () => {
		const access = fakeJwt({ principal_id: "acc-partial" });
		const upserted: Array<StoredCredentialLike["credential"]> = [];
		const storage: AuthStorageLike = {
			listStoredCredentials: () => [
				{
					id: 3,
					provider: "grok-build",
					credential: {
						type: "oauth",
						access,
						refresh: "rt",
						expires: Date.now() + 60_000,
						accountId: "acc-partial",
						// email missing — partial identity already has identity_key
					},
				},
			],
			upsertCredential: (_provider, credential) => {
				upserted.push(credential);
				return [];
			},
		};

		const fetchMock: typeof fetch = async () =>
			new Response(JSON.stringify({ email: "partial@x.ai" }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});

		await backfillGrokOAuthIdentity(storage, { fetch: fetchMock });
		expect(upserted).toHaveLength(1);
		expect(upserted[0]?.email).toBe("partial@x.ai");
		expect(upserted[0]?.accountId).toBe("acc-partial");
		expect(upserted[0]?.type).toBe("oauth");
	});

	test("skips identity-less rows when only upsertCredential is available", async () => {
		const access = fakeJwt({ principal_id: "acc-skip" });
		const upserted: unknown[] = [];
		const storage: AuthStorageLike = {
			listStoredCredentials: () => [
				{
					id: 4,
					provider: "grok-build",
					credential: {
						type: "oauth",
						access,
						refresh: "rt",
						expires: Date.now() + 60_000,
					},
				},
			],
			upsertCredential: (_provider, credential) => {
				upserted.push(credential);
				return [];
			},
		};

		const fetchMock: typeof fetch = async () =>
			new Response(JSON.stringify({ email: "skip@x.ai" }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});

		await backfillGrokOAuthIdentity(storage, { fetch: fetchMock });
		// Without set(), pure identity-less rows cannot be matched safely.
		expect(upserted).toHaveLength(0);
	});

	test("soft-fails and never throws when enrich/network fails", async () => {
		const storage: AuthStorageLike = {
			listStoredCredentials: () => [
				{
					id: 5,
					provider: "grok-build",
					credential: {
						type: "oauth",
						access: fakeJwt({ sub: "x" }),
						refresh: "rt",
						expires: Date.now() + 60_000,
					},
				},
			],
			set: async () => {
				throw new Error("set blew up");
			},
		};

		const fetchMock: typeof fetch = async () => {
			throw new Error("network down");
		};

		await expect(backfillGrokOAuthIdentity(storage, { fetch: fetchMock })).resolves.toBeUndefined();
	});
});
