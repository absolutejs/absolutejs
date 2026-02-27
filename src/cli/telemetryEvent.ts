import { readFileSync } from 'node:fs';
import { arch, platform } from 'node:os';
import { resolve } from 'node:path';
import type { TelemetryEvent } from '../../types/telemetry';
import { getTelemetryConfig } from './scripts/telemetry';

const getVersion = () => {
	try {
		const pkgPath = resolve(import.meta.dir, '../../package.json');
		const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));

		return pkg.version as string;
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
