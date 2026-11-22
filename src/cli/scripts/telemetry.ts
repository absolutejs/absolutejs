import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { TelemetryConfig } from '../../../types/telemetry';

const configDir = join(homedir(), '.absolutejs');
const configPath = join(configDir, 'telemetry.json');

/* Environment opt-outs, checked before the saved config and before any
 * request is built.
 *
 * `DO_NOT_TRACK` is the cross-tool convention (consoledonottrack.com): a
 * person sets it once and expects every CLI on the machine to respect it
 * without being configured individually. This one did not — measured with
 * telemetry enabled and `DO_NOT_TRACK=1` exported, the POST to
 * absolutejs.com still went out. A standard opt-out that is quietly
 * ignored is worse than none, because the person believes they are
 * covered.
 *
 * `TELEMETRY_OFF` was already honoured, but only for the exact string
 * `'1'`, so `TELEMETRY_OFF=true` sent anyway. Both now accept any value
 * that is not explicitly off, which can only ever send less. */
const OPT_OUT_VARIABLES: readonly string[] = ['DO_NOT_TRACK', 'TELEMETRY_OFF'];

const OFF_VALUES = new Set(['', '0', 'false']);

const isOptOutValue = (value: string | undefined) =>
	value !== undefined && !OFF_VALUES.has(value.toLowerCase());

export const getTelemetryConfig = () => {
	try {
		if (!existsSync(configPath)) return null;
		const raw = readFileSync(configPath, 'utf-8');

		const config: TelemetryConfig = JSON.parse(raw);

		return config;
	} catch {
		return null;
	}
};

/** Whether anything will actually be sent — the saved setting AND the
 *  environment, because either one can switch it off. */
export const isTelemetryEnabled = () => {
	if (telemetryOptOut() !== null) return false;
	const config = getTelemetryConfig();

	return config?.enabled === true;
};

export const saveTelemetryConfig = (config: TelemetryConfig) => {
	mkdirSync(configDir, { recursive: true });
	writeFileSync(configPath, `${JSON.stringify(config, null, '\t')}\n`);
};

/** The environment variable switching telemetry off, or null. Named rather
 *  than boolean so `telemetry status` can say which one did it: a status
 *  that reports "enabled" while nothing is sent is the same lie in the
 *  other direction. */
export const telemetryOptOut = () =>
	OPT_OUT_VARIABLES.find((name) => isOptOutValue(process.env[name])) ?? null;

const enable = () => {
	const existing = getTelemetryConfig();
	const config: TelemetryConfig = {
		anonymousId: existing?.anonymousId ?? crypto.randomUUID(),
		createdAt: existing?.createdAt ?? new Date().toISOString(),
		enabled: true
	};
	saveTelemetryConfig(config);
	console.log('Telemetry enabled.');
	console.log(`Anonymous ID: ${config.anonymousId}`);
	/* The setting is saved either way — it is what applies once the
	 * variable is gone — but saying "enabled" and sending nothing would
	 * leave someone debugging a pipeline that was never running. */
	const reason = telemetryOptOut();
	if (reason !== null)
		console.log(
			`Nothing will be sent while ${reason} is set in your environment. Unset it to let this take effect.`
		);
};

const disable = () => {
	const existing = getTelemetryConfig();
	if (existing) {
		saveTelemetryConfig({ ...existing, enabled: false });
	}
	console.log('Telemetry disabled.');
};

const status = () => {
	const reason = telemetryOptOut();
	const config = getTelemetryConfig();
	if (reason !== null) {
		console.log(`Telemetry is disabled by ${reason} in your environment.`);
		if (config?.enabled === true)
			console.log(
				'Your saved setting is enabled; it applies again once that variable is unset.'
			);

		return;
	}
	if (!config || !config.enabled) {
		console.log('Telemetry is disabled.');

		return;
	}
	console.log('Telemetry is enabled.');
	console.log(`Anonymous ID: ${config.anonymousId}`);
};

export const telemetry = (args: string[]) => {
	const [subcommand] = args;

	if (subcommand === 'enable') {
		enable();

		return;
	}
	if (subcommand === 'disable') {
		disable();

		return;
	}
	if (subcommand === 'status') {
		status();

		return;
	}
	if (!subcommand) {
		status();
		console.log('');
		console.log('Usage: absolute telemetry <command>');
		console.log('Commands:');
		console.log('  enable    Enable anonymous telemetry');
		console.log('  disable   Disable telemetry');
		console.log('  status    Show current telemetry status');
		console.log('');
		console.log(
			'Telemetry is off until you enable it. Setting DO_NOT_TRACK or'
		);
		console.log(
			'TELEMETRY_OFF in your environment keeps it off whatever is saved here.'
		);

		return;
	}
	console.error(`Unknown telemetry command: ${subcommand}`);
	console.error('Usage: absolute telemetry <enable|disable|status>');
	process.exit(1);
};
