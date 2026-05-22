import ts from 'typescript';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isRecord } from '../guards';
import type { TsOption } from '../../../../types/tsconfig';

const CONFIG_CANDIDATES = ['tsconfig.json', 'jsconfig.json'];

// Categories that only make sense as CLI flags, not in a tsconfig editor.
const SKIP_CATEGORIES = new Set([
	'Command-line Options',
	'Watch and Build Modes'
]);

export const findTsconfigPath = (cwd: string) => {
	for (const name of CONFIG_CANDIDATES) {
		const candidate = resolve(cwd, name);
		if (existsSync(candidate)) return candidate;
	}

	return null;
};

// `ts.readConfigFile` tolerates JSONC comments and returns the literal parsed
// object — exactly the values written in the file, before `extends`/defaults.
const readCompilerOptions = (configPath: string) => {
	const parsed = ts.readConfigFile(configPath, (path) => {
		try {
			return readFileSync(path, 'utf-8');
		} catch {
			return undefined;
		}
	});
	const { config } = parsed;
	if (!isRecord(config)) return {};
	const { compilerOptions } = config;

	return isRecord(compilerOptions) ? compilerOptions : {};
};

const messageOf = (value: unknown) =>
	isRecord(value) && typeof value.message === 'string' ? value.message : '';

const classify = (declaration: Record<string, unknown>) => {
	const { type } = declaration;
	if (type === 'boolean') return { enumValues: [], kind: 'boolean' as const };
	if (type === 'number') return { enumValues: [], kind: 'number' as const };
	if (type === 'string') return { enumValues: [], kind: 'string' as const };
	if (type instanceof Map) {
		return {
			enumValues: [...type.keys()].map(String),
			kind: 'enum' as const
		};
	}
	if (type === 'list' || type === 'listOrElement') {
		const { element } = declaration;
		const elementType = isRecord(element) ? element.type : undefined;

		return {
			enumValues:
				elementType instanceof Map
					? [...elementType.keys()].map(String)
					: [],
			kind: 'list' as const
		};
	}

	return null;
};

const defaultLabelOf = (declaration: Record<string, unknown>) => {
	const value = declaration.defaultValueDescription;
	if (value === undefined || value === null) return '';
	if (typeof value === 'object') return messageOf(value);

	return String(value);
};

// `optionDeclarations` is TypeScript's internal catalog of every compiler
// option with its type, category, and description — richer and always current
// versus a hand-maintained list. Reached structurally since it isn't in the
// published types.
const buildOptions = () => {
	const raw: unknown = Reflect.get(ts, 'optionDeclarations');
	const declarations: unknown[] = Array.isArray(raw) ? raw : [];
	const options: TsOption[] = [];

	for (const declaration of declarations) {
		if (!isRecord(declaration) || typeof declaration.name !== 'string') {
			continue;
		}
		if (declaration.isCommandLineOnly === true) continue;
		const category = messageOf(declaration.category);
		if (category === '' || SKIP_CATEGORIES.has(category)) continue;
		const classified = classify(declaration);
		if (!classified) continue;

		options.push({
			category,
			defaultLabel: defaultLabelOf(declaration),
			description: messageOf(declaration.description),
			enumValues: classified.enumValues,
			kind: classified.kind,
			name: declaration.name
		});
	}

	return options.sort((left, right) => left.name.localeCompare(right.name));
};

export const resolveTsconfigState = (cwd: string) => {
	const configPath = findTsconfigPath(cwd);
	const current = configPath ? readCompilerOptions(configPath) : {};
	const options = buildOptions();
	const categories = [
		...new Set(options.map((option) => option.category))
	].sort();

	return { categories, configPath, current, options };
};
