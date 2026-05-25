import ts from 'typescript';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { introspectType } from '../schema/fromType';

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

export const findConfigPath = (cwd: string, override?: string) => {
	if (override) {
		const resolved = resolve(cwd, override);

		return existsSync(resolved) ? resolved : null;
	}
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

// Recursively evaluate a literal initializer to a JSON value. Returns opaque
// for anything that isn't pure data (identifier refs like `appProviders`, calls,
// spreads, template expressions) — those stay file-only so we never clobber code.
const evalLiteral = (
	node: ts.Expression
): { opaque: boolean; value: unknown } => {
	if (ts.isStringLiteralLike(node)) {
		return { opaque: false, value: node.text };
	}
	if (node.kind === ts.SyntaxKind.TrueKeyword) {
		return { opaque: false, value: true };
	}
	if (node.kind === ts.SyntaxKind.FalseKeyword) {
		return { opaque: false, value: false };
	}
	if (node.kind === ts.SyntaxKind.NullKeyword) {
		return { opaque: false, value: null };
	}
	if (ts.isNumericLiteral(node)) {
		return { opaque: false, value: Number(node.text) };
	}
	if (
		ts.isPrefixUnaryExpression(node) &&
		node.operator === ts.SyntaxKind.MinusToken &&
		ts.isNumericLiteral(node.operand)
	) {
		return { opaque: false, value: -Number(node.operand.text) };
	}
	if (ts.isArrayLiteralExpression(node)) {
		const items: unknown[] = [];
		for (const element of node.elements) {
			const result = evalLiteral(element);
			if (result.opaque) return { opaque: true, value: undefined };
			items.push(result.value);
		}

		return { opaque: false, value: items };
	}
	if (ts.isObjectLiteralExpression(node)) {
		const object: Record<string, unknown> = {};
		for (const property of node.properties) {
			if (
				!ts.isPropertyAssignment(property) ||
				!(
					ts.isIdentifier(property.name) ||
					ts.isStringLiteral(property.name)
				)
			) {
				return { opaque: true, value: undefined };
			}
			const result = evalLiteral(property.initializer);
			if (result.opaque) return { opaque: true, value: undefined };
			object[property.name.text] = result.value;
		}

		return { opaque: false, value: object };
	}

	return { opaque: true, value: undefined };
};

const readCurrent = (configPath: string) => {
	const current: Record<string, unknown> = {};
	const opaqueKeys: string[] = [];
	const { object } = parseConfigObject(configPath);
	if (!object) return { current, opaqueKeys };

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
		const result = evalLiteral(property.initializer);
		if (result.opaque) opaqueKeys.push(name);
		else current[name] = result.value;
	}

	return { current, opaqueKeys };
};

// The configured values only (no BaseBuildConfig type introspection) — for callers
// like the integrations engine that just need to read/flip a known field.
export const readAbsoluteConfigValues = (cwd: string, override?: string) => {
	const configPath = findConfigPath(cwd, override);
	const { current, opaqueKeys } = configPath
		? readCurrent(configPath)
		: { current: {}, opaqueKeys: [] };

	return { configPath, current, opaqueKeys };
};

export const resolveAbsoluteConfigState = (cwd: string, override?: string) => {
	const configPath = findConfigPath(cwd, override);
	const fields = introspectType(cwd, 'BaseBuildConfig', RUNTIME_FIELDS);
	const { current, opaqueKeys } = configPath
		? readCurrent(configPath)
		: { current: {}, opaqueKeys: [] };

	return {
		available: fields.length > 0,
		configPath,
		current,
		fields,
		opaqueKeys
	};
};
