import { parse } from 'jsonc-parser';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isRecord } from '../guards';
import type {
	PackageField,
	PackageFieldKind,
	PackageScript
} from '../../../../types/packageJson';

export const findPackageJsonPath = (cwd: string) => {
	const candidate = resolve(cwd, 'package.json');

	return existsSync(candidate) ? candidate : null;
};

const classify = (value: unknown): PackageFieldKind => {
	if (typeof value === 'boolean') return 'boolean';
	if (typeof value === 'number') return 'number';
	if (typeof value === 'string') return 'string';

	return 'complex';
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
	const pkg = configPath ? readPackage(configPath) : null;
	if (!pkg) return { configPath, fields: [], scripts: [] };

	const scripts: PackageScript[] = isRecord(pkg.scripts)
		? Object.entries(pkg.scripts)
				.filter(([, command]) => typeof command === 'string')
				.map(([name, command]) => ({ command: String(command), name }))
		: [];

	const fields: PackageField[] = Object.entries(pkg)
		.filter(([name]) => name !== 'scripts')
		.map(([name, value]) => {
			const kind = classify(value);

			return { kind, name, value: kind === 'complex' ? null : value };
		});

	return { configPath, fields, scripts };
};
