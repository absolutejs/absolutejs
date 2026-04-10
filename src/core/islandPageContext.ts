import { BYTES_PER_KILOBYTE } from '../constants';

const BOOTSTRAP_MANIFEST_KEY = 'BootstrapClient';
const ISLAND_MARKER = 'data-island="true"';
const MANIFEST_MARKER = '__ABSOLUTE_MANIFEST__';
const ISLAND_STATE_MARKER = '__ABS_ISLAND_STATE__';
const CLOSING_HEAD_TAG = '</head>';

declare global {
	var __absoluteManifest: Record<string, string> | undefined;
	var __ABS_ISLAND_STATE__:
		| Record<string, Record<string, unknown>>
		| undefined;
}

const buildIslandsHeadMarkup = (manifest: Record<string, string>) => {
	const manifestScript = `<script>window.__ABSOLUTE_MANIFEST__ = ${JSON.stringify(manifest)}</script>`;
	const islandStateScript = `<script>window.__ABS_ISLAND_STATE__ = ${JSON.stringify(globalThis.__ABS_ISLAND_STATE__ ?? {})}</script>`;
	const bootstrapPath = manifest[BOOTSTRAP_MANIFEST_KEY];
	const bootstrapScript = bootstrapPath
		? `<script type="module" src="${bootstrapPath}"></script>`
		: '';

	return `${manifestScript}${islandStateScript}${bootstrapScript}`;
};

const injectHeadMarkup = (html: string, markup: string) => {
	const closingHeadIndex = html.indexOf('</head>');
	if (closingHeadIndex >= 0) {
		return `${html.slice(0, closingHeadIndex)}${markup}${html.slice(closingHeadIndex)}`;
	}

	const openingBodyIndex = html.indexOf('<body');
	if (openingBodyIndex >= 0) {
		const bodyStart = html.indexOf('>', openingBodyIndex);
		if (bodyStart >= 0) {
			return `${html.slice(0, openingBodyIndex)}<head>${markup}</head>${html.slice(openingBodyIndex)}`;
		}
	}

	return `<!DOCTYPE html><html><head>${markup}</head><body>${html}</body></html>`;
};

const streamChunkToString = (
	value: string | Uint8Array,
	decoder: TextDecoder
) =>
	typeof value === 'string' ? value : decoder.decode(value, { stream: true });

const flushSafePendingText = (
	controller: ReadableStreamDefaultController<Uint8Array>,
	encoder: TextEncoder,
	pending: string,
	lookbehind: number
) => {
	if (pending.length <= lookbehind) {
		return pending;
	}

	const safeText = pending.slice(0, pending.length - lookbehind);
	controller.enqueue(encoder.encode(safeText));

	return pending.slice(-lookbehind);
};

const updateInjectedState = (
	consumed: { done: boolean; injected: boolean; pending: string },
	injected: boolean,
	pending: string
) => {
	if (consumed.done) {
		return { done: true, injected, pending };
	}

	return {
		done: false,
		injected: consumed.injected,
		pending: consumed.pending
	};
};

const readStreamChunk = async (
	reader: ReadableStreamDefaultReader<string | Uint8Array>
) => {
	const { done, value } = await reader.read();
	if (done || !value) {
		return { done, value: undefined };
	}

	return { done, value };
};

const pipeStreamWithHeadInjection = (
	stream: ReadableStream<string | Uint8Array>,
	markup: string
) => {
	const encoder = new TextEncoder();
	const decoder = new TextDecoder();
	const lookbehind = CLOSING_HEAD_TAG.length - 1;
	const processPending = (
		controller: ReadableStreamDefaultController<Uint8Array>,
		pending: string,
		injected: boolean
	) => {
		if (injected) {
			controller.enqueue(encoder.encode(pending));

			return { injected, pending: '' };
		}

		const headIndex = pending.indexOf(CLOSING_HEAD_TAG);
		if (headIndex >= 0) {
			const next = `${pending.slice(0, headIndex)}${markup}${pending.slice(headIndex)}`;
			controller.enqueue(encoder.encode(next));

			return { injected: true, pending: '' };
		}

		return {
			injected,
			pending: flushSafePendingText(
				controller,
				encoder,
				pending,
				lookbehind
			)
		};
	};
	const finishHeadInjectionStream = (
		controller: ReadableStreamDefaultController<Uint8Array>,
		pending: string,
		injected: boolean
	) => {
		let finalPending = pending + decoder.decode();
		if (!injected) {
			finalPending = injectHeadMarkup(finalPending, markup);
		}
		if (finalPending.length > 0) {
			controller.enqueue(encoder.encode(finalPending));
		}
		controller.close();
	};
	const consumeHeadChunk = async (
		controller: ReadableStreamDefaultController<Uint8Array>,
		reader: ReadableStreamDefaultReader<string | Uint8Array>,
		pending: string,
		injected: boolean
	) => {
		const { done, value } = await readStreamChunk(reader);
		if (done || !value) {
			return { done, injected, pending };
		}

		const processed = processPending(
			controller,
			pending + streamChunkToString(value, decoder),
			injected
		);

		return {
			done,
			injected: processed.injected,
			pending: processed.pending
		};
	};
	const runHeadInjectionLoop = async (
		controller: ReadableStreamDefaultController<Uint8Array>,
		reader: ReadableStreamDefaultReader<string | Uint8Array>
	) => {
		const consumeNextHeadChunk = async (
			injected: boolean,
			pending: string
		) => {
			const consumed = await consumeHeadChunk(
				controller,
				reader,
				pending,
				injected
			);
			const nextState = updateInjectedState(consumed, injected, pending);
			if (nextState.done) {
				return { injected, pending };
			}

			return consumeNextHeadChunk(nextState.injected, nextState.pending);
		};

		return consumeNextHeadChunk(false, '');
	};

	return new ReadableStream<Uint8Array>({
		async start(controller) {
			const reader = stream.getReader();

			try {
				const { injected, pending } = await runHeadInjectionLoop(
					controller,
					reader
				);
				finishHeadInjectionStream(controller, pending, injected);
			} catch (error) {
				controller.error(error);
			}
		}
	});
};

const pipeStreamWithIslandMarkerDetection = (
	stream: ReadableStream<string | Uint8Array>,
	markup: string
) => {
	const encoder = new TextEncoder();
	const decoder = new TextDecoder();
	// Keep enough context to catch split markers and find the start tag.
	const lookbehind = Math.max(ISLAND_MARKER.length, BYTES_PER_KILOBYTE);
	const processPending = (
		controller: ReadableStreamDefaultController<Uint8Array>,
		pending: string,
		injected: boolean
	) => {
		if (injected) {
			controller.enqueue(encoder.encode(pending));

			return { injected, pending: '' };
		}

		const markerIndex = pending.indexOf(ISLAND_MARKER);
		if (markerIndex >= 0) {
			const tagStart = pending.lastIndexOf('<', markerIndex);
			const injectAt = tagStart >= 0 ? tagStart : markerIndex;
			const next = `${pending.slice(0, injectAt)}${markup}${pending.slice(injectAt)}`;
			controller.enqueue(encoder.encode(next));

			return { injected: true, pending: '' };
		}

		return {
			injected,
			pending: flushSafePendingText(
				controller,
				encoder,
				pending,
				lookbehind
			)
		};
	};
	const finishIslandMarkerStream = (
		controller: ReadableStreamDefaultController<Uint8Array>,
		pending: string
	) => {
		const finalPending = pending + decoder.decode();
		if (finalPending.length > 0) {
			controller.enqueue(encoder.encode(finalPending));
		}
		controller.close();
	};
	const consumeIslandChunk = async (
		controller: ReadableStreamDefaultController<Uint8Array>,
		reader: ReadableStreamDefaultReader<string | Uint8Array>,
		pending: string,
		injected: boolean
	) => {
		const { done, value } = await readStreamChunk(reader);
		if (done || !value) {
			return { done, injected, pending };
		}

		const processed = processPending(
			controller,
			pending + streamChunkToString(value, decoder),
			injected
		);

		return {
			done,
			injected: processed.injected,
			pending: processed.pending
		};
	};
	const runIslandMarkerLoop = async (
		controller: ReadableStreamDefaultController<Uint8Array>,
		reader: ReadableStreamDefaultReader<string | Uint8Array>
	) => {
		const consumeNextIslandChunk = async (
			injected: boolean,
			pending: string
		) => {
			const consumed = await consumeIslandChunk(
				controller,
				reader,
				pending,
				injected
			);
			const nextState = updateInjectedState(consumed, injected, pending);
			if (nextState.done) {
				return { injected, pending };
			}

			return consumeNextIslandChunk(
				nextState.injected,
				nextState.pending
			);
		};

		return consumeNextIslandChunk(false, '');
	};

	return new ReadableStream<Uint8Array>({
		async start(controller) {
			const reader = stream.getReader();

			try {
				const { pending } = await runIslandMarkerLoop(
					controller,
					reader
				);
				finishIslandMarkerStream(controller, pending);
			} catch (error) {
				controller.error(error);
			}
		}
	});
};

export const htmlContainsIslands = (html: string) =>
	html.includes(ISLAND_MARKER);
export const injectIslandPageContext = (
	html: string,
	options?: { hasIslands?: boolean }
) => {
	const manifest = globalThis.__absoluteManifest;
	const hasIslands = options?.hasIslands ?? htmlContainsIslands(html);
	if (!manifest || !hasIslands) {
		return html;
	}

	if (html.includes(MANIFEST_MARKER) || html.includes(ISLAND_STATE_MARKER)) {
		return html;
	}

	return injectHeadMarkup(html, buildIslandsHeadMarkup(manifest));
};

export const injectIslandPageContextStream = (
	stream: ReadableStream<string | Uint8Array>,
	options?: { hasIslands?: boolean }
) => {
	const manifest = globalThis.__absoluteManifest;
	if (!manifest) return stream;
	const markup = buildIslandsHeadMarkup(manifest);

	if (options?.hasIslands === true) {
		return pipeStreamWithHeadInjection(stream, markup);
	}
	if (options?.hasIslands === false) {
		return stream;
	}

	return pipeStreamWithIslandMarkerDetection(stream, markup);
};
export const setCurrentIslandManifest = (manifest: Record<string, string>) => {
	globalThis.__absoluteManifest = manifest;
};
