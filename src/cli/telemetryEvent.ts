import { existsSync, readFileSync } from 'node:fs';
import { arch, platform } from 'node:os';
import { dirname, join, parse } from 'node:path';
import type { TelemetryEvent } from '../../types/telemetry';
import { getTelemetryConfig } from './scripts/telemetry';

const getVersion = () => {
	try {
		let dir = import.meta.dir;

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
			event,
			anonymousId: config.anonymousId,
			version: getVersion(),
			os: platform(),
			arch: arch(),
			bunVersion: Bun.version,
			timestamp: new Date().toISOString(),
			payload
		};

		fetch('https://absolutejs.com/api/telemetry', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body)
		}).catch(() => {});
	} catch {
		/* silently ignore */
	}
};
