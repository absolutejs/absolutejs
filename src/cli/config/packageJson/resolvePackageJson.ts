import { parse } from 'jsonc-parser';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isRecord } from '../guards';
import { introspectType } from '../introspectType';
import type { ConfigField } from '../../../../types/config';
import type { PackageScript } from '../../../../types/packageJsonPanel';

export const findPackageJsonPath = (cwd: string) => {
	const candidate = resolve(cwd, 'package.json');

	return existsSync(candidate) ? candidate : null;
};

const readPackage = (configPath: string) => {
	try {
		const parsed = parse(readFileSync(configPath, 'utf-8'));

		return isRecord(parsed) ? parsed : null;
	} catch {
		return null;
	}
};

const isScalar = (value: unknown) =>
	typeof value === 'string' ||
	typeof value === 'number' ||
	typeof value === 'boolean';

const scalarKind = (value: unknown) => {
	if (typeof value === 'boolean') return 'boolean' as const;
	if (typeof value === 'number') return 'number' as const;

	return 'string' as const;
};

export const resolvePackageJsonState = (cwd: string) => {
	const configPath = findPackageJsonPath(cwd);
	// Catalog from the canonical PackageJson type — scripts are handled by the
	// dedicated manager, so they're excluded from the field catalog.
	const catalog = introspectType(cwd, 'PackageJson', new Set(['scripts']));
	const pkg = configPath ? readPackage(configPath) : null;
	if (!pkg) {
		return {
			complexKeys: [],
			configPath,
			current: {},
			fields: catalog,
			scripts: []
		};
	}

	const scripts: PackageScript[] = isRecord(pkg.scripts)
		? Object.entries(pkg.scripts)
				.filter(([, command]) => typeof command === 'string')
				.map(([name, command]) => ({ command: String(command), name }))
		: [];

	const current: Record<string, unknown> = {};
	const complexKeys: string[] = [];
	const catalogNames = new Set(catalog.map((field) => field.name));
	const extras: ConfigField[] = [];

	for (const [name, value] of Object.entries(pkg)) {
		if (name === 'scripts') continue;
		const complex = !isScalar(value);
		if (complex) complexKeys.push(name);
		else current[name] = value;
		// Surface keys that aren't in the PackageJson type (custom config keys,
		// e.g. "prettier") so nothing in the file is hidden.
		if (!catalogNames.has(name)) {
			extras.push({
				choices: [],
				description: '',
				kind: complex ? 'complex' : scalarKind(value),
				name,
				optional: true,
				typeText: ''
			});
		}
	}

	// A union field (e.g. `exports?: string | Record`) classifies as a scalar,
	// but if the file currently holds an object/array there, keep it read-only
	// so a typed value can't clobber the structure.
	const complexSet = new Set(complexKeys);
	const adjusted = catalog.map((field) =>
		complexSet.has(field.name) && field.kind !== 'complex'
			? { ...field, kind: 'complex' as const }
			: field
	);
	const fields = [...adjusted, ...extras].sort((left, right) =>
		left.name.localeCompare(right.name)
	);

	return { complexKeys, configPath, current, fields, scripts };
};
