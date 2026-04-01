import { Readable } from 'node:stream';
import type { Component } from 'svelte';
import { render } from 'svelte/server';
import { DEFAULT_CHUNK_SIZE } from '../constants';
import { escapeScriptContent } from '../utils/escapeScriptContent';

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
	Props extends Record<string, unknown> = Record<string, never>
>(
	component: Component<Props>,
	props?: Props,
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

		const encoder = new TextEncoder();
		const full = encoder.encode(
			`<!DOCTYPE html><html lang="en"><head>${head}</head><body>${body}${scripts}</body></html>`
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
