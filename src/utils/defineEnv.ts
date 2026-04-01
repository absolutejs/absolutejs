import { env as bunEnv } from 'bun';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Type, type TProperties } from '@sinclair/typebox';
import { Value, type ValueError } from '@sinclair/typebox/value';

const SENSITIVE_PATTERN = /SECRET|KEY|TOKEN|PASSWORD/i;

const isSensitive = (key: string) => SENSITIVE_PATTERN.test(key);

const formatEnvErrors = (
	properties: TProperties,
	converted: Record<string, unknown>,
	errors: ValueError[]
) => {
	const errorsByKey = new Map<string, ValueError>();
	for (const error of errors) {
		const key = error.path.replace(/^\//, '');
		if (!key || errorsByKey.has(key)) continue;
		errorsByKey.set(key, error);
	}

	const lines = Object.keys(properties).map((key) => {
		const error = errorsByKey.get(key);
		if (error) {
			const value = converted[key];
			const detail =
				value === undefined
					? 'required but not set'
					: `${error.message}, got ${JSON.stringify(value)}`;

			return `  \u2717 ${key} \u2014 ${detail}`;
		}
		const value = converted[key];
		const display = isSensitive(key) ? 'set' : JSON.stringify(value);

		return `  \u2713 ${key} \u2014 ${display}`;
	});

	return `Environment validation failed:\n${lines.join('\n')}`;
};

const checkEnvFileSecurity = (properties: TProperties) => {
	const cwd = process.cwd();
	const envPath = resolve(cwd, '.env');

	if (!existsSync(envPath)) return;

	const sensitiveKeys = Object.keys(properties).filter(isSensitive);
	if (sensitiveKeys.length === 0) return;

	const envContent = readFileSync(envPath, 'utf-8');
	const presentKeys = sensitiveKeys.filter((key) =>
		envContent.includes(`${key}=`)
	);
	if (presentKeys.length === 0) return;

	const gitignorePath = resolve(cwd, '.gitignore');
	if (existsSync(gitignorePath)) {
		const gitignore = readFileSync(gitignorePath, 'utf-8');
		if (gitignore.split('\n').some((line) => line.trim() === '.env'))
			return;
	}

	console.warn(
		`[absolutejs] Warning: .env contains sensitive variables (${presentKeys.join(', ')}) but is not listed in .gitignore`
	);
};

export const defineEnv = <T extends TProperties>(properties: T) => {
	const schema = Type.Object(properties);

	const raw: Record<string, unknown> = {};
	for (const key of Object.keys(properties)) {
		raw[key] = bunEnv[key];
	}

	Value.Default(schema, raw);
	const converted = Value.Convert(schema, raw);

	const errors = [...Value.Errors(schema, converted)];
	if (errors.length > 0) {
		throw new Error(formatEnvErrors(properties, raw, errors));
	}

	checkEnvFileSecurity(properties);

	return Object.freeze(Value.Decode(schema, converted));
};
