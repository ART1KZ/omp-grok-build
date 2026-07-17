/**
 * Grok Build subscription usage for stock omp `/usage` + `omp usage` (when
 * authStorage is patched from this extension).
 *
 * Source: GET https://cli-chat-proxy.grok.com/v1/billing?format=credits
 * Shape matches @oh-my-pi/pi-ai UsageReport so the TUI/CLI renderers work as-is.
 */

import { GROK_BUILD_HEADERS } from "./constants";
import { enrichOAuthIdentity } from "./xai-device-oauth";

const BILLING_URL = "https://cli-chat-proxy.grok.com/v1/billing?format=credits";
const PROVIDER_ID = "grok-build";
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const INSTALLED = new WeakSet<object>();
/** One identity-backfill attempt per AuthStorage instance (session_start). */
const IDENTITY_BACKFILL_ATTEMPTED = new WeakSet<object>();

export interface GrokProductUsage {
	product: string;
	usagePercent: number;
}

export interface GrokBillingConfig {
	periodStart: string;
	periodEnd: string;
	periodType: string;
	creditUsagePercent?: number;
	products: GrokProductUsage[];
	onDemandCap?: number;
	onDemandUsed?: number;
	prepaidBalance?: number;
}

/** Minimal UsageReport-compatible shape (mirrors pi-ai). */
export interface UsageReportLike {
	provider: string;
	fetchedAt: number;
	limits: UsageLimitLike[];
	notes?: string[];
	metadata?: Record<string, unknown>;
	raw?: unknown;
}

export interface UsageLimitLike {
	id: string;
	label: string;
	scope: {
		provider: string;
		accountId?: string;
		windowId?: string;
		shared?: boolean;
	};
	window?: {
		id: string;
		label: string;
		durationMs?: number;
		resetsAt?: number;
	};
	amount: {
		used?: number;
		limit?: number;
		remaining?: number;
		usedFraction?: number;
		remainingFraction?: number;
		unit: string;
	};
	status?: "ok" | "warning" | "exhausted";
}

export interface AuthStorageLike {
	fetchUsageReports?: (options?: {
		baseUrlResolver?: (provider: string) => string | undefined;
		signal?: AbortSignal;
	}) => Promise<UsageReportLike[] | null>;
	usageProviderFor?: (provider: string) => unknown;
	listStoredCredentials?: (provider?: string) => StoredCredentialLike[];
	/** Public AuthStorage.upsertCredential — identity-key match (safe when email/accountId already present). */
	upsertCredential?: (provider: string, credential: StoredCredentialLike["credential"] & { type: "oauth" }) => unknown;
	/** Public AuthStorage.set — replaces all credentials for the provider (must pass every row). */
	set?: (
		provider: string,
		credential:
			| (StoredCredentialLike["credential"] & { type?: string })
			| Array<StoredCredentialLike["credential"] & { type?: string }>,
	) => void | Promise<void>;
	getAll?: () => Record<string, unknown>;
}

export interface StoredCredentialLike {
	id?: number;
	provider: string;
	credential: {
		type?: string;
		access?: string;
		accessToken?: string;
		refresh?: string;
		expires?: number;
		expiresAt?: number;
		accountId?: string;
		email?: string;
	};
}

export interface InstallUsageOptions {
	fetch?: typeof fetch;
	/** Extra providers to backfill if core has no UsageProvider yet (e.g. xai-oauth). */
	providers?: string[];
}

export interface IdentityBackfillOptions {
	fetch?: typeof fetch;
	provider?: string;
	nowMs?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function toFiniteNumber(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string" && value.trim()) {
		const n = Number(value);
		if (Number.isFinite(n)) return n;
	}
	return undefined;
}

function parseIsoMs(value: string | undefined): number | undefined {
	if (!value) return undefined;
	const ms = Date.parse(value);
	return Number.isFinite(ms) ? ms : undefined;
}

function parseMoneyVal(value: unknown): number | undefined {
	if (!isRecord(value)) return undefined;
	const amount = toFiniteNumber(value.val);
	return amount !== undefined && amount >= 0 ? amount : undefined;
}

const PRODUCT_LABELS: Record<string, string> = {
	GrokBuild: "Grok Build",
	GrokImagine: "Grok Imagine",
	Api: "API",
};

export function parseGrokBillingConfig(payload: unknown, nowMs: number = Date.now()): GrokBillingConfig | undefined {
	if (!isRecord(payload)) return undefined;
	const config = isRecord(payload.config) ? payload.config : payload;
	if (!isRecord(config)) return undefined;

	const period = isRecord(config.currentPeriod) ? config.currentPeriod : undefined;
	const periodStart =
		(typeof config.billingPeriodStart === "string" && config.billingPeriodStart) ||
		(typeof period?.start === "string" ? period.start : "");
	const periodEnd =
		(typeof config.billingPeriodEnd === "string" && config.billingPeriodEnd) ||
		(typeof period?.end === "string" ? period.end : "");
	const periodType = typeof period?.type === "string" ? period.type : "USAGE_PERIOD_TYPE_WEEKLY";

	const creditUsagePercent = toFiniteNumber(config.creditUsagePercent);
	if (creditUsagePercent !== undefined && creditUsagePercent < 0) return undefined;

	const endMs = parseIsoMs(periodEnd);
	// Soft validation: prefer weekly windows that still look live; still accept if end missing.
	if (endMs !== undefined && endMs + WEEK_MS < nowMs) {
		// very stale — still show, but ok
	}

	const products: GrokProductUsage[] = [];
	if (Array.isArray(config.productUsage)) {
		for (const item of config.productUsage) {
			if (!isRecord(item)) continue;
			const product = typeof item.product === "string" ? item.product.trim() : "";
			const usagePercent = toFiniteNumber(item.usagePercent);
			if (!product || usagePercent === undefined || usagePercent < 0) continue;
			products.push({ product, usagePercent: Math.min(usagePercent, 100) });
		}
	}

	const onDemandCap = parseMoneyVal(config.onDemandCap);
	const onDemandUsed = parseMoneyVal(config.onDemandUsed);
	const prepaidBalance = parseMoneyVal(config.prepaidBalance);
	const hasOnDemandUsage =
		onDemandCap !== undefined && onDemandCap > 0 && onDemandUsed !== undefined;
	if (
		creditUsagePercent === undefined &&
		products.length === 0 &&
		!hasOnDemandUsage &&
		prepaidBalance === undefined
	) {
		return undefined;
	}

	return {
		periodStart,
		periodEnd,
		periodType,
		...(creditUsagePercent !== undefined
			? { creditUsagePercent: Math.min(creditUsagePercent, 100) }
			: {}),
		products,
		onDemandCap,
		onDemandUsed,
		prepaidBalance,
	};
}

function statusFromFraction(usedFraction: number): "ok" | "warning" | "exhausted" {
	if (usedFraction >= 1) return "exhausted";
	if (usedFraction >= 0.8) return "warning";
	return "ok";
}

function percentAmount(usagePercent: number): UsageLimitLike["amount"] {
	const usedFraction = Math.min(Math.max(usagePercent, 0), 100) / 100;
	return {
		used: usagePercent,
		limit: 100,
		remaining: Math.max(0, 100 - usagePercent),
		usedFraction,
		remainingFraction: Math.max(0, 1 - usedFraction),
		unit: "percent",
	};
}

export function buildGrokUsageReport(args: {
	provider: string;
	config: GrokBillingConfig;
	fetchedAt?: number;
	accountId?: string;
	email?: string;
	raw?: unknown;
}): UsageReportLike {
	const fetchedAt = args.fetchedAt ?? Date.now();
	const resetsAt = parseIsoMs(args.config.periodEnd);
	const weekly = args.config.periodType.toUpperCase().includes("WEEK");
	const window = {
		id: weekly ? "1w" : "billing-period",
		label: weekly ? "Weekly" : "Billing period",
		durationMs: weekly ? WEEK_MS : undefined,
		resetsAt,
	};
	const scopeBase = {
		provider: args.provider,
		accountId: args.accountId,
		windowId: window.id,
		shared: true as const,
	};

	const limits: UsageLimitLike[] = [];
	if (args.config.creditUsagePercent !== undefined) {
		const total = percentAmount(args.config.creditUsagePercent);
		limits.push({
			id: `${args.provider}:credits:1w`,
			label: "Weekly credits",
			scope: scopeBase,
			window,
			amount: total,
			status: statusFromFraction(total.usedFraction ?? 0),
		});
	}

	for (const item of args.config.products) {
		const amount = percentAmount(item.usagePercent);
		const slug = item.product
			.trim()
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "");
		if (!slug) continue;
		const label = PRODUCT_LABELS[item.product] ?? item.product;
		limits.push({
			id: `${args.provider}:product:${slug}:1w`,
			label,
			scope: scopeBase,
			window,
			amount,
			status: statusFromFraction(amount.usedFraction ?? 0),
		});
	}

	if (
		args.config.onDemandCap !== undefined &&
		args.config.onDemandCap > 0 &&
		args.config.onDemandUsed !== undefined
	) {
		const usedFraction = Math.min(args.config.onDemandUsed / args.config.onDemandCap, 1);
		limits.push({
			id: `${args.provider}:on-demand`,
			label: "On-demand",
			scope: {
				provider: args.provider,
				accountId: args.accountId,
				shared: true,
			},
			amount: {
				used: args.config.onDemandUsed,
				limit: args.config.onDemandCap,
				remaining: Math.max(0, args.config.onDemandCap - args.config.onDemandUsed),
				usedFraction,
				remainingFraction: 1 - usedFraction,
				unit: "usd",
			},
			status: statusFromFraction(usedFraction),
		});
	}

	if (args.config.prepaidBalance !== undefined) {
		limits.push({
			id: `${args.provider}:prepaid-balance`,
			label: "Prepaid balance",
			scope: {
				provider: args.provider,
				accountId: args.accountId,
				shared: true,
			},
			amount: {
				remaining: args.config.prepaidBalance,
				unit: "usd",
			},
			status: args.config.prepaidBalance > 0 ? "ok" : "exhausted",
		});
	}

	return {
		provider: args.provider,
		fetchedAt,
		limits,
		notes: [
			"Grok Build billing from the CLI proxy. Subscription quota appears only when the endpoint provides it.",
		],
		metadata: {
			endpoint: BILLING_URL,
			source: "cli-chat-proxy-billing",
			...(args.accountId ? { accountId: args.accountId } : {}),
			...(args.email ? { email: args.email } : {}),
		},
		raw: args.raw,
	};
}

export async function fetchGrokUsageReport(args: {
	provider: string;
	accessToken: string;
	accountId?: string;
	email?: string;
	fetch?: typeof fetch;
	signal?: AbortSignal;
}): Promise<UsageReportLike | undefined> {
	const fetchImpl = args.fetch ?? globalThis.fetch;
	const response = await fetchImpl(BILLING_URL, {
		headers: {
			Authorization: `Bearer ${args.accessToken}`,
			Accept: "application/json",
			...GROK_BUILD_HEADERS,
		},
		signal: args.signal,
	});
	if (!response.ok) return undefined;
	const payload: unknown = await response.json();
	const config = parseGrokBillingConfig(payload);
	if (!config) return undefined;
	return buildGrokUsageReport({
		provider: args.provider,
		config,
		accountId: args.accountId,
		email: args.email,
		raw: payload,
	});
}

function oauthAccess(credential: StoredCredentialLike["credential"]): string | undefined {
	const access = credential.access ?? credential.accessToken;
	return typeof access === "string" && access.trim() ? access.trim() : undefined;
}

function oauthStillValid(credential: StoredCredentialLike["credential"], nowMs: number): boolean {
	const expires = credential.expires ?? credential.expiresAt;
	if (expires === undefined) return true;
	return expires > nowMs + 30_000;
}

function missingIdentity(credential: StoredCredentialLike["credential"]): boolean {
	const email = typeof credential.email === "string" ? credential.email.trim() : "";
	const accountId = typeof credential.accountId === "string" ? credential.accountId.trim() : "";
	return !email || !accountId;
}

function stripLegacyOAuthAliases(
	credential: StoredCredentialLike["credential"] & { type: "oauth" },
): StoredCredentialLike["credential"] & { type: "oauth" } {
	const next = { ...credential };
	if ("accessToken" in next) {
		delete next.accessToken;
	}
	if ("expiresAt" in next) {
		delete next.expiresAt;
	}
	return next;
}

function toOAuthPersistShape(
	credential: StoredCredentialLike["credential"],
	enriched: { access: string; refresh: string; expires: number; email?: string; accountId?: string },
): StoredCredentialLike["credential"] & { type: "oauth" } {
	const next: StoredCredentialLike["credential"] & { type: "oauth" } = {
		...credential,
		type: "oauth",
		access: enriched.access,
		refresh: enriched.refresh,
		expires: enriched.expires,
	};
	if (enriched.email) next.email = enriched.email;
	if (enriched.accountId) next.accountId = enriched.accountId;
	return stripLegacyOAuthAliases(next);
}

function identityGained(
	before: StoredCredentialLike["credential"],
	after: { email?: string; accountId?: string },
): boolean {
	const beforeEmail = typeof before.email === "string" ? before.email.trim() : "";
	const beforeAccount = typeof before.accountId === "string" ? before.accountId.trim() : "";
	const afterEmail = typeof after.email === "string" ? after.email.trim() : "";
	const afterAccount = typeof after.accountId === "string" ? after.accountId.trim() : "";
	const emailGained = Boolean(afterEmail) && afterEmail !== beforeEmail;
	const accountGained = Boolean(afterAccount) && afterAccount !== beforeAccount;
	return emailGained || accountGained;
}

/**
 * One-shot session_start backfill for existing grok-build OAuth rows that only
 * have {access,refresh,expires}. Uses AuthStorage public methods only.
 *
 * Persistence strategy (inspected against pi-ai AuthStorage):
 * - Prefer `set(provider, allCredentials)` when available: rewrites the full
 *   provider set (oauth + any api_key rows) so identity-less oauth rows are
 *   updated without wiping siblings. Required because `upsertCredential` cannot
 *   match rows whose identity_key is still null (it would INSERT duplicates).
 * - Else use `upsertCredential` only for rows that already carry some identity
 *   (partial email/accountId upgrade). Pure identity-less rows are skipped —
 *   re-login or natural token refresh is needed.
 * - If neither method exists, skip entirely.
 *
 * Soft-fails entirely — never throws out of session_start.
 * Guarded by WeakSet: at most one attempt per authStorage instance.
 */
export async function backfillGrokOAuthIdentity(
	authStorage: AuthStorageLike,
	options: IdentityBackfillOptions = {},
): Promise<void> {
	try {
		const key = authStorage as object;
		if (IDENTITY_BACKFILL_ATTEMPTED.has(key)) return;
		IDENTITY_BACKFILL_ATTEMPTED.add(key);

		const anyAuth = authStorage as AuthStorageLike;
		const listFn = anyAuth.listStoredCredentials;
		const upsertFn = anyAuth.upsertCredential;
		const setFn = anyAuth.set;
		if (typeof listFn !== "function") return;
		if (typeof upsertFn !== "function" && typeof setFn !== "function") {
			// No safe persistence path — re-login or token refresh must enrich.
			return;
		}

		const provider = options.provider ?? PROVIDER_ID;
		const fetchImpl = options.fetch ?? globalThis.fetch;
		const nowMs = options.nowMs ?? Date.now();

		const rows = listFn.call(authStorage, provider) ?? [];
		if (!Array.isArray(rows) || rows.length === 0) return;

		// Full provider snapshot so set() never drops sibling accounts / api keys.
		const snapshot = rows.map(row => ({
			id: row.id,
			provider: row.provider,
			credential: { ...row.credential },
		}));

		const enrichedIds = new Set<number | undefined>();
		let mutated = false;

		for (const row of snapshot) {
			const credential = row.credential;
			if (credential.type !== undefined && credential.type !== "oauth") continue;
			if (!missingIdentity(credential)) continue;

			const access = oauthAccess(credential);
			if (!access || !oauthStillValid(credential, nowMs)) continue;

			const refresh =
				typeof credential.refresh === "string" && credential.refresh.trim()
					? credential.refresh.trim()
					: undefined;
			if (!refresh) continue;

			const expires = credential.expires ?? credential.expiresAt;
			if (typeof expires !== "number" || !Number.isFinite(expires)) continue;

			let enriched;
			try {
				enriched = await enrichOAuthIdentity(
					{
						access,
						refresh,
						expires,
						email: credential.email,
						accountId: credential.accountId,
					},
					{
						fetchImpl,
						previous: {
							email: credential.email,
							accountId: credential.accountId,
						},
					},
				);
			} catch {
				continue;
			}

			if (!identityGained(credential, enriched)) continue;

			row.credential = toOAuthPersistShape(credential, enriched);
			enrichedIds.add(row.id);
			mutated = true;
		}

		if (!mutated) return;

		// Safest multi-account path: rewrite ALL credentials for the provider.
		if (typeof setFn === "function") {
			const allCredentials = snapshot
				.map(row => {
					const c = row.credential;
					if (c.type === "api_key") return { ...c };
					if (c.type !== undefined && c.type !== "oauth") return { ...c };

					const access = oauthAccess(c);
					const refresh =
						typeof c.refresh === "string" && c.refresh.trim() ? c.refresh.trim() : undefined;
					const expires = c.expires ?? c.expiresAt;
					if (!access || !refresh || typeof expires !== "number") return null;

					return toOAuthPersistShape(c, {
						access,
						refresh,
						expires,
						email: c.email,
						accountId: c.accountId,
					});
				})
				.filter((c): c is NonNullable<typeof c> => c !== null);

			if (allCredentials.length === 0) return;
			await setFn.call(authStorage, provider, allCredentials);
			return;
		}

		// upsert-only fallback: only rows that already had some identity can be
		// matched by identity_key. Identity-less rows would INSERT duplicates —
		// skip those; re-login / natural refresh is required.
		if (typeof upsertFn === "function") {
			for (const row of snapshot) {
				if (!enrichedIds.has(row.id)) continue;
				const c = row.credential;
				// After enrichment both fields may be set, but the *stored* row
				// still has null identity_key when it started identity-less.
				// Without set(), we cannot safely target that row.
				// Heuristic: if the original row id is unknown, skip.
				// We only upsert when the enriched credential has identity AND
				// the pre-enrichment credential already had at least one field
				// (partial upgrade) — those rows already have identity_key.
				// Snapshot already holds post-enrichment data; recover "had prior"
				// via: not both missing from the *original* list.
				const original = rows.find(r => r.id === row.id)?.credential;
				const hadPriorIdentity =
					original !== undefined &&
					((typeof original.email === "string" && original.email.trim() !== "") ||
						(typeof original.accountId === "string" && original.accountId.trim() !== ""));
				if (!hadPriorIdentity) continue;

				const access = oauthAccess(c);
				const refresh =
					typeof c.refresh === "string" && c.refresh.trim() ? c.refresh.trim() : undefined;
				const expires = c.expires ?? c.expiresAt;
				if (!access || !refresh || typeof expires !== "number") continue;

				const payload = toOAuthPersistShape(c, {
					access,
					refresh,
					expires,
					email: c.email,
					accountId: c.accountId,
				});
				try {
					upsertFn.call(authStorage, provider, payload);
				} catch {
					// soft-fail per row
				}
			}
		}
	} catch {
		// never throw out of session_start
	}
}

/**
 * Patch AuthStorage so stock `/usage` (and status-line polls) include Grok Build.
 * Safe if core already ships an xai-oauth/grok-build UsageProvider — we skip
 * providers that already returned a report.
 */
export function installGrokUsageIntoAuthStorage(
	authStorage: AuthStorageLike,
	options: InstallUsageOptions = {},
): void {
	const key = authStorage as object;
	if (INSTALLED.has(key)) return;
	INSTALLED.add(key);

	const providers = options.providers ?? [PROVIDER_ID];
	const fetchImpl = options.fetch ?? globalThis.fetch;
	const originalFetch = authStorage.fetchUsageReports?.bind(authStorage);
	const originalFor = authStorage.usageProviderFor?.bind(authStorage);

	const marker = { id: PROVIDER_ID, source: "omp-grok-build" };

	authStorage.usageProviderFor = (provider: string) => {
		const existing = originalFor?.(provider);
		if (existing !== undefined) return existing;
		if (providers.includes(provider)) return marker;
		return undefined;
	};

	authStorage.fetchUsageReports = async opts => {
		const base = (await originalFetch?.(opts)) ?? [];
		const have = new Set(base.map(report => report.provider));
		const extra: UsageReportLike[] = [];
		const nowMs = Date.now();

		for (const provider of providers) {
			if (have.has(provider)) continue;
			const rows = authStorage.listStoredCredentials?.(provider) ?? [];
			for (const row of rows) {
				const credential = row.credential;
				if (credential.type !== undefined && credential.type !== "oauth") continue;
				const accessToken = oauthAccess(credential);
				if (!accessToken || !oauthStillValid(credential, nowMs)) continue;
				try {
					const report = await fetchGrokUsageReport({
						provider,
						accessToken,
						accountId: credential.accountId,
						email: credential.email,
						fetch: fetchImpl,
						signal: opts?.signal,
					});
					if (report) {
						extra.push(report);
					}
				} catch {
					// leave gap; UI still shows other providers
				}
			}
		}

		if (extra.length === 0) return base;
		return [...base, ...extra];
	};
}

/** Pretty text for slash command / debug. */
export function formatUsageReportText(report: UsageReportLike): string {
	const lines = [`${report.provider} usage`];
	for (const limit of report.limits) {
		const used = limit.amount.usedFraction !== undefined ? `${(limit.amount.usedFraction * 100).toFixed(1)}%` : "?";
		const left =
			limit.amount.remainingFraction !== undefined
				? `${(limit.amount.remainingFraction * 100).toFixed(1)}% left`
				: "";
		lines.push(`  ${limit.label}: ${used} used${left ? ` · ${left}` : ""}`);
		if (limit.window?.resetsAt) {
			lines.push(`    resets ${new Date(limit.window.resetsAt).toISOString()}`);
		}
	}
	return lines.join("\n");
}
