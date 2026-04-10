import { Elysia } from 'elysia';
import { ragChat, createInMemoryRAGStore } from './src/ai';
import type { AIChunk } from './types/ai';

const PORT = Number(process.env.RAG_SMOKE_PORT ?? 0) || 49_999;

const provider = {
	stream: async function* () {
		yield {
			type: 'text',
			content: 'I found the answer from context.'
		} as AIChunk;
		yield {
			type: 'done',
			usage: { inputTokens: 3, outputTokens: 7 }
		} as AIChunk;
	}
};

const store = createInMemoryRAGStore();

await store.upsert({
	chunks: [
		{
			chunkId: 'c1',
			text: 'AbsoluteJS supports vector databases with RAG integrations.',
			title: 'intro',
			source: 'intro-doc'
		}
	]
});

const app = new Elysia().use(
	ragChat({
		path: '/rag',
		provider: () => provider,
		model: 'test-model',
		ragStore: store
	})
);

const listener = await app.listen({ port: PORT || 0, hostname: '127.0.0.1' });
const selectedPort =
	typeof listener === 'object' && 'port' in listener ? listener.port : PORT;
console.log('listening', selectedPort);

const socket = new WebSocket(`ws://127.0.0.1:${selectedPort}/rag`);
const events: string[] = [];

await new Promise<void>((resolve, reject) => {
	let completeSeen = false;
	let retrievedSeen = false;
	const done = () => {
		if (completeSeen || (retrievedSeen && Date.now() - startTime >= 1000)) {
			resolve();
		}
	};
	const timeout = setTimeout(() => done(), 5000);
	const startTime = Date.now();

	socket.onmessage = (event) => {
		const text =
			typeof event.data === 'string'
				? Promise.resolve(event.data)
				: event.data.text();

		text.then((messageText: string) => {
			events.push(messageText);
			try {
				const parsed = JSON.parse(messageText);
				if (parsed.type === 'rag_retrieved') {
					retrievedSeen = true;
					if (Date.now() - startTime >= 1000) {
						done();
					}
				}
				if (parsed.type === 'complete') {
					completeSeen = true;
					done();
				}
			} catch {
				// ignore
			}
		}).catch(() => {
			// ignore
		});
	};

	socket.onopen = () => {
		socket.send(
			JSON.stringify({
				type: 'message',
				content: 'What about AbsoluteJS and vector DBs?'
			})
		);
	};

	socket.onerror = (err) => {
		reject(new Error(String((err as ErrorEvent).message ?? err)));
	};

	socket.onclose = () => {
		clearTimeout(timeout);
		done();
	};
});

console.log('RAG smoke events:', events);
socket.close();
await app.stop();
