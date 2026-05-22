import ts from 'typescript';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { introspectType } from '../introspectType';

const CONFIG_CANDIDATES = [
	'absolute.config.ts',
	'absolute.config.js',
	'absolute.config.mjs'
];

// Members injected by the CLI/runtime, not written in defineConfig({...}).
const RUNTIME_FIELDS = new Set([
	'cwd',
	'config',
	'entry',
	'mode',
	'incrementalFiles'
]);

export const findConfigPath = (cwd: string) => {
	for (const name of CONFIG_CANDIDATES) {
		const candidate = resolve(cwd, name);
		if (existsSync(candidate)) return candidate;
	}

	return null;
};

const parseSource = (configPath: string, text: string) =>
	ts.createSourceFile(configPath, text, ts.ScriptTarget.Latest, true);

// Locate the object literal passed to defineConfig({...}) — or a bare default
// export object — so both the reader and the editor work off the same node.
// Return type is annotated because `found` is assigned inside a nested closure,
// which TS's flow analysis ignores when inferring (it would infer `null`).
export const findConfigObject = (
	sourceFile: ts.Node
): ts.ObjectLiteralExpression | null => {
	let found: ts.ObjectLiteralExpression | null = null;

	const visit = (node: ts.Node) => {
		if (found) return;
		if (
			ts.isCallExpression(node) &&
			ts.isIdentifier(node.expression) &&
			node.expression.text === 'defineConfig' &&
			node.arguments[0] &&
			ts.isObjectLiteralExpression(node.arguments[0])
		) {
			found = node.arguments[0];

			return;
		}
		if (
			ts.isExportAssignment(node) &&
			ts.isObjectLiteralExpression(node.expression)
		) {
			found = node.expression;

			return;
		}
		ts.forEachChild(node, visit);
	};
	visit(sourceFile);

	return found;
};

export const parseConfigObject = (configPath: string) => {
	const text = readFileSync(configPath, 'utf-8');

	return { object: findConfigObject(parseSource(configPath, text)), text };
};

const scalarValue = (initializer: ts.Expression) => {
	if (ts.isStringLiteralLike(initializer)) {
		return { complex: false, value: initializer.text };
	}
	if (initializer.kind === ts.SyntaxKind.TrueKeyword) {
		return { complex: false, value: true };
	}
	if (initializer.kind === ts.SyntaxKind.FalseKeyword) {
		return { complex: false, value: false };
	}
	if (ts.isNumericLiteral(initializer)) {
		return { complex: false, value: Number(initializer.text) };
	}
	if (
		ts.isPrefixUnaryExpression(initializer) &&
		initializer.operator === ts.SyntaxKind.MinusToken &&
		ts.isNumericLiteral(initializer.operand)
	) {
		return { complex: false, value: -Number(initializer.operand.text) };
	}

	return { complex: true, value: undefined };
};

const readCurrent = (configPath: string) => {
	const current: Record<string, unknown> = {};
	const complexKeys: string[] = [];
	const { object } = parseConfigObject(configPath);
	if (!object) return { complexKeys, current };

	for (const property of object.properties) {
		if (
			!ts.isPropertyAssignment(property) ||
			!(
				ts.isIdentifier(property.name) ||
				ts.isStringLiteral(property.name)
			)
		) {
			continue;
		}
		const name = property.name.text;
		const scalar = scalarValue(property.initializer);
		if (scalar.complex) complexKeys.push(name);
		else current[name] = scalar.value;
	}

	return { complexKeys, current };
};

export const resolveAbsoluteConfigState = (cwd: string) => {
	const configPath = findConfigPath(cwd);
	const fields = introspectType(cwd, 'BaseBuildConfig', RUNTIME_FIELDS);
	const { complexKeys, current } = configPath
		? readCurrent(configPath)
		: { complexKeys: [], current: {} };

	// A union field that currently holds an object/array stays read-only so a
	// typed scalar can't clobber the structure.
	const complexSet = new Set(complexKeys);
	const adjusted = fields.map((field) =>
		complexSet.has(field.name) && field.kind !== 'complex'
			? { ...field, kind: 'complex' as const }
			: field
	);

	return {
		available: fields.length > 0,
		complexKeys,
		configPath,
		current,
		fields: adjusted
	};
};
