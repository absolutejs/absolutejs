import { parse } from 'jsonc-parser';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isRecord } from '../guards';
import { introspectType } from '../schema/fromType';
import type { FieldNode } from '../../../../types/config';
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

export const resolvePackageJsonState = (cwd: string) => {
	const configPath = findPackageJsonPath(cwd);
	// Catalog from the canonical PackageJson type; scripts have a dedicated UI.
	const catalog = introspectType(cwd, 'PackageJson', new Set(['scripts']));
	const pkg = configPath ? readPackage(configPath) : null;
	if (!pkg) {
		return { configPath, current: {}, fields: catalog, scripts: [] };
	}

	const scripts: PackageScript[] = isRecord(pkg.scripts)
		? Object.entries(pkg.scripts)
				.filter(([, command]) => typeof command === 'string')
				.map(([name, command]) => ({ command: String(command), name }))
		: [];

	const current: Record<string, unknown> = {};
	for (const [name, value] of Object.entries(pkg)) {
		if (name !== 'scripts') current[name] = value;
	}

	// Keys present in the file but absent from the PackageJson type get a raw
	// (JSON) editor so nothing is hidden or uneditable.
	const catalogNames = new Set(catalog.map((field) => field.name));
	const extras: FieldNode[] = Object.keys(current)
		.filter((name) => !catalogNames.has(name))
		.map((name) => ({
			description: '',
			name,
			optional: true,
			schema: { kind: 'opaque', typeText: 'json' }
		}));

	const fields = [...catalog, ...extras].sort((left, right) =>
		left.name.localeCompare(right.name)
	);

	return { configPath, current, fields, scripts };
};
