import ts from 'typescript';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { introspectType } from '../schema/fromType';

const AUTH_PACKAGE = '@absolutejs/auth';
const CONFIG_CANDIDATES = [
	'auth.config.ts',
	'auth.config.js',
	'auth.config.mjs'
];

export const findAuthSettingsPath = (cwd: string, override?: string) => {
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

// Locate the object literal passed to defineAuthSettings({...}) — or a bare default
// export object — so the reader and the editor work off the same node. Annotated
// because `found` is assigned inside the nested closure (flow analysis ignores it).
export const findAuthSettingsObject = (
	sourceFile: ts.Node
): ts.ObjectLiteralExpression | null => {
	let found: ts.ObjectLiteralExpression | null = null;

	const visit = (node: ts.Node) => {
		if (found) return;
		const [firstArgument] = ts.isCallExpression(node)
			? node.arguments
			: [];
		if (
			ts.isCallExpression(node) &&
			ts.isIdentifier(node.expression) &&
			node.expression.text === 'defineAuthSettings' &&
			firstArgument &&
			ts.isObjectLiteralExpression(firstArgument)
		) {
			found = firstArgument;

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

export const parseAuthSettingsObject = (configPath: string) => {
	const text = readFileSync(configPath, 'utf-8');

	return {
		object: findAuthSettingsObject(parseSource(configPath, text)),
		text
	};
};

// Recursively evaluate a literal initializer to a JSON value; opaque for anything
// that isn't pure data (identifier refs, calls, spreads) so we never clobber code.
const evalLiteral = (
	node: ts.Expression
): { opaque: boolean; value: unknown } => {
	if (ts.isStringLiteralLike(node)) return { opaque: false, value: node.text };
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

	return { opaque: true, value: undefined };
};

const readCurrent = (configPath: string) => {
	const current: Record<string, unknown> = {};
	const opaqueKeys: string[] = [];
	const { object } = parseAuthSettingsObject(configPath);
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

export const resolveAuthSettingsState = (cwd: string, override?: string) => {
	const configPath = findAuthSettingsPath(cwd, override);
	const fields = introspectType(cwd, 'AuthSettings', new Set(), AUTH_PACKAGE);
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
