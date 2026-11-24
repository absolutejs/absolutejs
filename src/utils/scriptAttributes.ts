/* The one place a `<Script>`'s props become a tag, shared by all four
 * framework components and by `generateHeadElement`.
 *
 * It is a pure function of the props on purpose. Each framework renders
 * the result its own way — JSX, raw markup in a Svelte head, a string in a
 * Vue or Angular head tag — and if each computed the attributes itself
 * they would drift: one would default to `defer`, another to `async`, a
 * third would forget the identity marker and silently opt out of
 * deduplication, which looks like nothing at all until an analytics tag
 * starts double-counting. */

import type { ScriptProps, ScriptStrategy } from '../../types/script';
import { SCRIPT_MARKER } from '../client/scriptMarker';

const DEFAULT_STRATEGY: ScriptStrategy = 'afterInteractive';

/* `defer` and `async` are exclusive, and `defer` is the default because a
 * third-party tag that blocks parsing is the thing this exists to avoid.
 * `beforeInteractive` deliberately gets neither: a script asked to run
 * before the page is interactive cannot also be deferred. An inline script
 * takes neither, where both attributes are meaningless. */
const loadingAttributes = (props: ScriptProps, strategy: ScriptStrategy) => {
	if (props.src === undefined) return {};
	if (props.async === true) return { async: '' };

	return strategy === 'afterInteractive' ? { defer: '' } : {};
};

const escapeAttribute = (value: string) =>
	value.replace(/&/gu, '&amp;').replace(/"/gu, '&quot;');

/* Values go through `JSON.stringify` and then have `</` neutralised: the
 * payload sits inside a `<script>` element, where a literal `</script>`
 * anywhere in a string — a tracking URL with that path, a data attribute
 * out of a CMS — would end the element early and spill the rest of the
 * page as markup. */
const inlineJson = (value: unknown) =>
	JSON.stringify(value).replace(/<\//gu, '<\\/');

/** The attributes for a tag added after parsing (`lazyOnload`). Neither
 *  `defer` nor `async` is written: a script element added by script is
 *  already asynchronous, and `defer` has no meaning once parsing is
 *  over. */
export const insertedScriptAttributes = (props: ScriptProps) =>
	scriptAttributes({ ...props, strategy: 'beforeInteractive' });

/** The attributes to render, or `undefined` when the strategy renders
 *  nothing into the document — `lazyOnload`, which is added later. */
export const scriptAttributes = (props: ScriptProps) => {
	const { crossOrigin, data, integrity, referrerPolicy, src, type } = props;
	const { strategy = DEFAULT_STRATEGY } = props;
	if (strategy === 'lazyOnload') return undefined;
	const identity = scriptIdentity(props);
	const dataAttributes = Object.fromEntries(
		Object.entries(data ?? {}).map(([key, value]) => [`data-${key}`, value])
	);

	return {
		...(identity === undefined ? {} : { [SCRIPT_MARKER]: identity }),
		...(crossOrigin === undefined ? {} : { crossorigin: crossOrigin }),
		...(integrity === undefined ? {} : { integrity }),
		...(referrerPolicy === undefined
			? {}
			: { referrerpolicy: referrerPolicy }),
		...(src === undefined ? {} : { src }),
		...(type === undefined ? {} : { type }),
		...dataAttributes,
		...loadingAttributes(props, strategy)
	};
};

/** The identity of a script: what makes two tags on two pages the same
 *  script. An explicit `id` wins, then `src`. An inline script with
 *  neither has no identity and behaves like any other inline script,
 *  which is to run per page. */
export const scriptIdentity = ({ id, src }: ScriptProps) => id ?? src;

/* A head rendered as a string has no component to run an effect, so a
 * `lazyOnload` script there needs the insertion written into the page.
 *
 * The bootstrap re-runs on every soft navigation, because an inline script
 * carries no identity and is not deduplicated. That is harmless and
 * deliberate: it looks for the tag first, finds the one the navigation
 * layer carried over, and does nothing. */
const lazyBootstrap = (props: ScriptProps) => {
	const attributes = insertedScriptAttributes(props) ?? {};

	return `(function(a,c){var f=function(){if(a["${SCRIPT_MARKER}"]&&document.querySelector('script[${SCRIPT_MARKER}="'+a["${SCRIPT_MARKER}"]+'"]'))return;var s=document.createElement("script");for(var k in a)s.setAttribute(k,a[k]);if(c)s.text=c;document.head.appendChild(s)};if(document.readyState==="complete")setTimeout(f,0);else addEventListener("load",f,{once:true})})(${inlineJson(attributes)},${inlineJson(props.code ?? '')})`;
};

/** The same tag as a string, for a head rendered without a component:
 *  `generateHeadElement`, a static HTML page, an HTMX fragment. */
export const scriptTag = (props: ScriptProps, nonce?: string) => {
	const attributes = scriptAttributes(props);
	const nonceAttribute =
		nonce === undefined ? '' : ` nonce="${escapeAttribute(nonce)}"`;
	if (attributes === undefined)
		return `<script${nonceAttribute}>${lazyBootstrap(props)}</script>`;
	const rendered = Object.entries(attributes)
		.map(([name, value]) =>
			value === '' ? ` ${name}` : ` ${name}="${escapeAttribute(value)}"`
		)
		.join('');
	/* Inline source is written into the element, so a literal `</script`
	 * in it would close the element early — the same hazard as the
	 * bootstrap payload, and not hypothetical in code pasted out of a tag
	 * manager. */
	const body = (props.code ?? '').replace(/<\/(?=script)/giu, '<\\/');

	return `<script${rendered}${nonceAttribute}>${body}</script>`;
};
