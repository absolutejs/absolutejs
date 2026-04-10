import { BASE_36_RADIX } from '../constants';

const AWAIT_BLOCK_RE =
	/\{#await\s+([^}]+)\}([\s\S]*?)\{:then(?:\s+([A-Za-z_$][\w$]*))?\}([\s\S]*?)(?:\{:catch(?:\s+([A-Za-z_$][\w$]*))?\}([\s\S]*?))?\{\/await\}/g;

const escapeTemplateLiteral = (value: string) =>
	value
		.replaceAll('\\', '\\\\')
		.replaceAll('`', '\\`')
		.replaceAll('${', '\\${');

const markupToTemplateLiteral = (markup: string) => {
	const escaped = escapeTemplateLiteral(markup.trim());
	const withExpressions = escaped.replace(
		/\{([^{}]+)\}/g,
		(_, expression) => `\${${String(expression).trim()}}`
	);

	return `\`${withExpressions}\``;
};

export const lowerSvelteAwaitSlotSyntax = (source: string) => {
	if (!source.includes('{#await')) {
		return { code: source, transformed: false };
	}

	let awaitIndex = 0;
	let transformed = false;
	const lowered = source.replace(
		AWAIT_BLOCK_RE,
		(
			fullMatch,
			awaitExpression: string,
			pendingMarkup: string,
			thenIdentifier: string | undefined,
			thenMarkup: string,
			catchIdentifier: string | undefined,
			catchMarkup: string | undefined
		) => {
			const trimmedAwaitExpression = awaitExpression.trim();
			if (!trimmedAwaitExpression) {
				return fullMatch;
			}

			const slotId = `absolute-svelte-await-${awaitIndex.toString(BASE_36_RADIX)}`;
			awaitIndex += 1;
			transformed = true;

			const thenValueIdentifier =
				thenIdentifier?.trim() || '__awaitValue';
			const catchValueIdentifier =
				catchIdentifier?.trim() || '__awaitError';
			const fallbackHtml = markupToTemplateLiteral(pendingMarkup);
			const resolvedHtml = markupToTemplateLiteral(thenMarkup);
			const rejectedHtml =
				typeof catchMarkup === 'string'
					? markupToTemplateLiteral(catchMarkup)
					: null;
			const catchBranch = rejectedHtml
				? `catch (${catchValueIdentifier}) { return ${rejectedHtml}; }`
				: 'catch (_absoluteAwaitError) { throw _absoluteAwaitError; }';

			return `<AbsoluteAwaitSlot id="${slotId}" fallbackHtml={${fallbackHtml}} resolve={async () => { try { const ${thenValueIdentifier} = await (${trimmedAwaitExpression}); return ${resolvedHtml}; } ${catchBranch} }} />`;
		}
	);

	if (!transformed) {
		return { code: source, transformed: false };
	}

	const importLine =
		'import AbsoluteAwaitSlot from "@absolutejs/absolute/svelte/components/AwaitSlot.svelte";';

	if (lowered.includes('<script')) {
		return {
			code: lowered.replace(
				/<script(\s[^>]*)?>/,
				(match) => `${match}\n${importLine}\n`
			),
			transformed: true
		};
	}

	return {
		code: `<script lang="ts">\n${importLine}\n</script>\n${lowered}`,
		transformed: true
	};
};
