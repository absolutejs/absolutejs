import type { Component } from "svelte";
import { render } from "svelte/server";
import { escapeScriptContent } from "../utils/escapeScriptContent";

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
	props: Props,
	{
		bootstrapScriptContent,
		bootstrapScripts = [],
		bootstrapModules = [],
		nonce,
		onError = console.error
	}: RenderStringOptions = {}
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

		return `<!DOCTYPE html><html lang="en"><head>${head}</head><body>${body}${scripts}</body></html>`;
	} catch (error) {
		onError?.(error);
		throw error;
	}
};
