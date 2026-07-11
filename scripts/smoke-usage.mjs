/**
 * Smoke: billing → /usage-compatible UsageReport + authStorage install merge.
 */
import {
	buildGrokUsageReport,
	installGrokUsageIntoAuthStorage,
	parseGrokBillingConfig,
} from "../src/usage.ts";

const SAMPLE = {
	config: {
		currentPeriod: {
			type: "USAGE_PERIOD_TYPE_WEEKLY",
			start: "2026-07-08T06:25:15.635567+00:00",
			end: "2026-07-15T06:25:15.635567+00:00",
		},
		creditUsagePercent: 13,
		productUsage: [
			{ product: "GrokBuild", usagePercent: 9 },
			{ product: "GrokImagine", usagePercent: 4 },
		],
		onDemandCap: { val: 0 },
		onDemandUsed: { val: 0 },
		billingPeriodStart: "2026-07-08T06:25:15.635567+00:00",
		billingPeriodEnd: "2026-07-15T06:25:15.635567+00:00",
	},
};

const cfg = parseGrokBillingConfig(SAMPLE);
if (!cfg) throw new Error("parse failed");
if (cfg.creditUsagePercent !== 13) throw new Error("total");
if (cfg.products.length !== 2) throw new Error("products");

const report = buildGrokUsageReport({
	provider: "grok-build",
	config: cfg,
	fetchedAt: Date.parse("2026-07-10T12:00:00Z"),
	accountId: "acc-1",
	email: "user@example.com",
});

if (report.provider !== "grok-build") throw new Error("provider");
if (!report.limits.some(l => l.id.includes("grokbuild") || l.label.includes("Grok Build"))) {
	throw new Error(`limits ${report.limits.map(l => l.label).join(",")}`);
}
if (report.limits[0].amount.unit !== "percent") throw new Error("unit");
if (report.limits[0].window?.label !== "Weekly") throw new Error("window");
if (report.metadata?.email !== "user@example.com") throw new Error("email");

// install merges when core has no report
const existing = [{ provider: "anthropic", fetchedAt: 1, limits: [] }];
let calls = 0;
const authStorage = {
	async fetchUsageReports() {
		calls += 1;
		return existing;
	},
	usageProviderFor(provider) {
		if (provider === "anthropic") return { id: "anthropic" };
		return undefined;
	},
	listStoredCredentials(provider) {
		if (provider === "grok-build") {
			return [
				{
					id: 1,
					provider: "grok-build",
					credential: {
						type: "oauth",
						access: "tok",
						refresh: "ref",
						expires: Date.now() + 60_000,
						accountId: "acc-1",
					},
				},
			];
		}
		return [];
	},
};

const fetchImpl = async () =>
	new Response(JSON.stringify(SAMPLE), {
		status: 200,
		headers: { "content-type": "application/json" },
	});

installGrokUsageIntoAuthStorage(authStorage, { fetch: fetchImpl });

if (authStorage.usageProviderFor("grok-build") == null) {
	throw new Error("usageProviderFor should report grok-build");
}

const merged = await authStorage.fetchUsageReports();
if (!merged.some(r => r.provider === "grok-build")) {
	throw new Error(`missing grok-build in ${JSON.stringify(merged.map(r => r.provider))}`);
}
if (!merged.some(r => r.provider === "anthropic")) throw new Error("lost anthropic");

// core already has grok-build → do not duplicate
const auth2 = {
	async fetchUsageReports() {
		return [{ provider: "grok-build", fetchedAt: 1, limits: [{ id: "core" }] }];
	},
	usageProviderFor: () => ({ id: "x" }),
	listStoredCredentials: () => [
		{
			id: 1,
			provider: "grok-build",
			credential: { type: "oauth", access: "tok", refresh: "r", expires: Date.now() + 99_000 },
		},
	],
};
installGrokUsageIntoAuthStorage(auth2, { fetch: fetchImpl });
const once = await auth2.fetchUsageReports();
if (once.filter(r => r.provider === "grok-build").length !== 1) {
	throw new Error("should not duplicate core report");
}

console.log("PASS usage /usage integration");
