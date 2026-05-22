import { createJiti } from 'jiti';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
	type AstNode,
	evaluateNode,
	findConfigElements,
	findProperty,
	isNode,
	objectProperties,
	parseConfigSource
} from './configAst';
import { getRecord, getString, isMap, isRecord } from './guards';
import type {
	ConfigBlock,
	ConfiguredRule,
	EffectiveRule,
	RuleCatalog,
	RuleMeta,
	RuleSeverity
} from '../../../../types/eslintStudio';

const CONFIG_CANDIDATES = [
	'eslint.config.js',
	'eslint.config.mjs',
	'eslint.config.cjs',
	'eslint.config.ts',
	'eslint.config.mts',
	'eslint.config.cts'
];

/** Files we probe for `calculateConfigForFile`; the first that exists wins. */
const REPRESENTATIVE_CANDIDATES = [
	'src/index.ts',
	'src/index.tsx',
	'src/main.ts',
	'src/main.tsx',
	'src/app.ts',
	'index.ts'
];

export const findConfigPath = (cwd: string) => {
	for (const name of CONFIG_CANDIDATES) {
		const candidate = resolve(cwd, name);
		if (existsSync(candidate)) return candidate;
	}

	return null;
};

const pickRepresentativeFile = (cwd: string) => {
	for (const candidate of REPRESENTATIVE_CANDIDATES) {
		const resolved = resolve(cwd, candidate);
		if (existsSync(resolved)) return resolved;
	}

	return resolve(cwd, 'src/index.ts');
};

const normalizeSeverity = (value: unknown): RuleSeverity => {
	if (value === 0 || value === 'off') return 'off';
	if (value === 1 || value === 'warn') return 'warn';

	return 'error';
};

const buildMeta = (
	name: string,
	source: string,
	shortName: string,
	definition: unknown
) => {
	const meta = getRecord(definition, 'meta');
	const docs = getRecord(meta, 'docs');

	const ruleMeta: RuleMeta = {
		deprecated: Boolean(meta?.deprecated),
		description: getString(docs, 'description'),
		docsUrl: getString(docs, 'url'),
		fixable: getString(meta, 'fixable'),
		hasSuggestions: Boolean(meta?.hasSuggestions),
		name,
		schema: meta?.schema ?? null,
		shortName,
		source,
		type: getString(meta, 'type')
	};

	return ruleMeta;
};

const collectPluginMeta = (
	runtimeConfig: unknown[],
	metaByName: Map<string, RuleMeta>
) => {
	for (const block of runtimeConfig) {
		const plugins = getRecord(block, 'plugins');
		if (!plugins) continue;

		for (const [prefix, plugin] of Object.entries(plugins)) {
			const rules = getRecord(plugin, 'rules');
			if (!rules) continue;

			for (const [shortName, definition] of Object.entries(rules)) {
				const fullName = `${prefix}/${shortName}`;
				if (metaByName.has(fullName)) continue;
				metaByName.set(
					fullName,
					buildMeta(fullName, prefix, shortName, definition)
				);
			}
		}
	}
};

const collectCoreMeta = async (metaByName: Map<string, RuleMeta>) => {
	const mod: unknown = await import('eslint/use-at-your-own-risk');
	const builtinRules = isRecord(mod) ? mod.builtinRules : null;
	if (!isMap(builtinRules)) return;

	for (const [key, definition] of builtinRules) {
		if (typeof key !== 'string' || metaByName.has(key)) continue;
		metaByName.set(key, buildMeta(key, 'core', key, definition));
	}
};

const collectMeta = async (runtimeConfig: unknown[]) => {
	const metaByName = new Map<string, RuleMeta>();
	collectPluginMeta(runtimeConfig, metaByName);
	await collectCoreMeta(metaByName);

	return Array.from(metaByName.values()).sort((left, right) =>
		left.name.localeCompare(right.name)
	);
};

const flattenStrings = (value: unknown): string[] => {
	if (typeof value === 'string') return [value];
	if (!Array.isArray(value)) return [];

	return value.flatMap((entry) => flattenStrings(entry));
};

const toNode = (value: unknown) => (isNode(value) ? value : null);

const readFilePatterns = (block: AstNode) => {
	const filesProperty = findProperty(block, 'files');
	if (!filesProperty) return [];
	const evaluated = evaluateNode(toNode(filesProperty.value));

	return evaluated.isStatic ? flattenStrings(evaluated.value) : [];
};

const labelForBlock = (
	files: string[],
	isGlobalIgnore: boolean,
	hasRules: boolean
) => {
	if (isGlobalIgnore) return 'Global ignores';
	if (files.length > 0) return files.join(', ');

	return hasRules ? 'All files' : 'Shared options';
};

const readConfiguredRule = (property: AstNode, source: string) => {
	const name = ruleName(property);
	if (name === null) return null;
	const valueNode = toNode(property.value);
	if (!valueNode) return null;

	const severityAndOptions = readSeverityAndOptions(valueNode);
	const configuredRule: ConfiguredRule = {
		name,
		options: severityAndOptions.options,
		rawValue: source.slice(valueNode.range[0], valueNode.range[1]),
		severity: severityAndOptions.severity
	};

	return configuredRule;
};

const ruleName = (property: AstNode) => {
	const { key } = property;
	if (!isRecord(key)) return null;
	if (key.type === 'Identifier' && typeof key.name === 'string') {
		return key.name;
	}
	if (key.type === 'Literal' && typeof key.value === 'string') {
		return key.value;
	}

	return null;
};

const readSeverityAndOptions = (valueNode: AstNode) => {
	if (valueNode.type !== 'ArrayExpression') {
		return {
			options: [],
			severity: normalizeSeverity(evaluateNode(valueNode).value)
		};
	}

	const evaluated = evaluateNode(valueNode);
	if (evaluated.isStatic && Array.isArray(evaluated.value)) {
		const [severity, ...options] = evaluated.value;

		return { options, severity: normalizeSeverity(severity) };
	}

	const elements = Array.isArray(valueNode.elements)
		? valueNode.elements
		: [];
	const [first] = elements;

	return {
		options: [],
		severity: normalizeSeverity(evaluateNode(toNode(first)).value)
	};
};

const parseBlock = (element: AstNode, sourceIndex: number, source: string) => {
	const files = readFilePatterns(element);
	const rulesProperty = findProperty(element, 'rules');
	const hasIgnores = findProperty(element, 'ignores') !== null;
	const rulesObject =
		rulesProperty && isRecord(rulesProperty.value)
			? toNode(rulesProperty.value)
			: null;
	const rules: ConfiguredRule[] = [];
	if (rulesObject) {
		for (const property of objectProperties(rulesObject)) {
			const configured = readConfiguredRule(property, source);
			if (configured) rules.push(configured);
		}
	}

	const isGlobalIgnore =
		hasIgnores && rules.length === 0 && files.length === 0;
	const block: ConfigBlock = {
		files,
		isGlobalIgnore,
		label: labelForBlock(files, isGlobalIgnore, rules.length > 0),
		rules,
		sourceIndex
	};

	return block;
};

const parseSourceBlocks = (source: string) => {
	const ast = parseConfigSource(source);
	const elements = findConfigElements(ast);
	if (!elements) return [];

	const blocks: ConfigBlock[] = [];
	elements.forEach((element, index) => {
		if (element.type !== 'ObjectExpression') return;
		blocks.push(parseBlock(element, index, source));
	});

	return blocks;
};

const toEffectiveRule = (name: string, value: unknown) => {
	if (Array.isArray(value)) {
		const [severity, ...options] = value;
		const effective: EffectiveRule = {
			name,
			options,
			severity: normalizeSeverity(severity)
		};

		return effective;
	}

	const effective: EffectiveRule = {
		name,
		options: [],
		severity: normalizeSeverity(value)
	};

	return effective;
};

const resolveEffectiveRules = async (cwd: string, file: string) => {
	const eslintModule = await import('eslint');
	const linter = new eslintModule.ESLint({ cwd });
	try {
		const config: unknown = await linter.calculateConfigForFile(file);
		const rules = getRecord(config, 'rules');
		if (!rules) return [];

		return Object.entries(rules).map(([name, value]) =>
			toEffectiveRule(name, value)
		);
	} catch {
		return [];
	}
};

export const resolveRuleCatalog = async (cwd: string, fileScope?: string) => {
	const configPath = findConfigPath(cwd);
	if (!configPath) {
		throw new Error(
			`No flat ESLint config found in ${cwd}. Expected one of: ${CONFIG_CANDIDATES.join(', ')}`
		);
	}

	const jiti = createJiti(import.meta.url);
	const loaded: unknown = await jiti.import(configPath);
	const exported = isRecord(loaded) ? loaded.default : loaded;
	const runtimeConfig = Array.isArray(exported) ? exported : [];

	const source = readFileSync(configPath, 'utf-8');
	const representativeFile =
		fileScope && fileScope.trim() !== ''
			? resolve(cwd, fileScope.trim())
			: pickRepresentativeFile(cwd);

	const [meta, effective] = await Promise.all([
		collectMeta(runtimeConfig),
		resolveEffectiveRules(cwd, representativeFile)
	]);

	const catalog: RuleCatalog = {
		blocks: parseSourceBlocks(source),
		configPath,
		effective,
		generatedAt: new Date().toISOString(),
		meta,
		representativeFile
	};

	return catalog;
};
