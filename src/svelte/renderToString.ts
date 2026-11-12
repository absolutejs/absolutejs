import {
	nonceAttr as nonceAttribute,
	nonceSvelteHeadStyles,
	readCspNonce
} from '../utils/cspNonceRef';
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
	options?: {
		csp?: { nonce?: string };
		props?: Record<string, unknown>;
	}
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
		// Svelte nonces its own head <style>/<script> tags with this.
		const resolvedNonce = nonce ?? readCspNonce();
		const svelteCsp = resolvedNonce
			? { csp: { nonce: resolvedNonce } }
			: {};
		const rendered =
			typeof props === 'undefined'
				? renderComponent(component, svelteCsp)
				: renderComponent(component, { ...svelteCsp, props });
		const { head, body } = rendered;
		const nonceAttr = nonceAttribute(resolvedNonce);
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

		return `<!DOCTYPE html><html lang="en"><head>${nonceSvelteHeadStyles(head, resolvedNonce)}</head><body><div id="${SVELTE_PAGE_ROOT_ID}">${body}</div>${scripts}</body></html>`;
	} catch (error) {
		onError(error);
		throw error;
	}
};
