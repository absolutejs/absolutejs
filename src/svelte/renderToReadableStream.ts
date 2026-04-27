import type { Component, ComponentProps } from 'svelte';
import { DEFAULT_CHUNK_SIZE } from '../constants';
import { escapeScriptContent } from '../utils/escapeScriptContent';

export const SVELTE_PAGE_ROOT_ID = '__absolute_svelte_root__';

type SvelteRenderOutput = {
	body: string;
	head: string;
};

type SvelteServerRender = (
	component: Component<Record<string, unknown>>,
	options?: { props?: Record<string, unknown> }
) => SvelteRenderOutput | PromiseLike<SvelteRenderOutput>;

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
		signal,
		headContent,
		bodyContent
	}: RenderStreamOptions = {}
) => {
	try {
		const { render } = await import('svelte/server');
		const renderComponent: SvelteServerRender = render;
		const rendered =
			typeof props === 'undefined'
				? await renderComponent(component)
				: await renderComponent(component, { props });
		const { head, body } = rendered;
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
			`<!DOCTYPE html><html lang="en"><head>${head}${headContent ?? ''}</head><body><div id="${SVELTE_PAGE_ROOT_ID}">${body}</div>${scripts}${bodyContent ?? ''}</body></html>`
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
