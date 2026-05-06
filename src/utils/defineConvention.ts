import type {
	RenderErrorPage,
	RenderNotFoundPage
} from '../../types/conventions';

export const defineRenderErrorPage = (fn: RenderErrorPage) => fn;

export const defineRenderNotFoundPage = (fn: RenderNotFoundPage) => fn;
