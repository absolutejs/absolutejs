import { AsyncLocalStorage } from 'node:async_hooks';
import type { Type } from '@angular/core';
import type { AngularPageImporter } from '../../types/angular';
import { BASE_36_RADIX, RANDOM_ID_END_INDEX } from '../constants';
import { ssrErrorPage } from '../utils/ssrErrorPage';
import { setSsrContextGetter } from '../utils/registerClientScript';
import { getAngularDeps } from './angularDeps';
import { getSsrSanitizer, resetSsrSanitizer } from './ssrSanitizer';
import {
	buildDeps,
	buildProviders,
	cacheRouteData,
	discoverTokens,
	injectSsrScripts,
	loadSsrDeps,
	renderAngularApp,
	resolveSelector
} from './ssrRender';

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
		try {
			const [maybeProps] = props;

			// Cache props + headTag for HMR replay — strip query strings
			// so cache-busted HMR paths match the original manifest path.
			cacheRouteData(pagePath, { headTag, props: maybeProps });

			const baseDeps = await getAngularDeps();
			const pageModule = await import(pagePath);
			const PageComponent: Type<unknown> = pageModule.default;

			const ssrResult = await loadSsrDeps(pagePath);
			const deps = buildDeps(ssrResult, baseDeps);

			const tokenMap = discoverTokens(pageModule);
			const selector = resolveSelector(deps, pagePath, PageComponent);

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

			const html = injectSsrScripts(rawHtml, requestId, indexPath);

			return new Response(html, {
				headers: { 'Content-Type': 'text/html' }
			});
		} catch (error) {
			console.error('[SSR] Angular render error:', error);

			return new Response(ssrErrorPage('angular', error), {
				headers: { 'Content-Type': 'text/html' },
				status: 500
			});
		}
	});
};
