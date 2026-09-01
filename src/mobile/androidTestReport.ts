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
	[
		'ADAPT-01',
		'Confirm safe-area variables and platform attributes on every embedded framework.'
	],
	[
		'ADAPT-02',
		'Rotate with the keyboard open and confirm viewport and available-height variables update without double padding.'
	],
	[
		'ADAPT-03',
		'Go offline and reconnect; confirm the root state and accessibility announcement update.'
	],
	[
		'ADAPT-04',
		'Confirm automatic system-bar appearance and unchanged author layout.'
	],
	['CAP-01', 'Complete automatic device-capability provisioning checks.'],
	[
		'SYSUI-01',
		'Confirm Keyboard and System Bars are provisioned automatically.'
	],
	[
		'SYSUI-02',
		'Confirm the web fallback reports provider-neutral capabilities.'
	],
	['SYSUI-03', 'Confirm the real WebView selects the native adapters.'],
	[
		'SYSUI-04',
		'Open and dismiss the native keyboard five times without stale state.'
	],
	[
		'SYSUI-05',
		'Confirm light and dark foreground choices reach both Android system bars.'
	],
	[
		'SYSUI-06',
		'Hide and restore system bars and confirm restored content remains inside the safe area.'
	],
	[
		'SYSUI-07',
		'Rotate and relaunch while preserving the route and native adapters.'
	],
	[
		'SYSUI-08',
		'Apply a System UI component edit through native HMR and record its timing.'
	],
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
		'HTTP-01',
		'Confirm @absolutejs/http reaches the trusted server with native Auth and rejects a cross-origin request.'
	],
	[
		'SYNC-01',
		'Complete online, offline, reconnect, isolation, and conflict checks.'
	],
	['BGSYNC-01', 'Complete WorkManager background Sync acceptance.'],
	[
		'UPGRADE-01',
		'Install the next APK in place and confirm Auth, Sync SQLite, and pending operations survive.'
	],
	[
		'COMPAT-01',
		'Confirm installed app N works with retained N+1/N+2 producers, shows typed update-required at N+3, and recovers after server rollback.'
	],
	[
		'MIGRATE-01',
		'Install a generated local-schema upgrade in place and confirm cached rows, Auth, and pending operations survive.'
	],
	[
		'MIGRATE-02',
		'Confirm a failed local-schema migration rolls back atomically and a corrected forward build recovers without clearing app data.'
	],
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
