import { AsyncLocalStorage } from 'node:async_hooks';
import type { Type } from '@angular/core';
import type { AngularPageImporter } from '../../types/angular';
import { BASE_36_RADIX, RANDOM_ID_END_INDEX } from '../constants';
import { injectIslandPageContext } from '../core/islandPageContext';
import { ssrErrorPage } from '../utils/ssrErrorPage';
import {
	derivePageName,
	renderConventionError
} from '../utils/resolveConvention';
import { setSsrContextGetter } from '../utils/registerClientScript';
import { getAngularDeps } from './angularDeps';
import { lowerAngularServerIslands } from './lowerServerIslands';
import { getSsrSanitizer, resetSsrSanitizer } from './ssrSanitizer';
import {
	buildDeps,
	buildProviders,
	cacheRouteData,
	clearSelectorCache,
	discoverTokens,
	injectSsrScripts,
	loadSsrDeps,
	renderAngularApp,
	resolveSelector
} from './ssrRender';

let ssrDirty = false;
let lastSelector = 'angular-page';
const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null;

const isAngularComponent = (value: unknown): value is Type<unknown> =>
	typeof value === 'function';

const readAngularPageModule = (value: unknown) =>
	isRecord(value) ? value : null;

export const invalidateAngularSsrCache = () => {
	ssrDirty = true;
	clearSelectorCache();
};

const angularSsrContext = new AsyncLocalStorage<string>();
setSsrContextGetter(() => angularSsrContext.getStore());

export const handleAngularPageRequest = async <
	Props extends Record<string, unknown> = Record<never, never>
>(
	_importer: AngularPageImporter<Props>,
	pagePath: string,
	indexPath: string,
	headTag: `<head>${string}</head>` = '<head></head>',
	...props: keyof Props extends never ? [] : [props: NoInfer<Props>]
) => {
	const requestId = `angular_${Date.now()}_${Math.random().toString(BASE_36_RADIX).substring(2, RANDOM_ID_END_INDEX)}`;

	return angularSsrContext.run(requestId, async () => {
		const [maybeProps] = props;

		// Cache props + headTag for HMR replay — strip query strings
		// so cache-busted HMR paths match the original manifest path.
		cacheRouteData(pagePath, { headTag, props: maybeProps });

		if (ssrDirty) {
			const script = indexPath
				? `<script type="module" src="${indexPath}"></script>`
				: '';
			const html = `<!DOCTYPE html><html>${headTag}<body><${lastSelector}></${lastSelector}>${script}</body></html>`;

			return new Response(html, {
				headers: { 'Content-Type': 'text/html' }
			});
		}

		try {
			const baseDeps = await getAngularDeps();
			const importedPageModule: unknown = await import(pagePath);
			const pageModule = readAngularPageModule(importedPageModule);
			if (!pageModule) {
				throw new Error(`Invalid Angular page module: ${pagePath}`);
			}
			const PageComponent = pageModule.default;
			if (!isAngularComponent(PageComponent)) {
				throw new Error(
					`Angular page module must export a component by default: ${pagePath}`
				);
			}
			const hasIslands =
				typeof pageModule.__ABSOLUTE_PAGE_HAS_ISLANDS__ === 'boolean'
					? pageModule.__ABSOLUTE_PAGE_HAS_ISLANDS__
					: false;

			const ssrResult = await loadSsrDeps(pagePath);
			const deps = buildDeps(ssrResult, baseDeps);

			const tokenMap = discoverTokens(pageModule);
			const selector = resolveSelector(deps, pagePath, PageComponent);
			lastSelector = selector;

			const htmlString = `<!DOCTYPE html><html>${headTag}<body><${selector}></${selector}></body></html>`;

			if (ssrResult?.core) resetSsrSanitizer();
			const sanitizer = getSsrSanitizer(deps);
			const providers = buildProviders(
				deps,
				sanitizer,
				maybeProps,
				tokenMap
			);

			const rawHtml: string = await renderAngularApp(
				deps,
				PageComponent,
				providers,
				htmlString
			);
			const shouldProcessIslands =
				hasIslands || rawHtml.includes('<absolute-island');
			const htmlWithLoweredIslands = shouldProcessIslands
				? await lowerAngularServerIslands(rawHtml)
				: rawHtml;

			const html = injectIslandPageContext(
				injectSsrScripts(
					htmlWithLoweredIslands,
					requestId,
					indexPath,
					maybeProps
				),
				{ hasIslands: shouldProcessIslands }
			);

			return new Response(html, {
				headers: { 'Content-Type': 'text/html' }
			});
		} catch (error) {
			console.error('[SSR] Angular render error:', error);

			const pageName = derivePageName(pagePath);
			const conventionResponse = await renderConventionError(
				'angular',
				pageName,
				error
			);
			if (conventionResponse) return conventionResponse;

			return new Response(ssrErrorPage('angular', error), {
				headers: { 'Content-Type': 'text/html' },
				status: 500
			});
		}
	});
};
