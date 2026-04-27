import type { Component, ComponentProps } from 'svelte';
import { render } from 'svelte/server';
import { escapeScriptContent } from '../utils/escapeScriptContent';
import { SVELTE_PAGE_ROOT_ID } from './renderToReadableStream';

type SvelteRenderOutput = {
	body: string;
	head: string;
};

type SvelteServerRender = (
	component: Component<Record<string, unknown>>,
	options?: { props?: Record<string, unknown> }
) => SvelteRenderOutput;

const renderComponent: SvelteServerRender = render;

export type RenderStringOptions = {
	bootstrapScriptContent?: string;
	bootstrapScripts?: string[];
	bootstrapModules?: string[];
	nonce?: string;
	onError?: (error: unknown) => void;
};

export const renderToString = <Comp extends Component<Record<string, unknown>>>(
	component: Comp,
	props?: ComponentProps<Comp>,
	{
		bootstrapScriptContent,
		bootstrapScripts = [],
		bootstrapModules = [],
		nonce,
		onError = console.error
	}: RenderStringOptions = {}
) => {
	try {
		const rendered =
			typeof props === 'undefined'
				? renderComponent(component)
				: renderComponent(component, { props });
		const { head, body } = rendered;
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

		return `<!DOCTYPE html><html lang="en"><head>${head}</head><body><div id="${SVELTE_PAGE_ROOT_ID}">${body}</div>${scripts}</body></html>`;
	} catch (error) {
		onError(error);
		throw error;
	}
};
