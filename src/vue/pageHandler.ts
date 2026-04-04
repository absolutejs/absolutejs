import type { Component as VueComponent } from 'vue';
import { readdir } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
import type { VuePropsOf } from '../../types/vue';
import { EXCLUDE_LAST_OFFSET } from '../constants';
import { injectIslandPageContext } from '../core/islandPageContext';
import { ssrErrorPage } from '../utils/ssrErrorPage';
import {
	derivePageName,
	renderConventionError
} from '../utils/resolveConvention';

let ssrDirty = false;
type GenericVueComponent = VueComponent;
const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null;

const isGenericVueComponent = (value: unknown): value is GenericVueComponent =>
	typeof value === 'function' || isRecord(value);

const readHasIslands = (value: unknown) => {
	if (!isRecord(value)) return false;
	const hasIslands = value['__ABSOLUTE_PAGE_HAS_ISLANDS__'];

	return typeof hasIslands === 'boolean' ? hasIslands : false;
};

const readDefaultExport = (value: unknown) =>
	isRecord(value) ? value.default : undefined;

const resolveCurrentGeneratedVueModulePath = async (pagePath: string) => {
	const pageDirectory = dirname(pagePath);
	const expectedPrefix = `${basename(pagePath, '.js').split('.')[0]}.`;

	try {
		const pageEntries = await readdir(pageDirectory, {
			withFileTypes: true
		});
		const matchingEntry = pageEntries.find(
			(entry) =>
				entry.isFile() &&
				entry.name.endsWith('.js') &&
				(entry.name ===
					`${expectedPrefix.slice(0, EXCLUDE_LAST_OFFSET)}.js` ||
					entry.name.startsWith(expectedPrefix))
		);
		if (!matchingEntry) {
			return pagePath;
		}

		return `${pageDirectory}/${matchingEntry.name}`;
	} catch {
		return pagePath;
	}
};

const buildDirtyResponse = (
	headTag: string,
	indexPath: string,
	maybeProps: Record<string, unknown> | undefined
) => {
	const propsScript = `window.__INITIAL_PROPS__=${JSON.stringify(maybeProps ?? {})};`;
	const dirtyFlag = 'window.__SSR_DIRTY__=true;';
	const html =
		`<!DOCTYPE html><html>${headTag}<body><div id="root"></div>` +
		`<script>${propsScript}${dirtyFlag}</script>` +
		`<script type="module" src="${indexPath}"></script>` +
		`</body></html>`;

	return new Response(html, {
		headers: { 'Content-Type': 'text/html' }
	});
};

export const handleVuePageRequest = async <Component extends VueComponent>(
	_PageComponent: Component,
	pagePath: string,
	indexPath: string,
	headTag: `<head>${string}</head>` = '<head></head>',
	...props: keyof VuePropsOf<Component> extends never
		? [props?: Record<string, never>]
		: [props: NoInfer<VuePropsOf<Component>>]
) => {
	const [maybeProps] = props;

	if (ssrDirty) {
		return buildDirtyResponse(headTag, indexPath, maybeProps);
	}

	try {
		const resolvePageComponent = async () => {
			const passedPageComponent: unknown = _PageComponent;
			if (isGenericVueComponent(passedPageComponent)) {
				return {
					component: passedPageComponent,
					hasIslands: readHasIslands(passedPageComponent)
				};
			}

			const generatedPagePath =
				await resolveCurrentGeneratedVueModulePath(pagePath);
			const importedPageModule: unknown = await import(generatedPagePath);
			const importedPageComponent =
				readDefaultExport(importedPageModule) ?? importedPageModule;
			if (!isGenericVueComponent(importedPageComponent)) {
				throw new Error(
					`Invalid Vue page module: ${generatedPagePath}`
				);
			}

			return {
				component: importedPageComponent,
				hasIslands: readHasIslands(importedPageModule)
			};
		};

		const resolvedPage = await resolvePageComponent();
		const { createSSRApp, h } = await import('vue');
		const { renderToWebStream } = await import('vue/server-renderer');

		const app = createSSRApp({
			render: () => h(resolvedPage.component, maybeProps ?? null)
		});

		const bodyStream = renderToWebStream(app);

		const head = `<!DOCTYPE html><html>${headTag}<body><div id="root">`;
		const tail = `</div><script>window.__INITIAL_PROPS__=${JSON.stringify(
			maybeProps ?? {}
		)}</script><script type="module" src="${indexPath}"></script></body></html>`;

		const stream = new ReadableStream({
			start(controller) {
				controller.enqueue(head);
				const reader = bodyStream.getReader();
				const pumpLoop = () => {
					reader
						.read()
						.then(({ done, value }) =>
							done
								? (controller.enqueue(tail), controller.close())
								: (controller.enqueue(value), pumpLoop())
						)
						.catch((err) => controller.error(err));
				};
				pumpLoop();
			}
		});

		const html = injectIslandPageContext(
			await new Response(stream).text(),
			{
				hasIslands: resolvedPage.hasIslands
			}
		);

		return new Response(html, {
			headers: { 'Content-Type': 'text/html' }
		});
	} catch (error) {
		console.error('[SSR] Vue render error:', error);

		const pageName = derivePageName(pagePath);
		const conventionResponse = await renderConventionError(
			'vue',
			pageName,
			error
		);
		if (conventionResponse) return conventionResponse;

		return new Response(ssrErrorPage('vue', error), {
			headers: { 'Content-Type': 'text/html' },
			status: 500
		});
	}
};

export const invalidateVueSsrCache = () => {
	ssrDirty = true;
};
