import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export type AbsoluteNativeReportResult =
	| 'FAIL'
	| 'NOT_RUN'
	| 'PASS'
	| 'SKIPPED';

export type AbsoluteNativeReportCheck = {
	details: string;
	evidence?: string;
	id: string;
	result: AbsoluteNativeReportResult;
};

export type AbsoluteNativeHmrResult = {
	clientMs?: number;
	durationMs: number;
	outcome: 'applied' | 'failed' | 'reloaded';
	serverMs?: number;
};

export type AbsoluteNativeAutomatedRun = {
	appId: string;
	durationMs: number;
	error?: string;
	hmr?: AbsoluteNativeHmrResult;
	hmrConnected: boolean;
	platform: 'android' | 'ios';
	port: number;
	routes?: string[];
	screenshot?: string;
	status: 'fail' | 'pass';
	targetId: string;
	targetKind: 'device' | 'emulator' | 'simulator';
};

export type AbsoluteNativeTestReport = {
	automatedChecks: AbsoluteNativeReportCheck[];
	generatedAt: string;
	manualChecks: AbsoluteNativeReportCheck[];
	metadata: Record<string, string> & {
		absolutejsVersion: string;
		bunVersion: string;
		provider: 'capacitor';
	};
	overallResult: 'FAIL' | 'INCOMPLETE';
	platform: 'android' | 'ios';
	reportVersion: 1;
	run: AbsoluteNativeAutomatedRun;
};

export type AbsoluteNativeManualCheckDefinition = readonly [
	id: string,
	details: string
];

type CreateAbsoluteNativeTestReportOptions = {
	automatedChecks?: AbsoluteNativeReportCheck[];
	generatedAt?: string;
	manualChecks: readonly AbsoluteNativeManualCheckDefinition[];
	metadata: AbsoluteNativeTestReport['metadata'];
	run: AbsoluteNativeAutomatedRun;
};

const secretPattern =
	/(authorization|access[_ -]?token|refresh[_ -]?token|socket[_ -]?ticket|password|cookie)(\s*[=:]\s*)([^\s,;]+)/giu;
const bearerPattern = /bearer\s+[^\s,;]+/giu;
const coordinatePattern =
	/\b(latitude|longitude|lat|lng)(\s*[=:]\s*)-?\d+(?:\.\d+)?/giu;

export const sanitizeNativeReportText = (value: string) =>
	value
		.replace(bearerPattern, 'Bearer [REDACTED]')
		.replace(secretPattern, '$1$2[REDACTED]')
		.replace(coordinatePattern, '$1$2[REDACTED]')
		.replace(/(https?:\/\/[^\s?#]+)[?#][^\s]*/giu, '$1?[REDACTED]');

const markdownCell = (value: string) =>
	sanitizeNativeReportText(value)
		.replaceAll('|', '\\|')
		.replaceAll('\n', '<br>');

export const createAbsoluteNativeAutomatedChecks = (
	run: AbsoluteNativeAutomatedRun
) => {
	const target = `${run.targetKind} ${run.targetId}`;
	const evidence = run.screenshot
		? `Screenshot: ${run.screenshot}`
		: undefined;
	let hmrResult: AbsoluteNativeReportResult = 'NOT_RUN';
	if (run.hmr) hmrResult = run.hmr.outcome === 'failed' ? 'FAIL' : 'PASS';
	const routeDetails = run.routes?.length
		? ` Routes: ${run.routes.join(', ')}.`
		: '';

	return [
		{
			details: `Captured host, toolchain, Bun, and AbsoluteJS metadata for ${target}.`,
			id: 'AUTO-SETUP-01',
			result: 'PASS'
		},
		{
			details:
				run.status === 'pass'
					? `The app launched and connected to native HMR in ${run.durationMs}ms.${routeDetails}`
					: `The automated native run failed after ${run.durationMs}ms: ${run.error ?? 'No error detail was available.'}`,
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
				? 'A target screenshot was captured. Visually review it before sharing this directory.'
				: 'No target screenshot was captured.',
			...(evidence ? { evidence } : {}),
			id: 'AUTO-ARTIFACT-01',
			result: run.screenshot ? 'PASS' : 'FAIL'
		}
	] satisfies AbsoluteNativeReportCheck[];
};

export const createAbsoluteNativeTestReport = (
	options: CreateAbsoluteNativeTestReportOptions
): AbsoluteNativeTestReport => ({
	automatedChecks:
		options.automatedChecks ??
		createAbsoluteNativeAutomatedChecks(options.run),
	generatedAt: options.generatedAt ?? new Date().toISOString(),
	manualChecks: options.manualChecks.map(([id, details]) => ({
		details,
		id,
		result: 'NOT_RUN' as const
	})),
	metadata: options.metadata,
	overallResult: options.run.status === 'fail' ? 'FAIL' : 'INCOMPLETE',
	platform: options.run.platform,
	reportVersion: 1,
	run: options.run
});

export const readPackageVersionForNativeReport = async (
	packageJsonPath: string
) => {
	const manifest: unknown = JSON.parse(
		await readFile(packageJsonPath, 'utf8')
	);
	if (typeof manifest !== 'object' || manifest === null) return 'unknown';
	const version: unknown = Reflect.get(manifest, 'version');

	return typeof version === 'string' ? version : 'unknown';
};

export const renderAbsoluteNativeTestReport = (
	report: AbsoluteNativeTestReport
) => {
	const table = (checks: AbsoluteNativeReportCheck[]) =>
		checks
			.map(
				(check) =>
					`| ${check.id} | ${check.result} | ${markdownCell(check.details)} | ${markdownCell(check.evidence ?? '')} |`
			)
			.join('\n');
	const metadata = Object.entries(report.metadata)
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([key, value]) => `- ${key}: ${markdownCell(value)}`)
		.join('\n');

	return `# AbsoluteJS ${report.platform} test report

- Overall result: ${report.overallResult}
- Generated: ${report.generatedAt}
- App bundle ID: ${markdownCell(report.run.appId)}
- Target: ${report.run.targetKind} ${markdownCell(report.run.targetId)}
- Automated run: ${report.run.status.toUpperCase()} (${report.run.durationMs}ms)
${metadata}

This report is local and is never uploaded by AbsoluteJS. Before sharing its directory, visually inspect screenshots and logs. Never add passwords, signing material, tokens, cookies, private Sync data, or exact coordinates.

## Automated checks

| Test ID | Result | Observed result / timing | Evidence |
| --- | --- | --- | --- |
${table(report.automatedChecks)}

## Manual checklist

Replace each \`NOT_RUN\` with \`PASS\`, \`FAIL\`, or \`SKIPPED\` after completing the platform runbook. A failure must name sanitized evidence and state actual versus expected behavior.

| Test ID | Result | Observed result / timing | Evidence or failure details |
| --- | --- | --- | --- |
${table(report.manualChecks)}
`;
};

export const writeAbsoluteNativeTestReport = async (
	directory: string,
	report: AbsoluteNativeTestReport
) => {
	await mkdir(directory, { recursive: true });
	const jsonPath = join(directory, 'report.json');
	const markdownPath = join(directory, 'report.md');
	await Promise.all([
		writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`),
		writeFile(markdownPath, renderAbsoluteNativeTestReport(report))
	]);

	return { directory, jsonPath, markdownPath };
};
