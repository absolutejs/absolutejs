import type { ComponentType as ReactComponent } from 'react';
import { ssrErrorPage } from '../utils/ssrErrorPage';

const isDev = process.env['NODE_ENV'] === 'development';

// Resolve page component source path from its name for worker SSR
const findComponentPath = (component: ReactComponent<Record<string, unknown>>) => {
	const name = component.displayName ?? component.name;
	if (!name) return null;

	const config = globalThis.__hmrDevResult?.hmrState?.config;
	const reactDir = config?.reactDirectory;
	if (!reactDir) return null;

	const { resolve, join } = require('node:path');
	const { existsSync } = require('node:fs');
	const pagesDir = resolve(reactDir, 'pages');

	for (const ext of ['.tsx', '.jsx', '.ts']) {
		const candidate = join(pagesDir, `${name}${ext}`);
		if (existsSync(candidate)) return candidate;
	}

	return null;
};

export const handleReactPageRequest = async <
	Props extends Record<string, unknown> = Record<never, never>
>(
	PageComponent: ReactComponent<Props>,
	index: string,
	...props: keyof Props extends never ? [] : [props: NoInfer<Props>]
) => {
	try {
		const [maybeProps] = props;

		// Dev mode: render in a worker to isolate frontend imports
		// from bun --hot's module graph (prevents server restarts)
		if (isDev) {
			const componentPath = findComponentPath(
				PageComponent as ReactComponent<Record<string, unknown>>
			);
			if (componentPath) {
				try {
					const { renderInWorker } = await import(
						'../dev/ssrRenderer'
					);
					const html = await renderInWorker({
						componentPath,
						indexPath: index,
						props: maybeProps as
							| Record<string, unknown>
							| undefined
					});

					return new Response(html, {
						headers: { 'Content-Type': 'text/html' }
					});
				} catch {
					// Worker failed — fall through to direct render
				}
			}
		}

		const { createElement } = await import('react');
		const { renderToReadableStream } = await import('react-dom/server');

		const element =
			maybeProps !== undefined
				? createElement(PageComponent, maybeProps)
				: createElement(PageComponent);

		const propsScript = maybeProps
			? `window.__INITIAL_PROPS__=${JSON.stringify(maybeProps)}`
			: '';

		const stream = await renderToReadableStream(element, {
			bootstrapModules: [index],
			bootstrapScriptContent: propsScript || undefined,
			onError(error: unknown) {
				console.error('[SSR] React streaming error:', error);
			}
		});

		return new Response(stream, {
			headers: { 'Content-Type': 'text/html' }
		});
	} catch (error) {
		console.error('[SSR] React render error:', error);

		return new Response(ssrErrorPage('react', error), {
			headers: { 'Content-Type': 'text/html' },
			status: 500
		});
	}
};
