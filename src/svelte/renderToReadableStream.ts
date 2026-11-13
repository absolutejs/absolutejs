import {
	nonceAttr as nonceAttribute,
	nonceSvelteHeadStyles,
	readCspNonce
} from '../utils/cspNonceRef';
import type { Component, ComponentProps } from 'svelte';
import { DEFAULT_CHUNK_SIZE } from '../constants';
import { escapeScriptContent } from '../utils/escapeScriptContent';
import { htmlLangAttributes } from '../utils/localeRef';

export const SVELTE_PAGE_ROOT_ID = '__absolute_svelte_root__';

type SvelteRenderOutput = {
	body: string;
	head: string;
};

type SvelteServerRender = (
	component: Component<Record<string, unknown>>,
	options?: {
		context?: Map<unknown, unknown>;
		csp?: { nonce?: string };
		props?: Record<string, unknown>;
	}
) => SvelteRenderOutput | PromiseLike<SvelteRenderOutput>;

export type RenderStreamOptions = {
	/** Inline script before the bootstrap scripts. A function is called
	 *  after the render, so it can describe what the render did. */
	bootstrapScriptContent?: string | (() => string);
	bootstrapScripts?: string[];
	bootstrapModules?: string[];
	nonce?: string;
	onError?: (error: unknown) => void;
	progressiveChunkSize?: number;
	signal?: AbortSignal;
	headContent?: string;
	bodyContent?: string;
	/** Svelte context for the root component (`render(…, { context })`). */
	context?: Map<unknown, unknown>;
	/** Called after each render pass; resolve `true` to render again (up
	 *  to {@link MAX_RENDER_PASSES} passes). The Svelte router uses it to
	 *  await guards and lazy routes between passes. */
	settle?: () => Promise<boolean>;
};

const MAX_RENDER_PASSES = 5;

const renderUntilSettled = async (
	renderPass: () => Promise<SvelteRenderOutput>,
	settle: (() => Promise<boolean>) | undefined,
	pass = 1
): Promise<SvelteRenderOutput> => {
	const rendered = await renderPass();
	if (!settle || pass >= MAX_RENDER_PASSES) return rendered;
	const again = await settle();
	if (!again) return rendered;

	return renderUntilSettled(renderPass, settle, pass + 1);
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
		bodyContent,
		context,
		settle
	}: RenderStreamOptions = {}
) => {
	try {
		const { render } = await import('svelte/server');
		const renderComponent: SvelteServerRender = render;
		// Svelte nonces its own head <style>/<script> tags with this.
		const resolvedNonce = nonce ?? readCspNonce();
		const svelteCsp = resolvedNonce
			? { csp: { nonce: resolvedNonce } }
			: {};
		const renderPass = async () => {
			if (typeof props === 'undefined' && !context) {
				return renderComponent(component, svelteCsp);
			}

			return renderComponent(component, { ...svelteCsp, context, props });
		};
		const rendered = await renderUntilSettled(renderPass, settle);
		const { head, body } = rendered;
		const nonceAttr = nonceAttribute(resolvedNonce);
		const inlineScript =
			typeof bootstrapScriptContent === 'function'
				? bootstrapScriptContent()
				: bootstrapScriptContent;
		const scripts =
			(inlineScript
				? `<script${nonceAttr}>${escapeScriptContent(inlineScript)}</script>`
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
			`<!DOCTYPE html><html${htmlLangAttributes()}><head>${nonceSvelteHeadStyles(head, resolvedNonce)}${headContent ?? ''}</head><body><div id="${SVELTE_PAGE_ROOT_ID}">${body}</div>${scripts}${bodyContent ?? ''}</body></html>`
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
