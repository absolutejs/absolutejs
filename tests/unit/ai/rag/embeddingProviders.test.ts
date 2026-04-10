import { describe, expect, it } from 'bun:test';
import {
	geminiEmbeddings,
	ollamaEmbeddings,
	openaiCompatibleEmbeddings,
	openaiEmbeddings
} from '../../../../src/ai/rag/embeddingProviders';

describe('embedding providers', () => {
	it('builds OpenAI embedding requests and parses vectors', async () => {
		const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> =
			[];
		const provider = openaiEmbeddings({
			apiKey: 'test-key',
			defaultModel: 'text-embedding-3-small',
			dimensions: 8,
			fetch: async (input, init) => {
				calls.push({ init, input });

				return new Response(
					JSON.stringify({
						data: [{ embedding: [0.1, 0.2, 0.3] }]
					}),
					{ status: 200 }
				);
			}
		});

		const vector = await provider.embed({ text: 'hello world' });

		expect(vector).toEqual([0.1, 0.2, 0.3]);
		expect(String(calls[0]?.input)).toBe(
			'https://api.openai.com/v1/embeddings'
		);
		expect(calls[0]?.init?.method).toBe('POST');
		expect(calls[0]?.init?.headers).toEqual({
			Authorization: 'Bearer test-key',
			'Content-Type': 'application/json'
		});
		expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
			dimensions: 8,
			encoding_format: 'float',
			input: 'hello world',
			model: 'text-embedding-3-small'
		});
	});

	it('supports OpenAI-compatible embedding base URLs', async () => {
		const calls: string[] = [];
		const provider = openaiCompatibleEmbeddings({
			apiKey: 'compat-key',
			baseUrl: 'https://api.example.com/openai',
			defaultModel: 'embed-compat',
			fetch: async (input) => {
				calls.push(String(input));

				return new Response(
					JSON.stringify({
						data: [{ embedding: [1, 2] }]
					}),
					{ status: 200 }
				);
			}
		});

		const vector = await provider.embed({ text: 'compat' });

		expect(vector).toEqual([1, 2]);
		expect(calls[0]).toBe('https://api.example.com/openai/v1/embeddings');
	});

	it('builds Gemini embedding requests and parses vectors', async () => {
		const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> =
			[];
		const provider = geminiEmbeddings({
			apiKey: 'gem-key',
			defaultModel: 'text-embedding-004',
			dimensions: 16,
			fetch: async (input, init) => {
				calls.push({ init, input });

				return new Response(
					JSON.stringify({
						embedding: {
							values: [0.4, 0.5]
						}
					}),
					{ status: 200 }
				);
			}
		});

		const vector = await provider.embed({ text: 'gemini proof' });

		expect(vector).toEqual([0.4, 0.5]);
		expect(String(calls[0]?.input)).toBe(
			'https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=gem-key'
		);
		expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
			content: {
				parts: [{ text: 'gemini proof' }]
			},
			outputDimensionality: 16
		});
	});

	it('builds Ollama embedding requests and parses vectors', async () => {
		const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> =
			[];
		const provider = ollamaEmbeddings({
			baseUrl: 'http://localhost:11434',
			defaultModel: 'nomic-embed-text',
			fetch: async (input, init) => {
				calls.push({ init, input });

				return new Response(
					JSON.stringify({
						embedding: [9, 8, 7]
					}),
					{ status: 200 }
				);
			}
		});

		const vector = await provider.embed({ text: 'local proof' });

		expect(vector).toEqual([9, 8, 7]);
		expect(String(calls[0]?.input)).toBe(
			'http://localhost:11434/api/embeddings'
		);
		expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
			model: 'nomic-embed-text',
			prompt: 'local proof'
		});
	});
});
