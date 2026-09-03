import { Capacitor, registerPlugin } from '@capacitor/core';
import type { BeaconEnvelope, BeaconEvent } from '@absolutejs/beacon';
import type {
	AbsoluteMobileClientManifest,
	AbsoluteMobileFetch
} from './transport';

const MAX_REPORTS = 8;
const MAX_DETAIL_BYTES = 64 * 1024;
const MAX_STRING_LENGTH = 8 * 1024;
const MAX_REDACTION_DEPTH = 8;
const REPORT_ID = /^[A-Za-z0-9._:-]{1,128}$/u;
const REPORT_KINDS = new Set([
	'anr',
	'app-launch',
	'cpu-exception',
	'crash',
	'disk-write-exception',
	'hang',
	'initialization-failure',
	'low-memory',
	'native-crash',
	'resource-exhaustion',
	'signal'
]);

export type AbsoluteMobileNativeDiagnostic = {
	details: Record<string, unknown>;
	id: string;
	kind: string;
	occurredAt: number;
	platform: 'android' | 'ios';
};

export type AbsoluteMobileNativeObservabilityPlugin = {
	acknowledge(options: { ids: string[] }): Promise<void>;
	pending(): Promise<{ reports: unknown[] }>;
};

export type AbsoluteMobileNativeObservabilityDrainOptions = {
	native?: boolean;
	plugin?: AbsoluteMobileNativeObservabilityPlugin;
};

const nativeObservability =
	registerPlugin<AbsoluteMobileNativeObservabilityPlugin>(
		'AbsoluteMobileObservability'
	);

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const redactText = (value: string) =>
	value
		.slice(0, MAX_STRING_LENGTH)
		.replace(/\b(Bearer)\s+[A-Za-z0-9._~+/-]+=*/giu, '$1 [REDACTED]')
		.replace(
			/([?&](?:access_token|api_?key|authorization|code|id_token|password|refresh_token|secret|token)=)[^&#\s]*/giu,
			'$1[REDACTED]'
		)
		.replace(
			/\b((?:access_?token|api_?key|authorization|client_?secret|cookie|id_?token|password|passwd|refresh_?token|secret|token)\s*[:=]\s*)[^,\s;]+/giu,
			'$1[REDACTED]'
		)
		.replace(
			/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/gu,
			'[REDACTED]'
		);

const redactValue = (value: unknown, depth = 0): unknown => {
	if (depth >= MAX_REDACTION_DEPTH) return '[TRUNCATED]';
	if (typeof value === 'string') return redactText(value);
	if (
		value === null ||
		typeof value === 'number' ||
		typeof value === 'boolean'
	)
		return value;
	if (Array.isArray(value))
		return value.slice(0, 64).map((entry) => redactValue(entry, depth + 1));
	if (!isRecord(value)) return String(value).slice(0, MAX_STRING_LENGTH);

	return Object.fromEntries(
		Object.entries(value)
			.slice(0, 128)
			.map(([key, entry]) => [
				key,
				/(?:authorization|cookie|password|secret|token)/iu.test(key)
					? '[REDACTED]'
					: redactValue(entry, depth + 1)
			])
	);
};

const parseReport = (
	value: unknown
): AbsoluteMobileNativeDiagnostic | undefined => {
	if (!isRecord(value) || !isRecord(value.details)) return undefined;
	if (typeof value.id !== 'string' || !REPORT_ID.test(value.id))
		return undefined;
	if (typeof value.kind !== 'string' || !REPORT_KINDS.has(value.kind))
		return undefined;
	if (
		typeof value.occurredAt !== 'number' ||
		!Number.isFinite(value.occurredAt) ||
		value.occurredAt <= 0
	)
		return undefined;
	if (value.platform !== 'android' && value.platform !== 'ios')
		return undefined;
	const details = redactValue(value.details);
	if (!isRecord(details)) return undefined;
	if (
		new TextEncoder().encode(JSON.stringify(details)).byteLength >
		MAX_DETAIL_BYTES
	)
		return undefined;

	return {
		details,
		id: value.id,
		kind: value.kind,
		occurredAt: value.occurredAt,
		platform: value.platform
	};
};

const sampled = (id: string, sampleRate: number) => {
	if (sampleRate >= 1) return true;
	let hash = 2_166_136_261;
	for (const character of id) {
		hash ^= character.codePointAt(0) ?? 0;
		hash = Math.imul(hash, 16_777_619);
	}

	return (hash >>> 0) / 4_294_967_296 < sampleRate;
};

const reportEvent = (
	report: AbsoluteMobileNativeDiagnostic,
	manifest: AbsoluteMobileClientManifest
): BeaconEvent => ({
	at: report.occurredAt,
	extra: {
		nativeDiagnostic: report.details,
		nativeDiagnosticId: report.id
	},
	groupingKey: `absolute-native:${report.platform}:${report.kind}`,
	level: [
		'app-launch',
		'cpu-exception',
		'disk-write-exception',
		'low-memory',
		'resource-exhaustion',
		'signal'
	].includes(report.kind)
		? 'warning'
		: 'error',
	message: `Native process diagnostic — ${report.kind}`,
	name: 'AbsoluteMobileNativeDiagnostic',
	tags: {
		absoluteMobile: 'true',
		mobileAppBuild: manifest.appBuild,
		mobileFailurePhase: 'native-process',
		mobileManifestFormat: String(manifest.format),
		mobileNativeRuntime: manifest.nativeRuntime,
		mobilePlatform: report.platform,
		mobileRuntime: manifest.runtime
	}
});

export const drainAbsoluteMobileNativeObservability = async (
	manifest: AbsoluteMobileClientManifest,
	fetch: AbsoluteMobileFetch,
	options: AbsoluteMobileNativeObservabilityDrainOptions = {}
) => {
	const config = manifest.observability;
	if (!config || !(options.native ?? Capacitor.isNativePlatform())) return 0;
	const plugin = options.plugin ?? nativeObservability;
	const pending = await plugin.pending();
	const reports = pending.reports
		.slice(0, MAX_REPORTS)
		.map(parseReport)
		.filter(
			(report): report is AbsoluteMobileNativeDiagnostic =>
				report !== undefined
		);
	const discarded = reports.filter(
		(report) => !sampled(report.id, config.sampleRate)
	);
	if (discarded.length > 0)
		await plugin.acknowledge({
			ids: discarded.map(({ id }) => id)
		});
	const selected = reports.filter((report) =>
		sampled(report.id, config.sampleRate)
	);
	if (selected.length === 0) return 0;
	const envelope: BeaconEnvelope = {
		...(config.environment ? { environment: config.environment } : {}),
		events: selected.map((report) => reportEvent(report, manifest)),
		project: config.project,
		release: manifest.appBuild,
		v: 1
	};
	const response = await fetch(config.endpoint, {
		body: JSON.stringify(envelope),
		headers: { 'content-type': 'application/json' },
		method: 'POST'
	});
	if (!response.ok) return 0;
	await plugin.acknowledge({
		ids: selected.map(({ id }) => id)
	});

	return selected.length;
};
