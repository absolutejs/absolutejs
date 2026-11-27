import type { RichTags } from '../../types/i18n';
import { formatMessage } from './formatMessage';

/* A message with markup in it, as HTML.
 *
 *   "terms": "By signing up you accept our <link>terms of service</link>."
 *
 *   html('terms', { link: (text) => `<a href="/terms">${text}</a>` })
 *
 * The translator decides where the link goes in the sentence, and the
 * developer decides what a link is. A tag in a message is a name, never
 * markup: `<link>` becomes whatever the function called `link` returns,
 * and a tag no function is given for becomes its own text.
 *
 * What is trusted is exactly what a tag function returns. Everything
 * else is escaped: the message's own text, so a stray `<` or `&` a
 * translator wrote is shown as written, and every parameter's value, so
 * a visitor's name cannot become markup. A value also cannot stand in
 * for a tag — `<link>` arriving in a parameter is text, not the
 * message's `<link>`.
 *
 * The result is a string of HTML, because that is the one thing every
 * framework can render: `dangerouslySetInnerHTML`, `{@html}`, `v-html`,
 * `[innerHTML]`. A tag cannot become a framework's component. */

/* Stands in for `<` inside a parameter's value while the message's own
 * tags are read, so the value cannot be read as one. From the private
 * use area: not a character a message is written with. */
const VALUE_LT = '\uE000';
const TAG_RE = /<(\/?)([A-Za-z][\w-]*)\s*(\/?)>/g;

const ESCAPES = new Map([
	['&', '&amp;'],
	['<', '&lt;'],
	['>', '&gt;'],
	['"', '&quot;'],
	["'", '&#39;'],
	// A `<` from a parameter's value, which was never a tag.
	[VALUE_LT, '&lt;']
]);

const escapeText = (text: string) =>
	text.replace(/[&<>"'\uE000]/g, (char) => ESCAPES.get(char) ?? char);

const guarded = (value: unknown) =>
	typeof value === 'string' ? value.replaceAll('<', VALUE_LT) : value;

type Open = { name: string; parts: string[]; source: string };

const warned = new Set<string>();

const warnUnknown = (name: string) => {
	if (warned.has(name)) return;
	warned.add(name);
	console.warn(
		`[i18n] A message uses <${name}> and no "${name}" tag was given; its text is shown without it.`
	);
};

const rendered = (name: string, inner: string, tags: RichTags) => {
	const tag = tags[name];
	if (tag) return tag(inner);
	warnUnknown(name);

	return inner;
};

type Token = {
	closes: boolean;
	name: string;
	selfCloses: boolean;
	source: string;
};

/* One tag of the message, against the tags open so far. A closing tag
 * that closes nothing open is text: it is what a translator typed. */
const applyTag = (stack: Open[], token: Token, tags: RichTags) => {
	const top = stack[stack.length - 1];
	if (!top) return;
	if (token.selfCloses) {
		top.parts.push(rendered(token.name, '', tags));

		return;
	}
	if (!token.closes) {
		stack.push({ name: token.name, parts: [], source: token.source });

		return;
	}
	if (stack.length < 2 || top.name !== token.name) {
		top.parts.push(escapeText(token.source));

		return;
	}
	stack.pop();
	stack[stack.length - 1]?.parts.push(
		rendered(token.name, top.parts.join(''), tags)
	);
};

/* A tag left open at the end of the message closes nothing: it is
 * shown as the text it is, with what followed it. */
const closeUnclosed = (stack: Open[]) => {
	while (stack.length > 1) {
		const open = stack.pop();
		if (open)
			stack[stack.length - 1]?.parts.push(
				escapeText(open.source),
				...open.parts
			);
	}
};

const element = (name: string) => (chunks: string) =>
	`<${name}>${chunks}</${name}>`;

/** Tags that are the HTML element of the same name, for messages whose
 *  markup is emphasis and nothing else: `html('key', basicTags)`. */
export const basicTags: RichTags = {
	b: element('b'),
	code: element('code'),
	em: element('em'),
	i: element('i'),
	s: element('s'),
	strong: element('strong'),
	u: element('u'),
	br: () => '<br>'
};

/** A message formatted for `locale` and rendered as HTML: its ICU
 *  arguments filled in, its tags replaced, and everything else
 *  escaped. */
export const formatRichMessage = (
	locale: string,
	message: string,
	params: Record<string, unknown>,
	tags: RichTags
) =>
	renderRichText(
		formatMessage(
			locale,
			message.replaceAll(VALUE_LT, ''),
			Object.fromEntries(
				Object.entries(params).map(([name, value]) => [
					name,
					guarded(value)
				])
			)
		),
		tags
	);

/** The names of the tags a message uses. */
export const messageTags = (message: string) =>
	new Set([...message.matchAll(TAG_RE)].map(([, , name = '']) => name));

/** `text` with its tags replaced by what `tags` makes of them, and
 *  everything that is not a tag escaped. */
export const renderRichText = (text: string, tags: RichTags) => {
	const stack: Open[] = [{ name: '', parts: [], source: '' }];
	let from = 0;
	for (const match of text.matchAll(TAG_RE)) {
		const [source, slash = '', name = '', selfClose = ''] = match;
		stack[stack.length - 1]?.parts.push(
			escapeText(text.slice(from, match.index))
		);
		applyTag(
			stack,
			{
				closes: slash === '/',
				name,
				selfCloses: selfClose === '/',
				source
			},
			tags
		);
		from = match.index + source.length;
	}
	stack[stack.length - 1]?.parts.push(escapeText(text.slice(from)));
	closeUnclosed(stack);

	return stack[0]?.parts.join('') ?? '';
};
