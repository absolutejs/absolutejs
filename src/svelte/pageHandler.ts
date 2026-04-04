import type { Component as SvelteComponent } from 'svelte';
import { compileSvelteServerModule } from '../core/svelteServerModule';
import {
	htmlContainsIslands,
	injectIslandPageContext
} from '../core/islandPageContext';
import { ssrErrorPage } from '../utils/ssrErrorPage';
import {
	derivePageName,
	renderConventionError
} from '../utils/resolveConvention';

let ssrDirty = false;
type GenericSvelteComponent = SvelteComponent<Record<string, unknown>>;
type ResolvedSveltePage = {
	component: GenericSvelteComponent;
	hasIslands: boolean;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null;

const isGenericSvelteComponent = (
	value: unknown
): value is GenericSvelteComponent =>
	typeof value === 'function' || isRecord(value);

const readHasIslands = (value: unknown) => {
	if (!isRecord(value)) return false;
	const hasIslands = value['__ABSOLUTE_PAGE_HAS_ISLANDS__'];

	return typeof hasIslands === 'boolean' ? hasIslands : false;
};

const readDefaultExport = (value: unknown) =>
	isRecord(value) ? value.default : undefined;

const buildDirtyResponse = (indexPath: string, props?: unknown) => {
	const propsScript = `window.__INITIAL_PROPS__=${JSON.stringify(props)};`;
	const dirtyFlag = 'window.__SSR_DIRTY__=true;';
	const scriptTag = indexPath
		? `<script type="module" src="${indexPath}"></script>`
		: '';
	const html = `<!DOCTYPE html><html><head></head><body><script>${propsScript}${dirtyFlag}</script>${scriptTag}</body></html>`;

	return new Response(html, {
		headers: { 'Content-Type': 'text/html' }
	});
};

export type SveltePageRenderOptions = {
	bodyContent?: string;
	headContent?: string;
};

export type HandleSveltePageRequest = {
	(
		PageComponent: SvelteComponent<Record<string, never>>,
		pagePath: string,
		indexPath: string
	): Promise<Response>;
	<P extends Record<string, unknown>>(
		PageComponent: SvelteComponent<P>,
		pagePath: string,
		indexPath: string,
		props: NoInfer<P>,
		options?: SveltePageRenderOptions
	): Promise<Response>;
};

export const handleSveltePageRequest: HandleSveltePageRequest = async <
	P extends Record<string, unknown>
>(
	PageComponent: SvelteComponent<P>,
	pagePath: string,
	indexPath: string,
	props?: P,
	options?: SveltePageRenderOptions
) => {
	if (ssrDirty) {
		return buildDirtyResponse(indexPath, props);
	}

	try {
		const resolvePageComponent = async (): Promise<ResolvedSveltePage> => {
			const passedPageComponent: unknown = PageComponent;
			if (isGenericSvelteComponent(passedPageComponent)) {
				return {
					component: passedPageComponent,
					hasIslands: readHasIslands(passedPageComponent)
				};
			}

			const loadCompiledSourcePath = async (
				sourcePath: string
			): Promise<ResolvedSveltePage> => {
				const compiledModulePath =
					await compileSvelteServerModule(sourcePath);
				const loadedModule: unknown = await import(compiledModulePath);
				const loadedComponent =
					readDefaultExport(loadedModule) ?? loadedModule;
				if (!isGenericSvelteComponent(loadedComponent)) {
					throw new Error(
						`Invalid compiled Svelte page module: ${sourcePath}`
					);
				}

				return {
					component: loadedComponent,
					hasIslands: readHasIslands(loadedModule)
				};
			};

			if (
				typeof passedPageComponent === 'string' &&
				passedPageComponent.endsWith('.svelte')
			) {
				return loadCompiledSourcePath(passedPageComponent);
			}

			const importedPageModule: unknown = await import(pagePath);
			const importedPageComponent =
				readDefaultExport(importedPageModule) ?? importedPageModule;

			if (
				typeof importedPageComponent === 'string' &&
				importedPageComponent.endsWith('.svelte')
			) {
				return loadCompiledSourcePath(importedPageComponent);
			}

			if (!isGenericSvelteComponent(importedPageComponent)) {
				throw new Error(`Invalid Svelte page module: ${pagePath}`);
			}

			return {
				component: importedPageComponent,
				hasIslands: readHasIslands(importedPageModule)
			};
		};

		const { renderToReadableStream } = await import(
			'./renderToReadableStream'
		);
		const resolvedPage = await resolvePageComponent();

		const stream = await renderToReadableStream(
			resolvedPage.component,
			props,
			{
				bodyContent: options?.bodyContent,
				bootstrapModules: indexPath ? [indexPath] : [],
				bootstrapScriptContent: `window.__INITIAL_PROPS__=${JSON.stringify(
					props
				)}`,
				headContent: options?.headContent
			}
		);

		const renderedHtml = await new Response(stream).text();
		const html = injectIslandPageContext(renderedHtml, {
			hasIslands:
				resolvedPage.hasIslands || htmlContainsIslands(renderedHtml)
		});

		return new Response(html, {
			headers: { 'Content-Type': 'text/html' }
		});
	} catch (error) {
		console.error('[SSR] Svelte render error:', error);

		const pageName = derivePageName(pagePath);
		const conventionResponse = await renderConventionError(
			'svelte',
			pageName,
			error
		);
		if (conventionResponse) return conventionResponse;

		return new Response(ssrErrorPage('svelte', error), {
			headers: { 'Content-Type': 'text/html' },
			status: 500
		});
	}
};

export const invalidateSvelteSsrCache = () => {
	ssrDirty = true;
};
