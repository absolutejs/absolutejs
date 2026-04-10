import { describe, expect, it } from 'bun:test';
import {
	anthropicOCR,
	geminiOCR,
	ollamaOCR,
	ollamaTranscriber,
	openaiCompatibleOCR,
	openaiCompatibleTranscriber,
	openaiOCR,
	openaiTranscriber
} from '../../../../src/ai/rag/extractorProviders';

describe('extractor providers', () => {
	it('builds OpenAI transcription requests and parses text', async () => {
		const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> =
			[];
		const provider = openaiTranscriber({
			apiKey: 'test-key',
			defaultModel: 'gpt-4o-mini-transcribe',
			fetch: async (input, init) => {
				calls.push({ init, input });

				return new Response(
					JSON.stringify({ text: 'hello from audio' }),
					{
						status: 200
					}
				);
			}
		});

		const result = await provider.transcribe({
			contentType: 'audio/mpeg',
			data: new Uint8Array([1, 2, 3]),
			name: 'voice.mp3'
		});

		expect(result.text).toBe('hello from audio');
		expect(String(calls[0]?.input)).toBe(
			'https://api.openai.com/v1/audio/transcriptions'
		);
		expect(calls[0]?.init?.method).toBe('POST');
		expect(calls[0]?.init?.headers).toEqual({
			Authorization: 'Bearer test-key'
		});
		expect(calls[0]?.init?.body).toBeInstanceOf(FormData);
		const body = calls[0]?.init?.body as FormData;
		expect(body.get('model')).toBe('gpt-4o-mini-transcribe');
		expect(body.get('response_format')).toBe('verbose_json');
		expect(body.get('file')).toBeInstanceOf(File);
	});

	it('supports OpenAI-compatible transcription base URLs', async () => {
		const calls: string[] = [];
		const provider = openaiCompatibleTranscriber({
			apiKey: 'compat',
			baseUrl: 'https://api.example.com/openai',
			defaultModel: 'whisper',
			fetch: async (input) => {
				calls.push(String(input));

				return new Response(JSON.stringify({ text: 'compat audio' }), {
					status: 200
				});
			}
		});

		const result = await provider.transcribe({
			data: new Uint8Array([1]),
			name: 'clip.wav'
		});

		expect(result.text).toBe('compat audio');
		expect(calls[0]).toBe(
			'https://api.example.com/openai/v1/audio/transcriptions'
		);
	});

	it('builds OpenAI OCR requests for images and parses response text', async () => {
		const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> =
			[];
		const provider = openaiOCR({
			apiKey: 'ocr-key',
			defaultModel: 'gpt-4.1-mini',
			fetch: async (input, init) => {
				calls.push({ init, input });

				return new Response(
					JSON.stringify({
						output: [
							{
								content: [
									{
										text: 'receipt line 1',
										type: 'output_text'
									}
								]
							}
						]
					}),
					{ status: 200 }
				);
			}
		});

		const result = await provider.extractText({
			contentType: 'image/png',
			data: new Uint8Array([137, 80, 78, 71]),
			name: 'receipt.png'
		});

		expect(result.text).toBe('receipt line 1');
		expect(String(calls[0]?.input)).toBe(
			'https://api.openai.com/v1/responses'
		);
		expect(JSON.parse(String(calls[0]?.init?.body))).toMatchObject({
			model: 'gpt-4.1-mini'
		});
	});

	it('supports OpenAI-compatible OCR base URLs', async () => {
		const calls: string[] = [];
		const provider = openaiCompatibleOCR({
			apiKey: 'ocr-key',
			baseUrl: 'https://api.example.com/openai',
			fetch: async (input) => {
				calls.push(String(input));

				return new Response(
					JSON.stringify({ output_text: 'compat ocr' }),
					{
						status: 200
					}
				);
			}
		});

		const result = await provider.extractText({
			contentType: 'application/pdf',
			data: new Uint8Array([37, 80, 68, 70]),
			name: 'scan.pdf'
		});

		expect(result.text).toBe('compat ocr');
		expect(calls[0]).toBe('https://api.example.com/openai/v1/responses');
	});

	it('builds Gemini OCR requests and parses extracted text', async () => {
		const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> =
			[];
		const provider = geminiOCR({
			apiKey: 'gem-key',
			defaultModel: 'gemini-2.5-flash',
			fetch: async (input, init) => {
				calls.push({ init, input });

				return new Response(
					JSON.stringify({
						candidates: [
							{
								content: {
									parts: [{ text: 'gemini ocr text' }]
								}
							}
						]
					}),
					{ status: 200 }
				);
			}
		});

		const result = await provider.extractText({
			contentType: 'image/jpeg',
			data: new Uint8Array([255, 216, 255]),
			name: 'photo.jpg'
		});

		expect(result.text).toBe('gemini ocr text');
		expect(String(calls[0]?.input)).toBe(
			'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=gem-key'
		);
		expect(JSON.parse(String(calls[0]?.init?.body))).toMatchObject({
			contents: [
				{
					parts: [
						{
							text: expect.any(String)
						},
						{
							inlineData: {
								data: expect.any(String),
								mimeType: 'image/jpeg'
							}
						}
					]
				}
			]
		});
	});

	it('builds Ollama OCR requests for local multimodal models', async () => {
		const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> =
			[];
		const provider = ollamaOCR({
			baseUrl: 'http://localhost:11434',
			defaultModel: 'llava',
			fetch: async (input, init) => {
				calls.push({ init, input });

				return new Response(
					JSON.stringify({ response: 'local ocr text' }),
					{
						status: 200
					}
				);
			}
		});

		const result = await provider.extractText({
			contentType: 'image/png',
			data: new Uint8Array([137, 80, 78, 71]),
			name: 'frame.png'
		});

		expect(result.text).toBe('local ocr text');
		expect(String(calls[0]?.input)).toBe(
			'http://localhost:11434/api/generate'
		);
		expect(JSON.parse(String(calls[0]?.init?.body))).toMatchObject({
			model: 'llava',
			stream: false,
			images: [expect.any(String)]
		});
	});

	it('builds Ollama local transcription requests and parses text', async () => {
		const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> =
			[];
		const provider = ollamaTranscriber({
			baseUrl: 'http://localhost:11434',
			defaultModel: 'qwen2.5vl',
			fetch: async (input, init) => {
				calls.push({ init, input });

				return new Response(
					JSON.stringify({ response: 'local transcript text' }),
					{ status: 200 }
				);
			}
		});

		const result = await provider.transcribe({
			contentType: 'audio/mpeg',
			data: new Uint8Array([1, 2, 3]),
			name: 'local.mp3'
		});

		expect(result.text).toBe('local transcript text');
		expect(String(calls[0]?.input)).toBe(
			'http://localhost:11434/api/generate'
		);
		expect(JSON.parse(String(calls[0]?.init?.body))).toMatchObject({
			model: 'qwen2.5vl',
			stream: false,
			images: [expect.any(String)]
		});
	});

	it('builds Anthropic OCR requests for PDFs and parses text content', async () => {
		const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> =
			[];
		const provider = anthropicOCR({
			apiKey: 'anthropic-key',
			defaultModel: 'claude-3-5-sonnet-latest',
			fetch: async (input, init) => {
				calls.push({ init, input });

				return new Response(
					JSON.stringify({
						content: [{ text: 'claude pdf text', type: 'text' }]
					}),
					{ status: 200 }
				);
			}
		});

		const result = await provider.extractText({
			contentType: 'application/pdf',
			data: new Uint8Array([37, 80, 68, 70]),
			name: 'report.pdf'
		});

		expect(result.text).toBe('claude pdf text');
		expect(String(calls[0]?.input)).toBe(
			'https://api.anthropic.com/v1/messages'
		);
		expect(calls[0]?.init?.headers).toEqual({
			'anthropic-version': '2023-06-01',
			'content-type': 'application/json',
			'x-api-key': 'anthropic-key'
		});
		expect(JSON.parse(String(calls[0]?.init?.body))).toMatchObject({
			model: 'claude-3-5-sonnet-latest',
			messages: [
				{
					content: [
						{ text: expect.any(String), type: 'text' },
						{
							source: {
								data: expect.any(String),
								media_type: 'application/pdf',
								type: 'base64'
							},
							type: 'document'
						}
					],
					role: 'user'
				}
			]
		});
	});
});
