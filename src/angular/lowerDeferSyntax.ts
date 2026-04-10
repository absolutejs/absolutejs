import { BASE_36_RADIX, MILLISECONDS_IN_A_SECOND } from '../constants';

export type LoweredAngularDeferSlot = {
	delayMs: number;
	errorHtml: string | null;
	fallbackHtml: string;
	id: string;
	resolvedBindings: Array<{
		expression: string;
		key: string;
	}>;
	resolvedHtml: string;
	resolvedTemplate: string;
};

export type LoweredAngularDeferResult = {
	slots: LoweredAngularDeferSlot[];
	template: string;
	transformed: boolean;
};

const isInterpolatedExpressionStart = (value: string, index: number) =>
	value[index] === '{' && value[index + 1] === '{';

const skipInterpolatedExpression = (value: string, start: number) => {
	const cursor = start + 2;
	while (cursor < value.length - 1) {
		const end = value.indexOf('}}', cursor);
		if (end < 0) {
			return value.length;
		}

		return end + 2;
	}

	return value.length;
};

const updateBlockDepth = (char: string, depth: number) => {
	if (char === '{') {
		return depth + 1;
	}

	if (char === '}') {
		return depth - 1;
	}

	return depth;
};

const updateParenthesisDepth = (char: string, depth: number) => {
	if (char === '(') {
		return depth + 1;
	}

	if (char === ')') {
		return depth - 1;
	}

	return depth;
};

const appendResolvedChunk = (
	value: string,
	template: string,
	cursor: number,
	interpolationStart: number
) => {
	const nextTemplate = template + value.slice(cursor, interpolationStart);
	const nextCursor = skipInterpolatedExpression(value, interpolationStart);
	if (nextCursor > value.length) {
		return {
			bindings: undefined,
			cursor: value.length,
			done: true,
			template: nextTemplate + value.slice(interpolationStart)
		};
	}

	const expression = value
		.slice(interpolationStart + 2, nextCursor - 2)
		.trim();

	return {
		bindings: expression,
		cursor: nextCursor,
		done: false,
		template: nextTemplate
	};
};

const appendTrailingTemplate = (
	value: string,
	template: string,
	cursor: number
) => template + value.slice(cursor);

const consumeDeferredAuxiliaryBlock = (input: {
	cursorAfterResolved: number;
	keyword: '@error' | '@placeholder';
	template: string;
}) => {
	const parsedBlock = parseDeferredAuxiliaryBlock(
		input.template,
		input.cursorAfterResolved,
		input.keyword
	);
	if (!parsedBlock) {
		return null;
	}

	return {
		content: parsedBlock.content.trim(),
		nextIndex:
			input.keyword === '@placeholder'
				? skipWhitespace(input.template, parsedBlock.nextIndex)
				: parsedBlock.nextIndex
	};
};

const resolveDeferSlotStart = (
	template: string,
	deferIndex: number,
	markerCursor: number
) => {
	const nextMarkerCursor = skipWhitespace(template, markerCursor);
	if (template[nextMarkerCursor] === '{') {
		return {
			changed: false,
			cursor: deferIndex,
			markerCursor: nextMarkerCursor,
			templatePrefix: ''
		};
	}

	return {
		changed: true,
		cursor: deferIndex + '@defer'.length,
		markerCursor: nextMarkerCursor,
		templatePrefix: '&#64;defer'
	};
};

const consumeBlockCursor = (
	value: string,
	start: number,
	cursor: number,
	depth: number
) => {
	if (isInterpolatedExpressionStart(value, cursor)) {
		return {
			cursor: skipInterpolatedExpression(value, cursor),
			depth,
			result: null
		};
	}

	const char = value[cursor] ?? '';
	const nextDepth = updateBlockDepth(char, depth);
	if (char === '}' && nextDepth === 0) {
		return {
			cursor,
			depth,
			result: {
				content: value.slice(start + 1, cursor),
				nextIndex: cursor + 1
			}
		};
	}

	return {
		cursor: cursor + 1,
		depth: nextDepth,
		result: null
	};
};

const consumeResolvedTemplateChunk = (
	value: string,
	template: string,
	cursor: number,
	bindingsLength: number
) => {
	const interpolationStart = value.indexOf('{{', cursor);
	if (interpolationStart < 0) {
		return {
			binding: null,
			cursor,
			done: true,
			template: appendTrailingTemplate(value, template, cursor)
		};
	}

	const nextChunk = appendResolvedChunk(
		value,
		template,
		cursor,
		interpolationStart
	);
	if (nextChunk.done || nextChunk.bindings === undefined) {
		return {
			binding: null,
			cursor,
			done: true,
			template: nextChunk.template
		};
	}

	const key = `e${bindingsLength.toString(BASE_36_RADIX)}`;

	return {
		binding: {
			expression: nextChunk.bindings,
			key
		},
		cursor: nextChunk.cursor,
		done: false,
		template: `${nextChunk.template}{{ slotData["${key}"] }}`
	};
};

const readNextDeferBlock = (template: string, cursor: number) => {
	const deferIndex = template.indexOf('@defer', cursor);
	if (deferIndex < 0) {
		return null;
	}

	return {
		deferIndex,
		prefix: template.slice(cursor, deferIndex)
	};
};

const buildDeferredSlot = (input: {
	cursorAfterResolved: number;
	errorHtml: string | null;
	placeholderHtml: string;
	resolvedBlock: { content: string; nextIndex: number };
	slotIndex: number;
	triggerExpression: string | undefined;
}) => {
	const {
		cursorAfterResolved,
		errorHtml,
		placeholderHtml,
		resolvedBlock,
		slotIndex,
		triggerExpression
	} = input;
	const resolvedHtml = resolvedBlock.content.trim();
	const transformedResolved = transformResolvedTemplate(resolvedHtml);
	const id = `absolute-angular-defer-${slotIndex.toString(BASE_36_RADIX)}`;
	const slot: LoweredAngularDeferSlot = {
		delayMs: parseDelayMs(triggerExpression),
		errorHtml,
		fallbackHtml: placeholderHtml,
		id,
		resolvedBindings: transformedResolved.bindings,
		resolvedHtml,
		resolvedTemplate: transformedResolved.template
	};

	return {
		cursorAfterResolved,
		markup: `<abs-defer-slot [id]="'${id}'" [resolve]="__absoluteDeferResolvePayload${slotIndex}">${buildSlotTemplates(slot)}</abs-defer-slot>`,
		slot
	};
};

const applyConsumedResolvedTemplateChunk = (
	bindings: Array<{ expression: string; key: string }>,
	nextChunk: {
		binding: { expression: string; key: string } | null;
		cursor: number;
		done: boolean;
		template: string;
	}
) => {
	if (nextChunk.binding) {
		bindings.push(nextChunk.binding);
	}

	return {
		cursor: nextChunk.done ? Number.POSITIVE_INFINITY : nextChunk.cursor,
		done: nextChunk.done,
		template: nextChunk.template
	};
};

const applyConsumedDeferredBlock = (
	content: string | null,
	parsedBlock: { content: string; nextIndex: number } | null,
	cursorAfterResolved: number
) => {
	if (!parsedBlock) {
		return {
			content,
			cursorAfterResolved
		};
	}

	return {
		content: parsedBlock.content || null,
		cursorAfterResolved: parsedBlock.nextIndex
	};
};

const applyConsumedPlaceholderBlock = (
	placeholderHtml: string,
	parsedBlock: { content: string; nextIndex: number } | null,
	cursorAfterResolved: number
) => {
	const nextState = applyConsumedDeferredBlock(
		placeholderHtml,
		parsedBlock,
		cursorAfterResolved
	);

	return {
		cursorAfterResolved: nextState.cursorAfterResolved,
		placeholderHtml: nextState.content ?? ''
	};
};

const applyConsumedErrorBlock = (
	errorHtml: string | null,
	parsedBlock: { content: string; nextIndex: number } | null,
	cursorAfterResolved: number
) => {
	const nextState = applyConsumedDeferredBlock(
		errorHtml,
		parsedBlock,
		cursorAfterResolved
	);

	return {
		cursorAfterResolved: nextState.cursorAfterResolved,
		errorHtml: nextState.content
	};
};

const resolveNextLoweredTemplateChunk = (template: string, cursor: number) => {
	const nextDeferBlock = readNextDeferBlock(template, cursor);
	if (nextDeferBlock) {
		return nextDeferBlock;
	}

	return {
		deferIndex: -1,
		prefix: template.slice(cursor)
	};
};

const applyInvalidDeferSlotStart = (
	loweredTemplate: string,
	slotStart: {
		changed: boolean;
		cursor: number;
		markerCursor: number;
		templatePrefix: string;
	}
) => {
	if (!slotStart.changed) {
		return null;
	}

	return {
		changed: true,
		cursor: slotStart.cursor,
		template: loweredTemplate + slotStart.templatePrefix
	};
};

const applyEmptyResolvedBlock = (
	loweredTemplate: string,
	template: string,
	deferIndex: number,
	resolvedBlock: { content: string; nextIndex: number }
) => {
	if (resolvedBlock.content.trim()) {
		return null;
	}

	return {
		cursor: resolvedBlock.nextIndex,
		template:
			loweredTemplate +
			template.slice(deferIndex, resolvedBlock.nextIndex)
	};
};

const applyNextLoweredTemplateChunk = (
	loweredTemplate: string,
	nextDeferBlock: { deferIndex: number; prefix: string }
) => ({
	deferIndex: nextDeferBlock.deferIndex,
	done: nextDeferBlock.deferIndex < 0,
	template: loweredTemplate + nextDeferBlock.prefix
});

const applyParsedSlotStart = (
	changed: boolean,
	cursor: number,
	loweredTemplate: string,
	slotStart: {
		changed: boolean;
		cursor: number;
		markerCursor: number;
		templatePrefix: string;
	}
) => {
	const invalidSlotStart = applyInvalidDeferSlotStart(
		loweredTemplate,
		slotStart
	);
	if (!invalidSlotStart) {
		return {
			changed,
			cursor,
			template: loweredTemplate
		};
	}

	return {
		changed: true,
		cursor: invalidSlotStart.cursor,
		template: invalidSlotStart.template
	};
};

const applyResolvedBlockState = (
	cursor: number,
	loweredTemplate: string,
	template: string,
	deferIndex: number,
	resolvedBlock: { content: string; nextIndex: number }
) => {
	const emptyResolvedBlock = applyEmptyResolvedBlock(
		loweredTemplate,
		template,
		deferIndex,
		resolvedBlock
	);
	if (!emptyResolvedBlock) {
		return {
			cursor,
			template: loweredTemplate
		};
	}

	return emptyResolvedBlock;
};

const consumeResolvedTemplateStep = (
	value: string,
	template: string,
	cursor: number,
	bindings: Array<{ expression: string; key: string }>
) => {
	const nextChunk = consumeResolvedTemplateChunk(
		value,
		template,
		cursor,
		bindings.length
	);

	return applyConsumedResolvedTemplateChunk(bindings, nextChunk);
};

const consumeLoweredDeferStep = (input: {
	changed: boolean;
	cursor: number;
	loweredTemplate: string;
	slotIndex: number;
	slots: LoweredAngularDeferSlot[];
	template: string;
}) => {
	const { changed, cursor, loweredTemplate, slotIndex, slots, template } =
		input;
	const nextDeferBlock = resolveNextLoweredTemplateChunk(template, cursor);
	const nextLoweredChunk = applyNextLoweredTemplateChunk(
		loweredTemplate,
		nextDeferBlock
	);
	if (nextLoweredChunk.done) {
		return null;
	}

	const { deferIndex } = nextLoweredChunk;
	let markerCursor = deferIndex + '@defer'.length;
	const triggerInfo = parseOptionalTriggerExpression(template, markerCursor);
	const { triggerExpression } = triggerInfo;
	({ markerCursor } = triggerInfo);
	const slotStart = resolveDeferSlotStart(template, deferIndex, markerCursor);
	({ markerCursor } = slotStart);
	const slotStartState = applyParsedSlotStart(
		changed,
		cursor,
		nextLoweredChunk.template,
		slotStart
	);
	if (slotStartState.changed !== changed) {
		return {
			changed: slotStartState.changed,
			cursor: slotStartState.cursor,
			slotIndex,
			template: slotStartState.template
		};
	}

	const resolvedBlock = skipMatchingBlock(template, markerCursor);
	const resolvedBlockState = applyResolvedBlockState(
		cursor,
		nextLoweredChunk.template,
		template,
		deferIndex,
		resolvedBlock
	);
	if (resolvedBlockState.cursor !== cursor) {
		return {
			changed,
			cursor: resolvedBlockState.cursor,
			slotIndex,
			template: resolvedBlockState.template
		};
	}

	const blockContent = parsePlaceholderAndErrorBlocks(
		template,
		skipWhitespace(template, resolvedBlock.nextIndex)
	);
	const builtSlot = buildDeferredSlot({
		cursorAfterResolved: blockContent.cursorAfterResolved,
		errorHtml: blockContent.errorHtml,
		placeholderHtml: blockContent.placeholderHtml,
		resolvedBlock,
		slotIndex,
		triggerExpression
	});
	slots.push(builtSlot.slot);

	return {
		changed: true,
		cursor: builtSlot.cursorAfterResolved,
		slotIndex: slotIndex + 1,
		template: nextLoweredChunk.template + builtSlot.markup
	};
};

const skipMatchingBlock = (
	value: string,
	start: number
): { content: string; nextIndex: number } => {
	if (value[start] !== '{') {
		return { content: '', nextIndex: start };
	}

	let cursor = start + 1;
	let depth = 1;

	while (cursor < value.length) {
		const consumed = consumeBlockCursor(value, start, cursor, depth);
		if (consumed.result) {
			return consumed.result;
		}

		({ cursor, depth } = consumed);
	}

	return { content: value.slice(start + 1), nextIndex: value.length };
};

const skipWhitespace = (value: string, index: number) => {
	let cursor = index;
	while (cursor < value.length && /\s/.test(value[cursor] ?? '')) {
		cursor += 1;
	}

	return cursor;
};

const parseOptionalParenthesizedBlock = (
	value: string,
	index: number
): { expression: string; nextIndex: number } | null => {
	let cursor = skipWhitespace(value, index);
	if (value[cursor] !== '(') {
		return null;
	}

	cursor += 1;
	let depth = 1;
	const start = cursor;

	while (cursor < value.length) {
		const char = value[cursor] ?? '';
		const nextDepth = updateParenthesisDepth(char, depth);
		if (char === ')' && nextDepth === 0) {
			return {
				expression: value.slice(start, cursor),
				nextIndex: cursor + 1
			};
		}

		depth = nextDepth;
		cursor += 1;
	}

	return { expression: value.slice(start), nextIndex: value.length };
};

const parseDelayMs = (triggerExpression: string | undefined) => {
	if (!triggerExpression) return 0;
	const timerMsMatch = triggerExpression.match(/timer\(\s*(\d+)\s*ms\s*\)/i);
	if (timerMsMatch?.[1]) return Number.parseInt(timerMsMatch[1], 10);
	const timerSecondsMatch = triggerExpression.match(
		/timer\(\s*(\d+)\s*s\s*\)/i
	);
	if (timerSecondsMatch?.[1]) {
		return (
			Number.parseInt(timerSecondsMatch[1], 10) * MILLISECONDS_IN_A_SECOND
		);
	}

	if (/\bon\s+immediate\b/i.test(triggerExpression)) return 0;
	if (/\bon\s+idle\b/i.test(triggerExpression)) return 1;

	return 0;
};

const transformResolvedTemplate = (value: string) => {
	const bindings: Array<{ expression: string; key: string }> = [];
	let template = '';
	let cursor = 0;

	while (cursor < value.length) {
		const appliedChunk = consumeResolvedTemplateStep(
			value,
			template,
			cursor,
			bindings
		);
		({ cursor, template } = appliedChunk);
	}

	return {
		bindings,
		template
	};
};

const parseOptionalTriggerExpression = (
	template: string,
	markerCursor: number
) => {
	const parsedTrigger = parseOptionalParenthesizedBlock(
		template,
		markerCursor
	);
	if (!parsedTrigger) {
		return {
			markerCursor,
			triggerExpression: undefined
		};
	}

	return {
		markerCursor: parsedTrigger.nextIndex,
		triggerExpression: parsedTrigger.expression.trim()
	};
};

const parseDeferredAuxiliaryBlock = (
	template: string,
	cursorAfterResolved: number,
	keyword: '@error' | '@placeholder'
) => {
	if (!template.startsWith(keyword, cursorAfterResolved)) {
		return null;
	}

	const blockKeywordCursor = cursorAfterResolved + keyword.length;
	const blockStart = skipWhitespace(template, blockKeywordCursor);
	if (template[blockStart] !== '{') {
		return null;
	}

	return skipMatchingBlock(template, blockStart);
};

const parsePlaceholderAndErrorBlocks = (
	template: string,
	startCursor: number
) => {
	let cursorAfterResolved = startCursor;
	let placeholderHtml = '';
	let errorHtml: string | null = null;

	const parsedPlaceholder = consumeDeferredAuxiliaryBlock({
		cursorAfterResolved,
		keyword: '@placeholder',
		template
	});
	({ placeholderHtml, cursorAfterResolved } = applyConsumedPlaceholderBlock(
		placeholderHtml,
		parsedPlaceholder,
		cursorAfterResolved
	));

	const parsedError = consumeDeferredAuxiliaryBlock({
		cursorAfterResolved,
		keyword: '@error',
		template
	});
	({ errorHtml, cursorAfterResolved } = applyConsumedErrorBlock(
		errorHtml,
		parsedError,
		cursorAfterResolved
	));

	return {
		cursorAfterResolved,
		errorHtml,
		placeholderHtml
	};
};

const buildSlotTemplates = (slot: LoweredAngularDeferSlot) => {
	const templates = [
		`<ng-template absDeferResolved let-slotData>${slot.resolvedTemplate}</ng-template>`
	];

	if (slot.fallbackHtml.length > 0) {
		templates.push(
			`<ng-template absDeferFallback>${slot.fallbackHtml}</ng-template>`
		);
	}
	if (slot.errorHtml) {
		templates.push(
			`<ng-template absDeferError>${slot.errorHtml}</ng-template>`
		);
	}

	return templates.join('');
};

export const lowerAngularDeferSyntax = (
	template: string
): LoweredAngularDeferResult => {
	if (!template.includes('@defer')) {
		return {
			slots: [],
			template,
			transformed: false
		};
	}

	let cursor = 0;
	let slotIndex = 0;
	const slots: LoweredAngularDeferSlot[] = [];
	let loweredTemplate = '';
	let changed = false;
	let nextState = consumeLoweredDeferStep({
		changed,
		cursor,
		loweredTemplate,
		slotIndex,
		slots,
		template
	});
	while (nextState) {
		({ changed, cursor, slotIndex, template: loweredTemplate } = nextState);
		nextState = consumeLoweredDeferStep({
			changed,
			cursor,
			loweredTemplate,
			slotIndex,
			slots,
			template
		});
	}

	const transformedTemplate =
		slots.length > 0
			? loweredTemplate + template.slice(cursor)
			: template.replaceAll('@defer', '&#64;defer');

	return {
		slots,
		template: transformedTemplate,
		transformed: slots.length > 0
	};
};
