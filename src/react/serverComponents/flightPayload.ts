import { nonceAttr } from '../../utils/cspNonceRef';
import { REACT_SERVER_PAYLOAD_GLOBAL } from './constants';

/* Inlines the Flight (RSC) payload into the HTML stream so the browser
 * hydrates from the same render instead of fetching it again. Each decoded
 * Flight chunk becomes
 *   <script nonce>(self.X??=[]).push("…")</script>
 * once the <body> has opened, and the rest lands just before </body>. The
 * hydration entry drains that array into a ReadableStream. */

const BODY_OPEN = /<body[\s>]/i;
const BODY_CLOSE = '</body>';

/* JSON escapes quotes and control characters; `<` is escaped too so the
 * payload can never close the script element or open a comment. */
const escapePayloadChunk = (chunk: string) =>
	JSON.stringify(chunk)
		.replace(/</g, '\\u003c')
		.replace(/\u2028/g, '\\u2028')
		.replace(/\u2029/g, '\\u2029');

export const flightPayloadScript = (chunk: string, nonce?: string) =>
	`<script${nonceAttr(nonce)}>(self.${REACT_SERVER_PAYLOAD_GLOBAL}??=[]).push(${escapePayloadChunk(chunk)})</script>`;

/* Decodes a byte stream as UTF-8 text, calling `onText` per chunk (a
 * multi-byte character split across chunks is held until complete). */
const readText = async (
	stream: ReadableStream<Uint8Array>,
	onText: (text: string) => void
) => {
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	const step = async (): Promise<void> => {
		const { done, value } = await reader.read();
		if (done) {
			onText(decoder.decode());

			return;
		}
		onText(decoder.decode(value, { stream: true }));
		await step();
	};
	await step();
};

const takeAll = (pending: string[]) => pending.splice(0).join('');

export const injectFlightPayload = (
	html: ReadableStream<Uint8Array>,
	flight: ReadableStream<Uint8Array>,
	nonce?: string
) => {
	const encoder = new TextEncoder();
	const pending: string[] = [];
	const flightDone = readText(flight, (text) => {
		if (text) pending.push(flightPayloadScript(text, nonce));
	});
	// Surfaced when the HTML stream finishes; never an unhandled rejection.
	flightDone.catch(() => undefined);
	let bodyOpen = false;
	let tail = '';

	const handleHtml = (
		controller: ReadableStreamDefaultController<Uint8Array>,
		text: string
	) => {
		if (!text) return;
		if (tail) {
			tail += text;

			return;
		}
		const closeIndex = text.indexOf(BODY_CLOSE);
		if (closeIndex >= 0) {
			tail = text.slice(closeIndex);
			controller.enqueue(
				encoder.encode(text.slice(0, closeIndex) + takeAll(pending))
			);

			return;
		}
		bodyOpen = bodyOpen || BODY_OPEN.test(text);
		controller.enqueue(
			encoder.encode(bodyOpen ? text + takeAll(pending) : text)
		);
	};

	const pump = async (
		controller: ReadableStreamDefaultController<Uint8Array>
	) => {
		try {
			await readText(html, (text) => handleHtml(controller, text));
			await flightDone;
			controller.enqueue(encoder.encode(takeAll(pending) + tail));
			controller.close();
		} catch (error) {
			controller.error(error);
		}
	};

	return new ReadableStream<Uint8Array>({
		start(controller) {
			void pump(controller);
		}
	});
};
