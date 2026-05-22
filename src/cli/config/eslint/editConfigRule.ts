import MagicString from 'magic-string';
import { readFileSync, writeFileSync } from 'node:fs';
import {
	type AstNode,
	findConfigElements,
	findProperty,
	isNode,
	objectProperties,
	parseConfigSource
} from './configAst';
import { isRecord } from '../guards';
import { serializeRuleValue } from './serializeValue';
import type { RuleEditRequest } from '../../../../types/eslintConfig';

export type EditOutcome = {
	message: string | null;
	ok: boolean;
};

const failure = (message: string) => {
	const outcome: EditOutcome = { message, ok: false };

	return outcome;
};

const success = () => {
	const outcome: EditOutcome = { message: null, ok: true };

	return outcome;
};

/** Leading whitespace of the line containing `offset` — used to indent
 *  inserted entries to match their siblings. */
const lineIndent = (source: string, offset: number) => {
	const lineStart = source.lastIndexOf('\n', offset - 1) + 1;
	const match = /^[ \t]*/.exec(source.slice(lineStart, offset));

	return match ? match[0] : '';
};

const ruleNameOf = (property: AstNode) => {
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

const updateExistingRule = (
	property: AstNode,
	request: RuleEditRequest,
	magic: MagicString
) => {
	const valueNode = isNode(property.value) ? property.value : null;
	if (!valueNode) return failure(`Could not read value for ${request.name}.`);

	// `options === undefined` means "only change severity" — preserve any
	// existing option nodes by overwriting just the severity slot.
	if (request.options === undefined) {
		if (valueNode.type === 'ArrayExpression') {
			const [first] = Array.isArray(valueNode.elements)
				? valueNode.elements
				: [];
			if (isNode(first)) {
				magic.overwrite(
					first.range[0],
					first.range[1],
					serializeRuleValue(request.severity, [])
				);

				return success();
			}
		}
		magic.overwrite(
			valueNode.range[0],
			valueNode.range[1],
			serializeRuleValue(request.severity, [])
		);

		return success();
	}

	magic.overwrite(
		valueNode.range[0],
		valueNode.range[1],
		serializeRuleValue(request.severity, request.options)
	);

	return success();
};

const insertIntoRulesObject = (
	rulesObject: AstNode,
	request: RuleEditRequest,
	magic: MagicString,
	source: string
) => {
	const entry = `'${request.name}': ${serializeRuleValue(request.severity, request.options ?? [])}`;
	const properties = objectProperties(rulesObject);

	if (properties.length === 0) {
		const indent = `${lineIndent(source, rulesObject.range[0])}\t`;
		magic.appendLeft(
			rulesObject.range[0] + 1,
			`\n${indent}${entry}\n${lineIndent(source, rulesObject.range[0])}`
		);

		return success();
	}

	const anchor = properties.find(
		(property) => (ruleNameOf(property) ?? '') > request.name
	);
	if (anchor) {
		const indent = lineIndent(source, anchor.range[0]);
		magic.appendLeft(anchor.range[0], `${entry},\n${indent}`);

		return success();
	}

	const last = properties[properties.length - 1];
	if (!last)
		return failure(`Could not anchor insertion for ${request.name}.`);
	const indent = lineIndent(source, last.range[0]);
	magic.appendRight(last.range[1], `,\n${indent}${entry}`);

	return success();
};

const addRulesObject = (
	block: AstNode,
	request: RuleEditRequest,
	magic: MagicString,
	source: string
) => {
	const properties = objectProperties(block);
	const entry = `'${request.name}': ${serializeRuleValue(request.severity, request.options ?? [])}`;
	const innerIndent = `${lineIndent(source, block.range[0])}\t`;
	const rulesBlock = `rules: {\n${innerIndent}\t${entry}\n${innerIndent}}`;

	if (properties.length === 0) {
		magic.appendLeft(
			block.range[0] + 1,
			`\n${innerIndent}${rulesBlock}\n${lineIndent(source, block.range[0])}`
		);

		return success();
	}

	const last = properties[properties.length - 1];
	if (!last)
		return failure(
			`Could not anchor a new rules block for ${request.name}.`
		);
	const indent = lineIndent(source, last.range[0]);
	magic.appendRight(last.range[1], `,\n${indent}${rulesBlock}`);

	return success();
};

const editBlock = (
	block: AstNode,
	request: RuleEditRequest,
	magic: MagicString,
	source: string
) => {
	const rulesProperty = findProperty(block, 'rules');
	if (!rulesProperty || !isNode(rulesProperty.value)) {
		return addRulesObject(block, request, magic, source);
	}

	const rulesObject = rulesProperty.value;
	if (rulesObject.type !== 'ObjectExpression') {
		return failure('The `rules` field is not an object literal.');
	}

	const existing = findProperty(rulesObject, request.name);
	if (existing) {
		return updateExistingRule(existing, request, magic);
	}

	return insertIntoRulesObject(rulesObject, request, magic, source);
};

export const applyRuleEdit = (configPath: string, request: RuleEditRequest) => {
	const source = readFileSync(configPath, 'utf-8');
	const elements = findConfigElements(parseConfigSource(source));
	if (!elements) {
		return failure('Could not locate the config array in the file.');
	}

	const block = elements[request.sourceIndex];
	if (!block || block.type !== 'ObjectExpression') {
		return failure(
			`Config block ${request.sourceIndex} is not an editable object.`
		);
	}

	const magic = new MagicString(source);
	const outcome = editBlock(block, request, magic, source);
	if (!outcome.ok) return outcome;

	writeFileSync(configPath, magic.toString());

	return success();
};
