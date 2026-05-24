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

// `held` is the buffer kept from `</head>` onward once `sawHead` is true;
// `pending` is the not-yet-flushed text before `</head>`; `injected` flips on
// once the scripts have been emitted and the rest can stream straight through.
type IslandMarkerStreamState = {
	held: string;
	injected: boolean;
	pending: string;
	sawHead: boolean;
};

// Streaming injector for pages whose island presence isn't known up front.
// The manifest/state/bootstrap scripts must land in `<head>` — React 19
// tolerates hoistable elements (scripts/links/…) there during hydration, but
// injecting them inline in the body (e.g. just before the first island marker)
// makes them a sibling inside a host-React-rendered element, which breaks
// hydration with a structural mismatch. `</head>` is streamed before any body
// island, so we flush the head immediately, then hold from `</head>` onward
// until we can confirm whether the body actually contains an island. If it
// does, we inject right before the held `</head>`; if it doesn't, we flush the
// held content untouched so island-free pages don't pull in the runtime.
const pipeStreamWithIslandMarkerDetection = (
	stream: ReadableStream<string | Uint8Array>,
	markup: string
) => {
	const encoder = new TextEncoder();
	const decoder = new TextDecoder();
	const headLookbehind = CLOSING_HEAD_TAG.length - 1;

	const enqueue = (
		controller: ReadableStreamDefaultController<Uint8Array>,
		text: string
	) => {
		if (text.length > 0) {
			controller.enqueue(encoder.encode(text));
		}
	};
	// From `</head>` onward: hold until an island marker confirms the page has
	// islands, then inject the scripts just before the held `</head>`.
	const processHolding = (
		controller: ReadableStreamDefaultController<Uint8Array>,
		held: string
	) => {
		if (!held.includes(ISLAND_MARKER)) {
			return { held, injected: false, pending: '', sawHead: true };
		}
		enqueue(controller, `${markup}${held}`);

		return { held: '', injected: true, pending: '', sawHead: true };
	};
	// Before `</head>`: flush safe text and watch for the head close tag.
	const processHead = (
		controller: ReadableStreamDefaultController<Uint8Array>,
		pending: string
	) => {
		const headIndex = pending.indexOf(CLOSING_HEAD_TAG);
		if (headIndex < 0) {
			return {
				held: '',
				injected: false,
				pending: flushSafePendingText(
					controller,
					encoder,
					pending,
					headLookbehind
				),
				sawHead: false
			};
		}
		enqueue(controller, pending.slice(0, headIndex));

		return processHolding(controller, pending.slice(headIndex));
	};
	const processChunk = (
		controller: ReadableStreamDefaultController<Uint8Array>,
		state: IslandMarkerStreamState,
		chunk: string
	) => {
		if (state.injected) {
			enqueue(controller, chunk);

			return state;
		}
		if (!state.sawHead) {
			return processHead(controller, state.pending + chunk);
		}

		return processHolding(controller, state.held + chunk);
	};
	const finishMarkerStream = (
		controller: ReadableStreamDefaultController<Uint8Array>,
		state: IslandMarkerStreamState
	) => {
		const tail = decoder.decode();
		// `injected` → tail only; `sawHead` (held, no islands) → flush as-is;
		// otherwise no `</head>` was ever seen, so pass the buffer through.
		const remainder = state.injected
			? tail
			: (state.sawHead ? state.held : state.pending) + tail;
		enqueue(controller, remainder);
		controller.close();
	};
	const runMarkerLoop = (
		controller: ReadableStreamDefaultController<Uint8Array>,
		reader: ReadableStreamDefaultReader<string | Uint8Array>
	) => {
		const consumeNext = async (state: IslandMarkerStreamState) => {
			const { done, value } = await readStreamChunk(reader);
			if (done || !value) {
				return state;
			}

			return consumeNext(
				processChunk(
					controller,
					state,
					streamChunkToString(value, decoder)
				)
			);
		};

		return consumeNext({
			held: '',
			injected: false,
			pending: '',
			sawHead: false
		});
	};

	return new ReadableStream<Uint8Array>({
		async start(controller) {
			const reader = stream.getReader();

			try {
				const finalState = await runMarkerLoop(controller, reader);
				finishMarkerStream(controller, finalState);
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
