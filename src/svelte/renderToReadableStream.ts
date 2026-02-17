import type { Component } from 'svelte';
import { render } from 'svelte/server';
import { DEFAULT_CHUNK_SIZE } from '../constants';
import { escapeScriptContent } from '../utils/escapeScriptContent';

export type RenderStreamOptions = {
	bootstrapScriptContent?: string;
	bootstrapScripts?: string[];
	bootstrapModules?: string[];
	nonce?: string;
	onError?: (error: unknown) => void;
	progressiveChunkSize?: number;
	signal?: AbortSignal;
	headContent?: string;
	bodyContent?: string;
};

export const renderToReadableStream = async <
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
		signal,
		headContent,
		bodyContent
	}: RenderStreamOptions = {}
) => {
	try {
		const { head, body } =
			typeof props === 'undefined'
				? // @ts-expect-error Svelte's render function can't determine which overload to choose when the component is generic
					render(component)
				: render(component, { props });
		const nonceAttr = nonce ? ` nonce="${nonce}"` : '';
		const scripts =
			(bootstrapScriptContent
				? `<script${nonceAttr}>${escapeScriptContent(bootstrapScriptContent)}</script>`
				: '') +
			bootstrapScripts
				.map((src) => `<script${nonceAttr} src="${src}"></script>`)
				.join('') +
			bootstrapModules
				.map(
					(src) =>
						`<script${nonceAttr} type="module" src="${src}"></script>`
				)
				.join('');
		const encoder = new TextEncoder();
		// Warning: this encodes the entire document into memory in one buffer
		const full = encoder.encode(
			`<!DOCTYPE html><html lang="en"><head>${head}${headContent ?? ''}</head><body>${body}${scripts}${bodyContent ?? ''}</body></html>`
		);

		let offset = 0;

		return new ReadableStream<Uint8Array>({
			type: 'bytes',
			cancel(reason) {
				onError?.(reason);
			},
			pull(controller) {
				if (signal?.aborted) {
					controller.close();

					return;
				}
				if (offset >= full.length) {
					controller.close();

					return;
				}
				const end = Math.min(
					offset + progressiveChunkSize,
					full.length
				);
				controller.enqueue(full.subarray(offset, end));
				offset = end;
			}
		});
	} catch (error) {
		onError?.(error);
		throw error;
	}
};
