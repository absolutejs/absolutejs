import type { Component as SvelteComponent } from 'svelte';
import type { SveltePropsOf } from '../../types/svelte';
import { compileSvelteServerModule } from '../core/svelteServerModule';
import { injectIslandPageContextStream } from '../core/islandPageContext';
import { getCurrentRouteRegistrationCallsite } from '../core/devRouteRegistrationCallsite';
import {
	type StreamingSlotEnhancerOptions,
	withRegisteredStreamingSlots
} from '../core/responseEnhancers';
import {
	captureStreamingSlotWarningCallsite,
	runWithStreamingSlotWarningScope
} from '../core/streamingSlotWarningScope';
import { isSsrCacheDirty, markSsrCacheDirty } from '../core/ssrCache';
import { ssrErrorPage } from '../utils/ssrErrorPage';
import {
	derivePageName,
	renderConventionError
} from '../utils/resolveConvention';

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
	const propsScript = `window.__ABS_SLOT_HYDRATION_PENDING__=true;window.__INITIAL_PROPS__=${JSON.stringify(props)};${indexPath ? `import(${JSON.stringify(indexPath)});` : ''}`;
	const dirtyFlag = 'window.__SSR_DIRTY__=true;';
	const html = `<!DOCTYPE html><html><head></head><body><script>${propsScript}${dirtyFlag}</script></body></html>`;

	return new Response(html, {
		headers: { 'Content-Type': 'text/html' }
	});
};

export type SveltePageRenderOptions = {
	collectStreamingSlots?: boolean;
	bodyContent?: string;
	headContent?: string;
} & StreamingSlotEnhancerOptions;

type HasNoSvelteProps<Props> = [Props] extends [never]
	? true
	: keyof Props extends never
		? true
		: false;

export type SveltePageRequestInput<
	Component extends SvelteComponent<never> = SvelteComponent<
		Record<never, never>
	>
> = SveltePageRenderOptions & {
	indexPath: string;
	pagePath: string;
} & (HasNoSvelteProps<SveltePropsOf<Component>> extends true
		? { props?: NoInfer<SveltePropsOf<Component>> }
		: { props: NoInfer<SveltePropsOf<Component>> });

export const handleSveltePageRequest = async <
	Component extends SvelteComponent<never>
>(
	input: SveltePageRequestInput<Component>
) => {
	const resolvedIndexPath = input.indexPath;
	const resolvedOptions = input;
	const resolvedPagePath = input.pagePath;
	const resolvedProps = input.props;

	if (isSsrCacheDirty('svelte')) {
		return buildDirtyResponse(resolvedIndexPath, resolvedProps);
	}

	try {
		const handlerCallsite =
			resolvedOptions?.collectStreamingSlots === true
				? undefined
				: (getCurrentRouteRegistrationCallsite() ??
					captureStreamingSlotWarningCallsite());
		const renderPageResponse = async () => {
			const resolvePageComponent =
				async (): Promise<ResolvedSveltePage> => {
					const loadCompiledSourcePath = async (
						sourcePath: string
					): Promise<ResolvedSveltePage> => {
						const compiledModulePath =
							await compileSvelteServerModule(sourcePath);
						const loadedModule: unknown = await import(
							compiledModulePath
						);
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

					const importedPageModule: unknown = await import(
						resolvedPagePath
					);
					const importedPageComponent =
						readDefaultExport(importedPageModule) ??
						importedPageModule;

					if (
						typeof importedPageComponent === 'string' &&
						importedPageComponent.endsWith('.svelte')
					) {
						return loadCompiledSourcePath(importedPageComponent);
					}

					if (!isGenericSvelteComponent(importedPageComponent)) {
						throw new Error(
							`Invalid Svelte page module: ${resolvedPagePath}`
						);
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
				resolvedProps,
				{
					bodyContent: resolvedOptions?.bodyContent,
					bootstrapScriptContent: `window.__ABS_SLOT_HYDRATION_PENDING__=true;window.__INITIAL_PROPS__=${JSON.stringify(
						resolvedProps
					)};${resolvedIndexPath ? `import(${JSON.stringify(resolvedIndexPath)});` : ''}`,
					headContent: resolvedOptions?.headContent
				}
			);

			const htmlStream = injectIslandPageContextStream(stream, {
				hasIslands: resolvedPage.hasIslands ? true : undefined
			});

			return new Response(htmlStream, {
				headers: { 'Content-Type': 'text/html' }
			});
		};

		return runWithStreamingSlotWarningScope(
			() =>
				resolvedOptions?.collectStreamingSlots === true
					? withRegisteredStreamingSlots(renderPageResponse, {
							...resolvedOptions,
							runtimePlacement:
								resolvedOptions.runtimePlacement ?? 'body'
						})
					: renderPageResponse(),
			{ handlerCallsite }
		);
	} catch (error) {
		console.error('[SSR] Svelte render error:', error);

		const pageName = derivePageName(resolvedPagePath);
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
	markSsrCacheDirty('svelte');
};
