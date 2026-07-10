/**
 * Grok Build / SuperGrok subscription usage from CLI billing endpoint.
 * Same source used by core UsageProvider (oh-my-pi#5065).
 */

import { GROK_BUILD_HEADERS, GROK_CLI_VERSION } from "./constants";

const BILLING_URL = "https://cli-chat-proxy.grok.com/v1/billing?format=credits";

export interface GrokUsageLine {
	id: string;
	label: string;
	usedPercent: number;
	resetsAt?: string;
}

export interface GrokUsageSnapshot {
	lines: GrokUsageLine[];
	periodEnd?: string;
	raw: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function toNumber(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string" && value.trim()) {
		const n = Number(value);
		if (Number.isFinite(n)) return n;
	}
	return undefined;
}

function productLabel(product: string): string {
	if (product === "GrokBuild") return "Grok Build";
	if (product === "GrokImagine") return "Grok Imagine";
	return product;
}

export function parseGrokBilling(payload: unknown): GrokUsageSnapshot | undefined {
	if (!isRecord(payload)) return undefined;
	const config = isRecord(payload.config) ? payload.config : payload;
	if (!isRecord(config)) return undefined;

	const periodEnd =
		(typeof config.billingPeriodEnd === "string" && config.billingPeriodEnd) ||
		(isRecord(config.currentPeriod) && typeof config.currentPeriod.end === "string"
			? config.currentPeriod.end
			: undefined);

	const lines: GrokUsageLine[] = [];
	const total = toNumber(config.creditUsagePercent);
	if (total !== undefined) {
		lines.push({ id: "total", label: "Total credits", usedPercent: total, resetsAt: periodEnd });
	}
	const products = Array.isArray(config.productUsage) ? config.productUsage : [];
	for (const entry of products) {
		if (!isRecord(entry)) continue;
		const product = typeof entry.product === "string" ? entry.product : undefined;
		const used = toNumber(entry.usagePercent);
		if (!product || used === undefined) continue;
		lines.push({
			id: product.toLowerCase(),
			label: productLabel(product),
			usedPercent: used,
			resetsAt: periodEnd,
		});
	}
	if (lines.length === 0) return undefined;
	return { lines, periodEnd, raw: payload };
}

export async function fetchGrokBillingUsage(accessToken: string): Promise<GrokUsageSnapshot> {
	const response = await fetch(BILLING_URL, {
		headers: {
			Authorization: `Bearer ${accessToken}`,
			Accept: "application/json",
			...GROK_BUILD_HEADERS,
			"x-grok-client-version": GROK_CLI_VERSION,
		},
	});
	if (!response.ok) {
		const body = await response.text();
		throw new Error(`Billing request failed (${response.status}): ${body.slice(0, 240)}`);
	}
	const payload: unknown = await response.json();
	const parsed = parseGrokBilling(payload);
	if (!parsed) throw new Error("Billing response had no usable quota fields");
	return parsed;
}

export function formatGrokUsage(snapshot: GrokUsageSnapshot): string {
	const lines = snapshot.lines.map(line => {
		const remaining = Math.max(0, 100 - line.usedPercent);
		return `  ${line.label}: ${line.usedPercent.toFixed(1)}% used · ${remaining.toFixed(1)}% left`;
	});
	const reset = snapshot.periodEnd ? `\nResets: ${snapshot.periodEnd}` : "";
	return ["Grok subscription usage (CLI billing)", ...lines, reset].join("\n").trim();
}
