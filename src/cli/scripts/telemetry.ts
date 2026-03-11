import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { TelemetryConfig } from '../../../types/telemetry';

const configDir = join(homedir(), '.absolutejs');
const configPath = join(configDir, 'telemetry.json');

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

export const isTelemetryEnabled = () => {
	const config = getTelemetryConfig();

	return config?.enabled === true;
};

export const saveTelemetryConfig = (config: TelemetryConfig) => {
	mkdirSync(configDir, { recursive: true });
	writeFileSync(configPath, `${JSON.stringify(config, null, '\t')}\n`);
};

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
};

const disable = () => {
	const existing = getTelemetryConfig();
	if (existing) {
		saveTelemetryConfig({ ...existing, enabled: false });
	}
	console.log('Telemetry disabled.');
};

const status = () => {
	const config = getTelemetryConfig();
	if (!config || !config.enabled) {
		console.log('Telemetry is disabled.');
	} else {
		console.log('Telemetry is enabled.');
		console.log(`Anonymous ID: ${config.anonymousId}`);
	}
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

		return;
	}
	console.error(`Unknown telemetry command: ${subcommand}`);
	console.error('Usage: absolute telemetry <enable|disable|status>');
	process.exit(1);
};
