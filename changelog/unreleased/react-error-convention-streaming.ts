import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: "Adding an `error` convention turned streaming off for React pages. The handler buffered the whole document whenever an error convention existed for the page or anywhere in the app, so a page that streamed its shell in milliseconds began arriving only once its slowest Suspense boundary had resolved — measured at 603ms to first byte against 11ms for the same page without the convention. Nothing announced it: adding `error.tsx` looks unrelated to streaming, and the only symptom is a page that got slower. The buffering existed so the handler could answer a failed render with the convention's error page instead of half a document, and it was not needed for that: the only error that can be answered with an error page is one in the shell, and `renderToReadableStream` rejects for those before a byte is written, so the handler's catch still gets it. An error after the shell is React's to report through a boundary either way, since the status and the opening markup are already committed. React pages now stream whether or not an error convention exists, and a shell error still answers with the convention's page.",
	kind: 'fixed',
	summary:
		'An `error` convention no longer turns off streaming for React pages'
};
