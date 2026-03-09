import { existsSync, readFileSync } from 'node:fs';
import { arch, platform } from 'node:os';
import { dirname, join, parse } from 'node:path';
import type { TelemetryEvent } from '../../types/telemetry';
import { getTelemetryConfig } from './scripts/telemetry';

const getVersion = () => {
	try {
		let { dir } = import.meta;

		while (dir !== parse(dir).root) {
			const candidate = join(dir, 'package.json');

			if (existsSync(candidate)) {
				const pkg = JSON.parse(readFileSync(candidate, 'utf-8'));

				if (pkg.name === '@absolutejs/absolute') {
					return pkg.version as string;
				}
			}

			dir = dirname(dir);
		}

		return 'unknown';
	} catch {
		return 'unknown';
	}
};

export const sendTelemetryEvent = (
	event: string,
	payload: Record<string, unknown>
) => {
	try {
		if (process.env.TELEMETRY_OFF === '1') return;
		const config = getTelemetryConfig();
		if (!config?.enabled) return;

		const body: TelemetryEvent = {
			anonymousId: config.anonymousId,
			arch: arch(),
			bunVersion: Bun.version,
			event,
			os: platform(),
			payload,
			timestamp: new Date().toISOString(),
			version: getVersion()
		};

		fetch('https://absolutejs.com/api/telemetry', {
			body: JSON.stringify(body),
			headers: { 'Content-Type': 'application/json' },
			method: 'POST'
		}).catch(() => {});
	} catch {
		/* silently ignore */
	}
};
