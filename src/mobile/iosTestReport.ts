import {
	createAbsoluteNativeTestReport,
	readPackageVersionForNativeReport,
	renderAbsoluteNativeTestReport,
	sanitizeNativeReportText,
	writeAbsoluteNativeTestReport,
	type AbsoluteNativeAutomatedRun,
	type AbsoluteNativeTestReport
} from './nativeTestReport';

export type AbsoluteIosAutomatedResult = Omit<
	AbsoluteNativeAutomatedRun,
	'platform' | 'targetId' | 'targetKind'
> & { targetId: string; targetKind: 'device' | 'simulator' };
export type AbsoluteIosPartnerReport = AbsoluteNativeTestReport;

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
	...Array.from(
		{ length: 10 },
		(_, index) =>
			[
				`DEVICEDEV-${String(index + 1).padStart(2, '0')}`,
				`Complete physical-device development runbook check DEVICEDEV-${String(index + 1).padStart(2, '0')}.`
			] as const
	),
	['CAP-01', 'Complete automatic device-capability provisioning checks.'],
	...Array.from(
		{ length: 8 },
		(_, index) =>
			[
				`SYSUI-${String(index + 1).padStart(2, '0')}`,
				`Complete provider-neutral Keyboard and System Bars runbook check SYSUI-${String(index + 1).padStart(2, '0')}.`
			] as const
	),
	...Array.from(
		{ length: 8 },
		(_, index) =>
			[
				`FILES-${String(index + 1).padStart(2, '0')}`,
				`Complete provider-neutral Documents runbook check FILES-${String(index + 1).padStart(2, '0')}.`
			] as const
	),
	...Array.from(
		{ length: 8 },
		(_, index) =>
			[
				`NOTIF-${String(index + 1).padStart(2, '0')}`,
				`Complete provider-neutral Local Notifications runbook check NOTIF-${String(index + 1).padStart(2, '0')}.`
			] as const
	),
	...Array.from(
		{ length: 8 },
		(_, index) =>
			[
				`PUSH-${String(index + 1).padStart(2, '0')}`,
				`Complete provider-neutral Push Notifications runbook check PUSH-${String(index + 1).padStart(2, '0')}.`
			] as const
	),
	...Array.from(
		{ length: 14 },
		(_, index) =>
			[
				`LOC-${String(index + 1).padStart(2, '0')}`,
				`Complete foreground-location runbook check LOC-${String(index + 1).padStart(2, '0')} without recording exact coordinates.`
			] as const
	),
	[
		'AUTH-01',
		'Complete system-browser sign-in, callback, restore, and sign-out checks.'
	],
	[
		'HTTP-01',
		'Confirm @absolutejs/http reaches the trusted server with native Auth and rejects a cross-origin request.'
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

export const readPackageVersionForIosReport = readPackageVersionForNativeReport;
export const renderAbsoluteIosPartnerReport = renderAbsoluteNativeTestReport;
export const sanitizeIosReportText = sanitizeNativeReportText;
export const writeAbsoluteIosPartnerReport = writeAbsoluteNativeTestReport;

export const createAbsoluteIosPartnerReport = (
	options: CreateAbsoluteIosPartnerReportOptions
) => {
	const { targetId, targetKind, ...run } = options.run;
	const physicalResults =
		targetKind === 'device' && run.deviceAcceptance
			? {
					'DEVICEDEV-01': {
						details:
							'AbsoluteJS selected a physical target from the running development session without using Simulator.',
						id: 'DEVICEDEV-01',
						result: 'PASS' as const
					}
				}
			: undefined;

	return createAbsoluteNativeTestReport({
		...(options.generatedAt ? { generatedAt: options.generatedAt } : {}),
		manualChecks: MANUAL_CHECKS,
		...(physicalResults ? { manualCheckResults: physicalResults } : {}),
		metadata: {
			absolutejsVersion: options.absolutejsVersion,
			bunVersion: options.bunVersion,
			macosVersion: options.macosVersion,
			provider: 'capacitor',
			xcodeVersion: options.xcodeVersion
		},
		run: {
			...run,
			platform: 'ios',
			targetId,
			targetKind
		}
	});
};
