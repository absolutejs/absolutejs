import {
	nonceAttr as nonceAttribute,
	nonceSvelteHeadStyles,
	readCspNonce
} from '../utils/cspNonceRef';
import { Readable } from 'node:stream';
import type { Component, ComponentProps } from 'svelte';
import { render } from 'svelte/server';
import { DEFAULT_CHUNK_SIZE } from '../constants';
import { escapeScriptContent } from '../utils/escapeScriptContent';
import { htmlLangAttributes } from '../utils/localeRef';

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

export type RenderPipeableOptions = {
	bootstrapScriptContent?: string;
	bootstrapScripts?: string[];
	bootstrapModules?: string[];
	nonce?: string;
	onError?: (error: unknown) => void;
	progressiveChunkSize?: number;
	signal?: AbortSignal;
};

export const renderToPipeableStream = <
	Comp extends Component<Record<string, unknown>>
>(
	component: Comp,
	props?: ComponentProps<Comp>,
	{
		bootstrapScriptContent,
		bootstrapScripts = [],
		bootstrapModules = [],
		nonce,
		onError = console.error,
		progressiveChunkSize = DEFAULT_CHUNK_SIZE,
		signal
	}: RenderPipeableOptions = {}
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

		const encoder = new TextEncoder();
		const full = encoder.encode(
			`<!DOCTYPE html><html${htmlLangAttributes()}><head>${nonceSvelteHeadStyles(head, resolvedNonce)}</head><body>${body}${scripts}</body></html>`
		);

		let offset = 0;

		return new Readable({
			read() {
				if (signal?.aborted) {
					this.destroy(
						signal.reason instanceof Error
							? signal.reason
							: new Error(String(signal.reason))
					);

					return;
				}
				if (offset >= full.length) {
					this.push(null);

					return;
				}
				const end = Math.min(
					offset + progressiveChunkSize,
					full.length
				);
				this.push(full.subarray(offset, end));
				offset = end;
			}
		});
	} catch (error) {
		onError(error);
		throw error;
	}
};
