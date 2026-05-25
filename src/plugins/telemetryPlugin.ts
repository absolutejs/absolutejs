import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AnyElysia } from 'elysia';
import type { BuildConfig } from '../../types/build';

// Opt-in OpenTelemetry via @elysiajs/opentelemetry. It pulls the heavy OTel SDK,
// so it's NOT a dependency — when `config.telemetry` is set we dynamically import
// it (variable specifier keeps TS from requiring it) and warn to install it if
// it's missing. Production distributed tracing; complements `absolute inspect`.

const OTEL_PACKAGE = '@elysiajs/opentelemetry';

const readPackageName = (cwd: string) => {
	const path = join(cwd, 'package.json');
	if (!existsSync(path)) return null;
	try {
		const pkg = JSON.parse(readFileSync(path, 'utf-8'));

		return typeof pkg.name === 'string' ? pkg.name : null;
	} catch {
		return null;
	}
};

const serviceNameFor = (config: BuildConfig, cwd: string) => {
	const setting = config.telemetry;
	if (typeof setting === 'object' && setting.serviceName) {
		return setting.serviceName;
	}

	return readPackageName(cwd) ?? 'absolutejs-app';
};

export const withTelemetry = async (
	app: AnyElysia,
	config: BuildConfig,
	cwd: string
) => {
	if (!config.telemetry) return app;

	try {
		const { opentelemetry } = await import(OTEL_PACKAGE);

		return app.use(
			opentelemetry({ serviceName: serviceNameFor(config, cwd) })
		);
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		console.warn(
			`[absolute] telemetry enabled but ${OTEL_PACKAGE} isn't installed — run \`bun add ${OTEL_PACKAGE}\` (${detail})`
		);

		return app;
	}
};
