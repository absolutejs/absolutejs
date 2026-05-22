import * as espree from 'espree';

/** Minimal structural view of an ESTree node. We treat the AST as plain
 *  records (espree ships no bundled types) and narrow on `type` + `range`,
 *  which `parseConfigSource` always populates. */
export type AstNode = {
	range: [number, number];
	type: string;
	[key: string]: unknown;
};

export type StaticValue = {
	isStatic: boolean;
	value: unknown;
};

const ESPREE_OPTIONS = {
	ecmaVersion: 'latest',
	loc: false,
	range: true,
	sourceType: 'module'
} as const;

export const isNode = (value: unknown): value is AstNode =>
	typeof value === 'object' &&
	value !== null &&
	typeof Reflect.get(value, 'type') === 'string' &&
	Array.isArray(Reflect.get(value, 'range'));

const asNode = (value: unknown) => (isNode(value) ? value : null);

const asNodeArray = (value: unknown) => {
	if (!Array.isArray(value)) return [];

	return value.filter(isNode);
};

export const findConfigElements = (ast: unknown) => {
	const program = asNode(ast);
	if (!program) return null;

	for (const statement of asNodeArray(program.body)) {
		if (statement.type !== 'ExportDefaultDeclaration') continue;

		const declaration = asNode(statement.declaration);
		if (!declaration) continue;

		if (declaration.type === 'ArrayExpression') {
			return asNodeArray(declaration.elements);
		}

		if (
			declaration.type === 'CallExpression' &&
			isNode(declaration.callee) &&
			declaration.callee.type === 'Identifier' &&
			declaration.callee.name === 'defineConfig'
		) {
			const [firstArg] = asNodeArray(declaration.arguments);
			if (firstArg?.type === 'ArrayExpression') {
				return asNodeArray(firstArg.elements);
			}
		}
	}

	return null;
};
export const parseConfigSource = (source: string) =>
	espree.parse(source, ESPREE_OPTIONS);

const propertyKeyName = (property: AstNode) => {
	const key = asNode(property.key);
	if (!key) return null;
	if (key.type === 'Identifier' && typeof key.name === 'string') {
		return key.name;
	}
	if (key.type === 'Literal' && typeof key.value === 'string') {
		return key.value;
	}

	return null;
};

export const evaluateNode = (node: AstNode | null): StaticValue => {
	if (!node) return { isStatic: true, value: undefined };

	if (node.type === 'Literal') {
		return { isStatic: true, value: node.value };
	}

	if (node.type === 'Identifier' && node.name === 'undefined') {
		return { isStatic: true, value: undefined };
	}

	if (
		node.type === 'UnaryExpression' &&
		node.operator === '-' &&
		isNode(node.argument) &&
		node.argument.type === 'Literal' &&
		typeof node.argument.value === 'number'
	) {
		return { isStatic: true, value: -node.argument.value };
	}

	if (node.type === 'TemplateLiteral') {
		const quasis = asNodeArray(node.quasis);
		const expressions = asNodeArray(node.expressions);
		const [firstQuasi] = quasis;
		if (expressions.length === 0 && firstQuasi) {
			const cooked = Reflect.get(firstQuasi, 'value');
			if (typeof cooked === 'object' && cooked !== null) {
				return { isStatic: true, value: Reflect.get(cooked, 'cooked') };
			}
		}

		return { isStatic: false, value: undefined };
	}

	if (node.type === 'ArrayExpression') {
		return evaluateArray(node);
	}

	if (node.type === 'ObjectExpression') {
		return evaluateObject(node);
	}

	return { isStatic: false, value: undefined };
};
export const findProperty = (objectNode: AstNode, key: string) => {
	for (const property of asNodeArray(objectNode.properties)) {
		if (property.type !== 'Property') continue;
		if (propertyKeyName(property) === key) return property;
	}

	return null;
};
export const objectProperties = (objectNode: AstNode) =>
	asNodeArray(objectNode.properties).filter(
		(property) => property.type === 'Property'
	);

const evaluateArray = (node: AstNode): StaticValue => {
	const result: unknown[] = [];
	for (const element of asNodeArray(node.elements)) {
		const evaluated = evaluateNode(element);
		if (!evaluated.isStatic) return { isStatic: false, value: undefined };
		result.push(evaluated.value);
	}

	return { isStatic: true, value: result };
};

const evaluateObject = (node: AstNode): StaticValue => {
	const result: Record<string, unknown> = {};
	for (const property of asNodeArray(node.properties)) {
		if (property.type !== 'Property' || property.computed === true) {
			return { isStatic: false, value: undefined };
		}
		const key = propertyKeyName(property);
		if (key === null) return { isStatic: false, value: undefined };
		const evaluated = evaluateNode(asNode(property.value));
		if (!evaluated.isStatic) return { isStatic: false, value: undefined };
		result[key] = evaluated.value;
	}

	return { isStatic: true, value: result };
};
