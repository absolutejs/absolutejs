// SSR Worker — renders React components in a separate context so
// frontend imports don't pollute bun --hot's module graph.
// Each render dynamically imports the component fresh.

/* eslint-disable no-restricted-globals */

self.onmessage = async (event) => {
	const { id, componentPath, indexPath, props } = event.data;

	try {
		// Dynamic import with cache bust — always gets fresh module
		const timestamp = Date.now();
		const mod = await import(`${componentPath}?t=${timestamp}`);
		const Component = mod.default ?? Object.values(mod)[0];

		const { createElement } = await import('react');
		const { renderToReadableStream } = await import('react-dom/server');

		const propsScript = props
			? `window.__INITIAL_PROPS__=${JSON.stringify(props)}`
			: '';

		const element = props
			? createElement(Component, props)
			: createElement(Component);

		const stream = await renderToReadableStream(element, {
			bootstrapModules: indexPath ? [indexPath] : [],
			bootstrapScriptContent: propsScript || undefined,
			onError(error: unknown) {
				console.error('[SSR Worker] React streaming error:', error);
			}
		});

		// Collect the stream into a string
		const reader = stream.getReader();
		const chunks: string[] = [];
		const decoder = new TextDecoder();

		let done = false;
		while (!done) {
			const result = await reader.read();
			done = result.done;
			if (result.value) {
				chunks.push(decoder.decode(result.value, { stream: !done }));
			}
		}

		self.postMessage({ html: chunks.join(''), id, ok: true });
	} catch (error) {
		const message =
			error instanceof Error ? error.message : String(error);
		self.postMessage({ error: message, id, ok: false });
	}
};
