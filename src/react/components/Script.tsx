import { useEffect } from 'react';
import type { ScriptProps } from '../../../types/script';
import { loadLazyScript } from '../../client/scriptLoader';
import { readCspNonce } from '../../utils/cspNonceRef';
import { scriptAttributes } from '../../utils/scriptAttributes';

/* JSX is not HTML: the shared helper produces DOM attribute names and
 * values (`crossorigin`, `defer=""`), which is what a head rendered as a
 * string and `setAttribute` both need, while React wants `crossOrigin`
 * and `defer={true}`.
 *
 * The props that map one-to-one are passed straight through from the
 * typed props, and the helper is still the single authority on the part
 * that could drift: WHETHER this strategy defers, runs async, or renders
 * nothing at all, and what the identity marker is. */
const dataAttributes = (attributes: Record<string, string | undefined>) =>
	Object.fromEntries(
		Object.entries(attributes).flatMap(([name, value]) =>
			name.startsWith('data-') && value !== undefined
				? [[name, value]]
				: []
		)
	);

/**
 * A third-party script, with a loading strategy and an identity.
 *
 *   <Script src="https://plausible.io/js/script.js" data={{ domain: 'x' }} />
 *   <Script src="/consent.js" strategy="beforeInteractive" />
 *   <Script src="https://widget.example/chat.js" strategy="lazyOnload" />
 *
 * `afterInteractive` (the default) renders the tag with `defer`;
 * `beforeInteractive` renders it undeferred; `lazyOnload` renders nothing
 * and the client adds the tag once the window has loaded.
 *
 * The tag carries an identity — `id`, or `src` — and that is what makes it
 * run ONCE across a soft navigation. Without one, a page swap recreates
 * every script of the incoming page, so a tag two pages share runs again
 * on each: measured in a browser, an analytics counter read 1, then 2,
 * then 3 across two navigations.
 */
export const Script = (props: ScriptProps) => {
	const { code, crossOrigin, integrity, referrerPolicy, src, type } = props;
	const lazy = props.strategy === 'lazyOnload';
	useEffect(() => {
		if (lazy) loadLazyScript(props);
		/* `props` rather than its fields: it is a new object every render,
		 * and `loadLazyScript` is a no-op once the tag is in the document,
		 * so an extra call costs a `querySelector`. */
	}, [lazy, props]);
	const attributes = scriptAttributes(props);
	if (attributes === undefined) return null;

	return (
		<script
			{...dataAttributes(attributes)}
			async={attributes.async !== undefined}
			crossOrigin={crossOrigin}
			defer={attributes.defer !== undefined}
			{...(code === undefined
				? {}
				: { dangerouslySetInnerHTML: { __html: code } })}
			integrity={integrity}
			nonce={readCspNonce()}
			referrerPolicy={referrerPolicy}
			src={src}
			suppressHydrationWarning
			type={type}
		/>
	);
};
