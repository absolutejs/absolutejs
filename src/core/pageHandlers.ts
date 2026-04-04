import { file } from 'bun';
import { transformCurrentStaticPageHtml } from '../build/staticIslandPages';
import { injectIslandPageContext } from './islandPageContext';

export { handleReactPageRequest } from '../react/pageHandler';

const handleStaticPageRequest = async (pagePath: string) => {
	const html = await file(pagePath).text();
	const transformedHtml = await transformCurrentStaticPageHtml(html);

	return new Response(injectIslandPageContext(transformedHtml), {
		headers: { 'Content-Type': 'text/html' }
	});
};

export const handleHTMLPageRequest = (pagePath: string) =>
	handleStaticPageRequest(pagePath);

export const handleHTMXPageRequest = (pagePath: string) =>
	handleStaticPageRequest(pagePath);
