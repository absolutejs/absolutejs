import type {
	RenderErrorPage,
	RenderNotFoundPage
} from '../../types/conventions';

export const defineRenderErrorPage = (renderErrorPage: RenderErrorPage) =>
	renderErrorPage;

export const defineRenderNotFoundPage = (
	renderNotFoundPage: RenderNotFoundPage
) => renderNotFoundPage;
