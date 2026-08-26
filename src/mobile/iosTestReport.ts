import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export type AbsoluteIosReportResult = 'FAIL' | 'NOT_RUN' | 'PASS' | 'SKIPPED';

export type AbsoluteIosReportCheck = {
	details: string;
	evidence?: string;
	id: string;
	result: AbsoluteIosReportResult;
};

export type AbsoluteIosAutomatedResult = {
	appId: string;
	durationMs: number;
	error?: string;
	hmr?: {
		clientMs?: number;
		durationMs: number;
		outcome: 'applied' | 'failed' | 'reloaded';
		serverMs?: number;
	};
	hmrConnected: boolean;
	port: number;
	screenshot?: string;
	status: 'fail' | 'pass';
	udid: string;
};

export type AbsoluteIosPartnerReport = {
	automatedChecks: AbsoluteIosReportCheck[];
	generatedAt: string;
	manualChecks: AbsoluteIosReportCheck[];
	metadata: {
		absolutejsVersion: string;
		bunVersion: string;
		macosVersion: string;
		provider: 'capacitor';
		xcodeVersion: string;
	};
	overallResult: 'FAIL' | 'INCOMPLETE';
	platform: 'ios';
	reportVersion: 1;
	run: AbsoluteIosAutomatedResult;
};

type CreateAbsoluteIosPartnerReportOptions = {
	absolutejsVersion: string;
	bunVersion: string;
	generatedAt?: string;
	macosVersion: string;
	run: AbsoluteIosAutomatedResult;
	xcodeVersion: string;
};

const MANUAL_CHECKS = [
	[
		'SETUP-01',
		'Confirm and record all Mac, Xcode, Bun, device, and package versions.'
	],
	['SETUP-02', 'Confirm Xcode setup and the required iOS runtime.'],
	['SETUP-03', 'Confirm the runbook package versions are installed.'],
	['SETUP-04', 'Confirm the staging bundle ID and production server origin.'],
	['SETUP-05', 'Confirm generated iOS project signing and Xcode warnings.'],
	['DEV-01', 'Record cold and warm bun dev startup timings.'],
	['DEV-02', 'Complete route traversal, HMR, relaunch, and recovery checks.'],
	['CAP-01', 'Complete automatic device-capability provisioning checks.'],
	...Array.from({ length: 14 }, (_, index) => [
		`LOC-${String(index + 1).padStart(2, '0')}`,
		`Complete foreground-location runbook check LOC-${String(index + 1).padStart(2, '0')} without recording exact coordinates.`
	]),
	[
		'AUTH-01',
		'Complete system-browser sign-in, callback, restore, and sign-out checks.'
	],
	[
		'SYNC-01',
		'Complete online, offline, reconnect, isolation, and conflict checks.'
	],
	['BGSYNC-01', 'Complete physical-device background Sync acceptance.'],
	['REMOTE-01', 'Complete remote-Mac acceptance, or mark SKIPPED.'],
	['BUILD-01', 'Pass release doctor and produce a signed IPA.'],
	[
		'SHIP-01',
		'Upload, process, assign, install, and launch the TestFlight build.'
	],
	['UPDATE-01', 'Prove upload retry reuse and a subsequent web-only update.'],
	[
		'REPORT-01',
		'Review this directory for sensitive content and complete every row.'
	]
] as const;

const secretPattern =
	/(authorization|access[_ -]?token|refresh[_ -]?token|socket[_ -]?ticket|password|cookie)(\s*[=:]\s*)([^\s,;]+)/giu;
const bearerPattern = /bearer\s+[^\s,;]+/giu;
const coordinatePattern =
	/\b(latitude|longitude|lat|lng)(\s*[=:]\s*)-?\d+(?:\.\d+)?/giu;

export const sanitizeIosReportText = (value: string) =>
	value
		.replace(bearerPattern, 'Bearer [REDACTED]')
		.replace(secretPattern, '$1$2[REDACTED]')
		.replace(coordinatePattern, '$1$2[REDACTED]')
		.replace(/(https?:\/\/[^\s?#]+)[?#][^\s]*/giu, '$1?[REDACTED]');

const markdownCell = (value: string) =>
	sanitizeIosReportText(value)
		.replaceAll('|', '\\|')
		.replaceAll('\n', '<br>');

export const createAbsoluteIosPartnerReport = (
	options: CreateAbsoluteIosPartnerReportOptions
): AbsoluteIosPartnerReport => {
	const { run } = options;
	const evidence = run.screenshot
		? `Simulator screenshot: ${run.screenshot}`
		: undefined;
	let hmrResult: AbsoluteIosReportResult = 'NOT_RUN';
	if (run.hmr) hmrResult = run.hmr.outcome === 'failed' ? 'FAIL' : 'PASS';
	const automatedChecks: AbsoluteIosReportCheck[] = [
		{
			details: `Captured macOS, Xcode, Bun, and AbsoluteJS versions for simulator ${run.udid}.`,
			id: 'AUTO-SETUP-01',
			result: 'PASS'
		},
		{
			details:
				run.status === 'pass'
					? `The app was installed, launched, and connected to native HMR in ${run.durationMs}ms.`
					: `The automated simulator run failed after ${run.durationMs}ms: ${run.error ?? 'No error detail was available.'}`,
			...(evidence ? { evidence } : {}),
			id: 'AUTO-DEV-01',
			result: run.status === 'pass' ? 'PASS' : 'FAIL'
		},
		{
			details: run.hmr
				? `Observed native HMR ${run.hmr.outcome} in ${run.hmr.durationMs}ms${run.hmr.serverMs === undefined ? '' : ` (server ${run.hmr.serverMs}ms, client ${run.hmr.clientMs}ms)`}.`
				: 'Correlated edit timing was not requested. Rerun with --wait-for-hmr.',
			id: 'AUTO-HMR-01',
			result: hmrResult
		},
		{
			details: run.screenshot
				? 'A simulator screenshot was captured. Visually review it before sharing this directory.'
				: 'No simulator screenshot was captured.',
			...(evidence ? { evidence } : {}),
			id: 'AUTO-ARTIFACT-01',
			result: run.screenshot ? 'PASS' : 'FAIL'
		}
	];
	const manualChecks = MANUAL_CHECKS.map(
		([id, details]): AbsoluteIosReportCheck => ({
			details,
			id,
			result: 'NOT_RUN'
		})
	);

	return {
		automatedChecks,
		generatedAt: options.generatedAt ?? new Date().toISOString(),
		manualChecks,
		metadata: {
			absolutejsVersion: options.absolutejsVersion,
			bunVersion: options.bunVersion,
			macosVersion: options.macosVersion,
			provider: 'capacitor',
			xcodeVersion: options.xcodeVersion
		},
		overallResult: run.status === 'fail' ? 'FAIL' : 'INCOMPLETE',
		platform: 'ios',
		reportVersion: 1,
		run
	};
};

export const readPackageVersionForIosReport = async (
	packageJsonPath: string
) => {
	const manifest: unknown = JSON.parse(
		await readFile(packageJsonPath, 'utf8')
	);
	if (typeof manifest !== 'object' || manifest === null) return 'unknown';
	const version: unknown = Reflect.get(manifest, 'version');

	return typeof version === 'string' ? version : 'unknown';
};

export const renderAbsoluteIosPartnerReport = (
	report: AbsoluteIosPartnerReport
) => {
	const table = (checks: AbsoluteIosReportCheck[]) =>
		checks
			.map(
				(check) =>
					`| ${check.id} | ${check.result} | ${markdownCell(check.details)} | ${markdownCell(check.evidence ?? '')} |`
			)
			.join('\n');

	return (
		`# AbsoluteJS iOS test report

- Overall result: ${report.overallResult}
- Generated: ${report.generatedAt}
- AbsoluteJS: ${markdownCell(report.metadata.absolutejsVersion)}
- macOS: ${markdownCell(report.metadata.macosVersion)}
- Xcode: ${markdownCell(report.metadata.xcodeVersion)}
- Bun: ${markdownCell(report.metadata.bunVersion)}
- App bundle ID: ${markdownCell(report.run.appId)}
- Simulator UDID: ${markdownCell(report.run.udid)}
- Automated run: ${report.run.status.toUpperCase()} (${report.run.durationMs}ms)

` +
		`This report is local and is never uploaded by AbsoluteJS. Before sharing its directory, visually inspect screenshots and logs. Never add passwords, signing material, tokens, cookies, private Sync data, or exact coordinates.

## Automated checks

| Test ID | Result | Observed result / timing | Evidence |
| --- | --- | --- | --- |
${table(report.automatedChecks)}

## Partner checklist

Replace each \`NOT_RUN\` with \`PASS\`, \`FAIL\`, or \`SKIPPED\` after following \`docs/IOS_MACOS_TESTING.md\`. A failure must name sanitized evidence and state actual versus expected behavior.

| Test ID | Result | Observed result / timing | Evidence or failure details |
| --- | --- | --- | --- |
${table(report.manualChecks)}
`
	);
};

export const writeAbsoluteIosPartnerReport = async (
	directory: string,
	report: AbsoluteIosPartnerReport
) => {
	await mkdir(directory, { recursive: true });
	const jsonPath = join(directory, 'report.json');
	const markdownPath = join(directory, 'report.md');
	await Promise.all([
		writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`),
		writeFile(markdownPath, renderAbsoluteIosPartnerReport(report))
	]);

	return { directory, jsonPath, markdownPath };
};
