import { Readable } from "node:stream";
import type { Component } from "svelte";
import { render } from "svelte/server";
import { escapeScriptContent } from "../utils/escapeScriptContent";

const DEFAULT_CHUNK_SIZE = 16_384;

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
	props: Props,
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
		const { head, body } = render(component, { props });
		const nonceAttr = nonce ? ` nonce="${nonce}"` : "";
		const scripts =
			(bootstrapScriptContent
				? `<script${nonceAttr}>${escapeScriptContent(bootstrapScriptContent)}</script>`
				: "") +
			bootstrapScripts
				.map((src) => `<script${nonceAttr} src="${src}"></script>`)
				.join("") +
			bootstrapModules
				.map(
					(src) =>
						`<script${nonceAttr} type="module" src="${src}"></script>`
				)
				.join("");

		const encoder = new TextEncoder();
		const full = encoder.encode(
			`<!DOCTYPE html><html lang="en"><head>${head}</head><body>${body}${scripts}</body></html>`
		);

		let offset = 0;

		const stream = new Readable({
			read() {
				if (signal?.aborted) {
					this.destroy(signal.reason as Error);

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

		return stream;
	} catch (error) {
		onError?.(error);
		throw error;
	}
};
