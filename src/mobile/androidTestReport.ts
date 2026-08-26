import {
	createAbsoluteNativeTestReport,
	type AbsoluteNativeAutomatedRun
} from './nativeTestReport';

export type AbsoluteAndroidAutomatedResult = Omit<
	AbsoluteNativeAutomatedRun,
	'platform' | 'targetId' | 'targetKind'
> & { serial: string };

type CreateAbsoluteAndroidTestReportOptions = {
	absolutejsVersion: string;
	adbVersion: string;
	bunVersion: string;
	generatedAt?: string;
	host: string;
	run: AbsoluteAndroidAutomatedResult;
};

const MANUAL_CHECKS = [
	[
		'SETUP-01',
		'Confirm Android SDK, emulator/device, Bun, and package versions.'
	],
	['DEV-01', 'Record cold and warm native startup timings.'],
	['DEV-02', 'Complete route traversal, HMR, relaunch, and recovery checks.'],
	['CAP-01', 'Complete automatic device-capability provisioning checks.'],
	[
		'FILES-01',
		'Complete provider-neutral file pick, export, open, and cleanup checks.'
	],
	...Array.from(
		{ length: 6 },
		(_, index) =>
			[
				`NOTIF-${String(index + 1).padStart(2, '0')}`,
				`Complete provider-neutral Local Notifications check NOTIF-${String(index + 1).padStart(2, '0')}.`
			] as const
	),
	[
		'AUTH-01',
		'Complete system-browser sign-in, callback, restore, and sign-out checks.'
	],
	[
		'SYNC-01',
		'Complete online, offline, reconnect, isolation, and conflict checks.'
	],
	['BGSYNC-01', 'Complete WorkManager background Sync acceptance.'],
	['BUILD-01', 'Pass release doctor and produce a signed AAB.'],
	[
		'REPORT-01',
		'Review this directory for sensitive content and complete every row.'
	]
] as const;

export const createAbsoluteAndroidTestReport = (
	options: CreateAbsoluteAndroidTestReportOptions
) => {
	const { serial, ...run } = options.run;

	return createAbsoluteNativeTestReport({
		...(options.generatedAt ? { generatedAt: options.generatedAt } : {}),
		manualChecks: MANUAL_CHECKS,
		metadata: {
			absolutejsVersion: options.absolutejsVersion,
			adbVersion: options.adbVersion,
			bunVersion: options.bunVersion,
			host: options.host,
			provider: 'capacitor'
		},
		run: {
			...run,
			platform: 'android',
			targetId: serial,
			targetKind: serial.startsWith('emulator-') ? 'emulator' : 'device'
		}
	});
};
