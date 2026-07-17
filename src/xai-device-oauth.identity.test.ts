import { describe, expect, test } from "bun:test";
import {
	decodeJwtPayload,
	enrichOAuthIdentity,
	refreshGrokBuildOAuthToken,
	resolveAccountIdFromAccess,
	type OAuthCredentials,
} from "./xai-device-oauth";

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

describe("decodeJwtPayload / resolveAccountIdFromAccess", () => {
	test("decodes hand-built JWT payload", () => {
		const token = fakeJwt({ sub: "user-1", principal_id: "prin-9", email: "skip@x.ai" });
		const payload = decodeJwtPayload(token);
		expect(payload?.sub).toBe("user-1");
		expect(payload?.principal_id).toBe("prin-9");
	});

	test("prefers principal_id over sub", () => {
		const token = fakeJwt({ sub: "user-1", principal_id: "prin-9" });
		expect(resolveAccountIdFromAccess(token)).toBe("prin-9");
	});

	test("falls back to sub when principal_id missing", () => {
		const token = fakeJwt({ sub: "user-42" });
		expect(resolveAccountIdFromAccess(token)).toBe("user-42");
	});

	test("returns undefined for garbage tokens", () => {
		expect(decodeJwtPayload("not-a-jwt")).toBeUndefined();
		expect(resolveAccountIdFromAccess("a.b")).toBeUndefined();
	});
});

describe("enrichOAuthIdentity", () => {
	const base: OAuthCredentials = {
		access: fakeJwt({ principal_id: "acc-from-jwt" }),
		refresh: "refresh-token",
		expires: Date.now() + 60_000,
	};

	test("uses userinfo email and JWT accountId", async () => {
		const fetchMock: typeof fetch = async () =>
			new Response(JSON.stringify({ email: "a@x.ai" }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});

		const enriched = await enrichOAuthIdentity(base, { fetchImpl: fetchMock });
		expect(enriched.accountId).toBe("acc-from-jwt");
		expect(enriched.email).toBe("a@x.ai");
		expect(enriched.access).toBe(base.access);
		expect(enriched.refresh).toBe(base.refresh);
	});

	test("soft-fails userinfo 403 and keeps previous email", async () => {
		const fetchMock: typeof fetch = async () =>
			new Response("forbidden", { status: 403 });

		const enriched = await enrichOAuthIdentity(base, {
			fetchImpl: fetchMock,
			previous: { email: "kept@x.ai", accountId: "old-acc" },
		});
		expect(enriched.email).toBe("kept@x.ai");
		expect(enriched.accountId).toBe("acc-from-jwt");
	});

	test("prefers id_token email over userinfo", async () => {
		let userinfoCalled = false;
		const fetchMock: typeof fetch = async () => {
			userinfoCalled = true;
			return new Response(JSON.stringify({ email: "userinfo@x.ai" }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		};
		const idToken = fakeJwt({ email: "id@x.ai" });
		const enriched = await enrichOAuthIdentity(base, {
			fetchImpl: fetchMock,
			idToken,
		});
		expect(enriched.email).toBe("id@x.ai");
		expect(userinfoCalled).toBe(false);
	});
});

describe("refreshGrokBuildOAuthToken identity path", () => {
	test("parses token response and enriches from discovery userinfo", async () => {
		const access = fakeJwt({ sub: "refresh-sub", principal_id: "refresh-prin" });
		const fetchMock: typeof fetch = async (input, init) => {
			const url = String(input);
			if (url.includes("openid-configuration")) {
				return new Response(
					JSON.stringify({
						token_endpoint: "https://auth.x.ai/oauth2/token",
						userinfo_endpoint: "https://auth.x.ai/oauth2/userinfo",
					}),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				);
			}
			if (url.includes("/oauth2/token") && init?.method === "POST") {
				return new Response(
					JSON.stringify({
						access_token: access,
						refresh_token: "new-refresh",
						expires_in: 3600,
						id_token: fakeJwt({ email: "from-id@x.ai" }),
					}),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				);
			}
			if (url.includes("/oauth2/userinfo")) {
				return new Response(JSON.stringify({ email: "from-userinfo@x.ai" }), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				});
			}
			return new Response("not found", { status: 404 });
		};

		const result = await refreshGrokBuildOAuthToken("old-refresh", fetchMock, {
			email: "previous@x.ai",
			accountId: "previous-acc",
		});
		expect(result.access).toBe(access);
		expect(result.refresh).toBe("new-refresh");
		expect(result.accountId).toBe("refresh-prin");
		expect(result.email).toBe("from-id@x.ai");
	});

	test("preserves previous email when userinfo unavailable", async () => {
		const access = fakeJwt({ sub: "only-sub" });
		const fetchMock: typeof fetch = async (input, init) => {
			const url = String(input);
			if (url.includes("openid-configuration")) {
				return new Response(
					JSON.stringify({
						token_endpoint: "https://auth.x.ai/oauth2/token",
					}),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				);
			}
			if (url.includes("/oauth2/token") && init?.method === "POST") {
				return new Response(
					JSON.stringify({
						access_token: access,
						refresh_token: "refreshed",
						expires_in: 1800,
					}),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				);
			}
			if (url.includes("/oauth2/userinfo")) {
				return new Response("nope", { status: 403 });
			}
			return new Response("not found", { status: 404 });
		};

		const result = await refreshGrokBuildOAuthToken("rt", fetchMock, {
			email: "kept@x.ai",
			accountId: "old",
		});
		expect(result.email).toBe("kept@x.ai");
		expect(result.accountId).toBe("only-sub");
		expect(result.refresh).toBe("refreshed");
	});
});
