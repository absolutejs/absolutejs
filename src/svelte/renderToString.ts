import type { Component } from 'svelte';
import { render } from 'svelte/server';
import { escapeScriptContent } from '../utils/escapeScriptContent';

export type RenderStringOptions = {
	bootstrapScriptContent?: string;
	bootstrapScripts?: string[];
	bootstrapModules?: string[];
	nonce?: string;
	onError?: (error: unknown) => void;
};

export const renderToString = <
	Props extends Record<string, unknown> = Record<string, never>
>(
	component: Component<Props>,
	props?: Props,
	{
		bootstrapScriptContent,
		bootstrapScripts = [],
		bootstrapModules = [],
		nonce,
		onError = console.error
	}: RenderStringOptions = {}
) => {
	try {
		const { head: rawHead, body } =
			typeof props === 'undefined'
				? // @ts-expect-error Svelte's render function can't determine which overload to choose when the component is generic
					render(component)
				: render(component, { props });
		const head = rawHead.replace(
			/(<!--[a-z0-9]+-->)([\s\S]*?)(<!---->)\s*(<title>[\s\S]*?<\/title>)/,
			'$1$4$2$3'
		);
		const nonceAttr = nonce ? ` nonce="${nonce}"` : '';
		const scripts = [
			bootstrapScriptContent &&
				`<script${nonceAttr}>${escapeScriptContent(bootstrapScriptContent)}</script>`,
			...bootstrapScripts.map(
				(src) => `<script${nonceAttr} src="${src}"></script>`
			),
			...bootstrapModules.map(
				(src) =>
					`<script${nonceAttr} type="module" src="${src}"></script>`
			)
		]
			.filter(Boolean)
			.join('');

		return `<!DOCTYPE html><html lang="en"><head>${head}</head><body>${body}${scripts}</body></html>`;
	} catch (error) {
		onError(error);
		throw error;
	}
};
