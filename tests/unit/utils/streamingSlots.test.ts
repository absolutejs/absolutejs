import { describe, expect, test } from 'bun:test';
import {
	appendStreamingSlotPatchesToStream,
	injectStreamingRuntimeIntoStream,
	getStreamingSlotPolicy,
	setStreamingSlotPolicy,
	withStreamingSlotPolicy,
	renderStreamingSlotPatchTag,
	renderStreamingSlotsRuntimeTag,
	renderStreamingSlotPlaceholder,
	streamOutOfOrderSlots
} from '../../../src/utils/streamingSlots';

const createStream = (chunks: string[]) => {
	const encoder = new TextEncoder();

	return new ReadableStream<Uint8Array>({
		start(controller) {
			for (const chunk of chunks) {
				controller.enqueue(encoder.encode(chunk));
			}
			controller.close();
		}
	});
};

describe('streamingSlots', () => {
	test('injects runtime tag into head of a stream', async () => {
		const stream = createStream([
			'<!DOCTYPE html><html><head><title>A</title></head><body>',
			'<main>ok</main></body></html>'
		]);
		const injected = injectStreamingRuntimeIntoStream(stream);
		const html = await new Response(injected).text();

		expect(html).toContain('__ABS_SLOT_ENQUEUE__');
		expect(html).toContain('<title>A</title>');
		expect(html.indexOf('__ABS_SLOT_ENQUEUE__')).toBeLessThan(
			html.indexOf('</head>')
		);
	});

	test('injects runtime tag into body of a stream when requested', async () => {
		const stream = createStream([
			'<!DOCTYPE html><html><head><title>A</title></head><body>',
			'<main>ok</main></body></html>'
		]);
		const injected = injectStreamingRuntimeIntoStream(
			stream,
			undefined,
			'body'
		);
		const html = await new Response(injected).text();

		expect(html).toContain('__ABS_SLOT_ENQUEUE__');
		expect(html.indexOf('__ABS_SLOT_ENQUEUE__')).toBeGreaterThan(
			html.indexOf('</head>')
		);
		expect(html.indexOf('__ABS_SLOT_ENQUEUE__')).toBeLessThan(
			html.indexOf('</body>')
		);
	});

	test('streams slot patches in resolution order (out-of-order)', async () => {
		const stream = streamOutOfOrderSlots({
			footerHtml: '</body></html>',
			headerHtml: '<!DOCTYPE html><html><head></head><body>',
			slots: [
				{
					fallbackHtml: '<p>slow...</p>',
					id: 'slow',
					resolve: async () => {
						await Bun.sleep(30);

						return '<section>slow</section>';
					}
				},
				{
					fallbackHtml: '<p>fast...</p>',
					id: 'fast',
					resolve: async () => {
						await Bun.sleep(5);

						return '<section>fast</section>';
					}
				}
			]
		});
		const html = await new Response(stream).text();
		const fastPatchIndex = html.indexOf(')("fast",');
		const slowPatchIndex = html.indexOf(')("slow",');

		expect(html).toContain('id="slow"');
		expect(html).toContain('id="fast"');
		expect(html).toContain('__ABS_SLOT_ENQUEUE__');
		expect(fastPatchIndex).toBeGreaterThan(-1);
		expect(slowPatchIndex).toBeGreaterThan(-1);
		expect(fastPatchIndex).toBeLessThan(slowPatchIndex);
	});

	test('renders placeholder and patch tags', () => {
		const placeholder = renderStreamingSlotPlaceholder(
			'stats',
			'<p>loading</p>'
		);
		const patch = renderStreamingSlotPatchTag(
			'stats',
			'<section>ready</section>'
		);

		expect(placeholder).toContain('id="stats"');
		expect(placeholder).toContain('data-absolute-slot="true"');
		expect(placeholder).toContain('data-absolute-slot-state="fallback"');
		expect(patch).toContain('__ABS_SLOT_ENQUEUE__');
		expect(patch).toContain('"stats"');
	});

	test('renders syntactically valid inline runtime and patch scripts', () => {
		const html = [
			renderStreamingSlotsRuntimeTag(),
			renderStreamingSlotPatchTag('stats', '<section>ready</section>')
		].join('');
		const scriptBodies = [
			...html.matchAll(/<script>([\s\S]*?)<\/script>/g)
		].map((match) => match[1]);
		const [runtimeScript = '', patchScript = ''] = scriptBodies;

		expect(scriptBodies.length).toBe(2);
		expect(runtimeScript).toContain('=>');
		expect(runtimeScript).not.toContain('\\u003E');
		expect(() => new Function(runtimeScript)).not.toThrow();
		expect(() => new Function(patchScript)).not.toThrow();
	});

	test('supports a runtime prelude script before the slot runtime', () => {
		const html = renderStreamingSlotsRuntimeTag(
			undefined,
			'window.__ABS_SLOT_TEST__ = true'
		);

		expect(html).toContain('window.__ABS_SLOT_TEST__ = true');
		expect(html).toContain('__ABS_SLOT_ENQUEUE__');
	});

	test('keeps angular-defer payloads queued until a consumer handles them', () => {
		const slotNode: { innerHTML: string } = { innerHTML: '' };
		const listeners = new Map<string, Array<() => void>>();
		const fakeWindow: Record<string, unknown> = {};
		const previousWindow = (globalThis as Record<string, unknown>).window;
		const previousDocument = (globalThis as Record<string, unknown>)
			.document;
		const previousMutationObserver = (globalThis as Record<string, unknown>)
			.MutationObserver;
		(globalThis as Record<string, unknown>).window = fakeWindow;
		(globalThis as Record<string, unknown>).document = {
			body: {},
			documentElement: {},
			readyState: 'complete',
			addEventListener: (event: string, listener: () => void) => {
				listeners.set(event, [
					...(listeners.get(event) ?? []),
					listener
				]);
			},
			getElementById: (id: string) =>
				id === 'angular-defer' ? slotNode : null
		};
		(globalThis as Record<string, unknown>).MutationObserver = class {
			constructor(_callback: () => void) {}
			observe() {}
		};

		try {
			const runtimeScript = renderStreamingSlotsRuntimeTag().match(
				/<script>([\s\S]*?)<\/script>/
			)?.[1];
			expect(runtimeScript).toBeDefined();
			new Function(runtimeScript ?? '')();

			window.__ABS_SLOT_ENQUEUE__?.('angular-defer', {
				data: { e0: 'resolved' },
				html: '<article>resolved</article>',
				kind: 'angular-defer',
				state: 'resolved'
			});

			expect(
				document.getElementById('angular-defer')?.innerHTML
			).toContain('');
			expect(
				window.__ABS_SLOT_PENDING__?.['angular-defer']
			).toBeDefined();

			window.__ABS_SLOT_CONSUMERS__ = window.__ABS_SLOT_CONSUMERS__ ?? {};
			window.__ABS_SLOT_CONSUMERS__['angular-defer'] = () => true;
			window.__ABS_SLOT_FLUSH__?.();

			expect(
				window.__ABS_SLOT_PENDING__?.['angular-defer']
			).toBeUndefined();
		} finally {
			(globalThis as Record<string, unknown>).window = previousWindow;
			(globalThis as Record<string, unknown>).document = previousDocument;
			(globalThis as Record<string, unknown>).MutationObserver =
				previousMutationObserver;
		}
	});

	test('patches vue-suspense payloads once and waits for the consumer takeover', () => {
		let innerHtmlWrites = 0;
		const attributes = new Map<string, string>();
		const slotNode: {
			getAttribute(name: string): string | null;
			innerHTML: string;
			setAttribute(name: string, value: string): void;
		} = {
			getAttribute(name: string) {
				return attributes.get(name) ?? null;
			},
			get innerHTML() {
				return '';
			},
			set innerHTML(_value: string) {
				innerHtmlWrites += 1;
			},
			setAttribute(name: string, value: string) {
				attributes.set(name, value);
			}
		};
		const fakeWindow: Record<string, unknown> = {
			dispatchEvent: () => true
		};
		const previousWindow = (globalThis as Record<string, unknown>).window;
		const previousDocument = (globalThis as Record<string, unknown>)
			.document;
		const previousMutationObserver = (globalThis as Record<string, unknown>)
			.MutationObserver;
		(globalThis as Record<string, unknown>).window = fakeWindow;
		(globalThis as Record<string, unknown>).document = {
			body: {},
			documentElement: {},
			readyState: 'complete',
			addEventListener: () => {},
			getElementById: (id: string) =>
				id === 'vue-suspense' ? slotNode : null
		};
		(globalThis as Record<string, unknown>).MutationObserver = class {
			constructor(_callback: () => void) {}
			observe() {}
		};

		try {
			const runtimeScript = renderStreamingSlotsRuntimeTag().match(
				/<script>([\s\S]*?)<\/script>/
			)?.[1];
			expect(runtimeScript).toBeDefined();
			new Function(runtimeScript ?? '')();

			window.__ABS_SLOT_ENQUEUE__?.('vue-suspense', {
				html: '<article>resolved</article>',
				kind: 'vue-suspense',
				state: 'resolved',
				value: { label: 'ready' }
			});

			expect(innerHtmlWrites).toBe(1);
			expect(slotNode.getAttribute('data-absolute-slot-state')).toBe(
				'resolved'
			);
			expect(window.__ABS_SLOT_PENDING__?.['vue-suspense']).toBeDefined();

			window.__ABS_SLOT_FLUSH__?.();
			expect(innerHtmlWrites).toBe(1);

			window.__ABS_SLOT_CONSUMERS__ = window.__ABS_SLOT_CONSUMERS__ ?? {};
			window.__ABS_SLOT_CONSUMERS__['vue-suspense'] = () => true;
			window.__ABS_SLOT_FLUSH__?.();

			expect(
				window.__ABS_SLOT_PENDING__?.['vue-suspense']
			).toBeUndefined();
		} finally {
			(globalThis as Record<string, unknown>).window = previousWindow;
			(globalThis as Record<string, unknown>).document = previousDocument;
			(globalThis as Record<string, unknown>).MutationObserver =
				previousMutationObserver;
		}
	});

	test('appends patches before closing tags when base stream finishes first', async () => {
		const base = createStream([
			'<!DOCTYPE html><html><head><title>T</title></head><body>',
			'<main>base</main></body></html>'
		]);
		const stream = appendStreamingSlotPatchesToStream(base, [
			{
				id: 'late',
				resolve: async () => {
					await Bun.sleep(20);

					return '<section>late</section>';
				}
			}
		]);
		const html = await new Response(stream).text();
		const patchIndex = html.indexOf(')("late",');
		expect(patchIndex).toBeGreaterThan(-1);
		expect(patchIndex).toBeGreaterThan(html.indexOf('<main>base</main>'));
	});

	test('keeps fallback when a slot times out and no errorHtml is set', async () => {
		const stream = streamOutOfOrderSlots({
			footerHtml: '</body></html>',
			headerHtml: '<!DOCTYPE html><html><head></head><body>',
			slots: [
				{
					fallbackHtml: '<p>still loading</p>',
					id: 'timeout',
					timeoutMs: 10,
					resolve: async () => {
						await Bun.sleep(30);

						return '<section>late value</section>';
					}
				}
			]
		});
		const html = await new Response(stream).text();

		expect(html).toContain('id="timeout"');
		expect(html).toContain('still loading');
		expect(html).not.toContain('late value');
	});

	test('renders errorHtml when a slot times out', async () => {
		const stream = streamOutOfOrderSlots({
			footerHtml: '</body></html>',
			headerHtml: '<!DOCTYPE html><html><head></head><body>',
			slots: [
				{
					errorHtml: '<p>slot failed</p>',
					id: 'timeout-with-error',
					timeoutMs: 10,
					resolve: async () => {
						await Bun.sleep(30);

						return '<section>late value</section>';
					}
				}
			]
		});
		const html = await new Response(stream).text();

		expect(html).toContain('"timeout-with-error"');
		expect(html).toContain('slot failed');
	});

	test('uses global policy defaults for slot timeout and fallback/error html', async () => {
		const previousPolicy = getStreamingSlotPolicy();
		try {
			setStreamingSlotPolicy({
				errorHtml: '<p>global failed</p>',
				fallbackHtml: '<p>global loading</p>',
				timeoutMs: 5
			});

			const stream = streamOutOfOrderSlots({
				footerHtml: '</body></html>',
				headerHtml: '<!DOCTYPE html><html><head></head><body>',
				slots: [
					{
						id: 'policy-defaults',
						resolve: async () => {
							await Bun.sleep(20);

							return '<section>late</section>';
						}
					}
				]
			});
			const html = await new Response(stream).text();

			expect(html).toContain('global loading');
			expect(html).toContain('global failed');
		} finally {
			setStreamingSlotPolicy(previousPolicy);
		}
	});

	test('drops slots above maxSlotsPerResponse and reports an error', async () => {
		const errors: string[] = [];
		const stream = streamOutOfOrderSlots({
			footerHtml: '</body></html>',
			headerHtml: '<!DOCTYPE html><html><head></head><body>',
			policy: { maxSlotsPerResponse: 1 },
			slots: [
				{
					fallbackHtml: '<p>one</p>',
					id: 'kept',
					resolve: async () => '<section>one</section>'
				},
				{
					fallbackHtml: '<p>two</p>',
					id: 'dropped',
					resolve: async () => '<section>two</section>'
				}
			],
			onError: (error) => errors.push(String(error))
		});
		const html = await new Response(stream).text();

		expect(errors).toContainEqual(
			expect.stringContaining(
				'dropped because 1 slots is the configured maximum'
			)
		);
		expect(html).toContain('id="kept"');
		expect(html).not.toContain('__ABS_SLOT_ENQUEUE__("dropped"');
	});

	test('enforces maxSlotHtmlSizeBytes before patching a slot', async () => {
		const stream = streamOutOfOrderSlots({
			footerHtml: '</body></html>',
			headerHtml: '<!DOCTYPE html><html><head></head><body>',
			policy: {
				errorHtml: '<p>size exceeded</p>',
				maxSlotHtmlSizeBytes: 10
			},
			slots: [
				{
					fallbackHtml: '<p>loading</p>',
					id: 'too-large',
					resolve: async () =>
						'<section>this is way too large</section>'
				}
			]
		});
		const html = await new Response(stream).text();

		expect(html).toContain('size exceeded');
		expect(html).not.toContain('this is way too large');
	});

	test('supports temporary policy scope helper', async () => {
		const stream = await withStreamingSlotPolicy(
			{ errorHtml: '<p>scoped failed</p>', timeoutMs: 1 },
			async () => {
				const result = streamOutOfOrderSlots({
					footerHtml: '</body></html>',
					headerHtml: '<!DOCTYPE html><html><head></head><body>',
					slots: [
						{
							id: 'scoped',
							resolve: async () => {
								await Bun.sleep(20);

								return '<section>late</section>';
							}
						}
					]
				});

				return new Response(result).text();
			}
		);

		expect(stream).toContain('scoped failed');
	});

	test('emits metric events for prepared and patched slots', async () => {
		const metrics: Array<{ type: string; slotId: string; bytes?: number }> =
			[];
		const stream = streamOutOfOrderSlots({
			footerHtml: '</body></html>',
			headerHtml: '<!DOCTYPE html><html><head></head><body>',
			policy: {
				onSlotMetric: (metric) =>
					metrics.push({
						bytes: metric.bytes,
						slotId: metric.slotId,
						type: metric.type
					})
			},
			slots: [
				{
					id: 'metric-slot',
					resolve: async () => '<section>ok</section>'
				}
			]
		});
		const html = await new Response(stream).text();

		expect(html).toContain('metric-slot');
		expect(
			metrics.find(
				(metric) =>
					metric.slotId === 'metric-slot' &&
					metric.type === 'prepared'
			)
		).toBeDefined();
		expect(
			metrics.find(
				(metric) =>
					metric.slotId === 'metric-slot' &&
					metric.type === 'resolved'
			)
		).toBeDefined();
		expect(
			metrics.find(
				(metric) =>
					metric.slotId === 'metric-slot' && metric.type === 'patched'
			)
		).toBeDefined();
	});

	test('merges onSlotMetric from policy and call options', async () => {
		const global: Array<{ type: string; slotId: string }> = [];
		const local: Array<{ type: string; slotId: string }> = [];
		const stream = streamOutOfOrderSlots({
			footerHtml: '</body></html>',
			headerHtml: '<!DOCTYPE html><html><head></head><body>',
			policy: {
				onSlotMetric: (metric) =>
					global.push({
						slotId: metric.slotId,
						type: metric.type
					})
			},
			slots: [
				{
					id: 'merged',
					resolve: async () => '<section>ok</section>'
				}
			],
			onSlotMetric: (metric) =>
				local.push({
					slotId: metric.slotId,
					type: metric.type
				})
		});
		await new Response(stream).text();

		const total = (arr: Array<{ type: string; slotId: string }>) =>
			arr.filter((metric) => metric.slotId === 'merged').length;

		expect(total(global)).toBeGreaterThan(0);
		expect(total(local)).toBeGreaterThan(0);
		expect(total(local)).toEqual(total(global));
	});

	test('emits metric events when a slot is dropped', async () => {
		const metrics: Array<{
			type: string;
			slotId: string;
			reason?: string;
		}> = [];
		const stream = streamOutOfOrderSlots({
			footerHtml: '</body></html>',
			headerHtml: '<!DOCTYPE html><html><head></head><body>',
			policy: {
				maxSlotsPerResponse: 1,
				onSlotMetric: (metric) =>
					metrics.push({
						reason: metric.reason,
						slotId: metric.slotId,
						type: metric.type
					})
			},
			slots: [
				{
					id: 'keep',
					resolve: async () => '<section>one</section>'
				},
				{
					id: 'drop',
					resolve: async () => '<section>two</section>'
				}
			]
		});
		await new Response(stream).text();

		expect(
			metrics.find(
				(metric) =>
					metric.slotId === 'keep' && metric.type === 'prepared'
			)
		).toBeDefined();
		expect(metrics).toContainEqual(
			expect.objectContaining({
				slotId: 'drop',
				type: 'dropped'
			})
		);
	});

	test('emits timeout metric event when slot resolution exceeds timeout', async () => {
		const metrics: Array<{ type: string; slotId: string }> = [];
		const stream = streamOutOfOrderSlots({
			footerHtml: '</body></html>',
			headerHtml: '<!DOCTYPE html><html><head></head><body>',
			policy: {
				onSlotMetric: (metric) =>
					metrics.push({ slotId: metric.slotId, type: metric.type })
			},
			slots: [
				{
					id: 'timed-slot',
					timeoutMs: 1,
					resolve: async () => {
						await Bun.sleep(20);

						return '<section>should not render</section>';
					}
				}
			]
		});
		const html = await new Response(stream).text();

		expect(html).toContain('id="timed-slot"');
		expect(
			metrics.find(
				(metric) =>
					metric.slotId === 'timed-slot' && metric.type === 'timeout'
			)
		).toBeDefined();
		expect(
			metrics.find(
				(metric) =>
					metric.slotId === 'timed-slot' && metric.type === 'error'
			)
		).not.toBeDefined();
	});

	test('emits size_exceeded metric event', async () => {
		const metrics: Array<{ type: string; slotId: string }> = [];
		const stream = streamOutOfOrderSlots({
			footerHtml: '</body></html>',
			headerHtml: '<!DOCTYPE html><html><head></head><body>',
			policy: {
				maxSlotHtmlSizeBytes: 4,
				onSlotMetric: (metric) =>
					metrics.push({ slotId: metric.slotId, type: metric.type })
			},
			slots: [
				{
					fallbackHtml: '<p>loading</p>',
					id: 'large',
					resolve: async () => '<section>this is huge</section>'
				}
			]
		});
		await new Response(stream).text();

		expect(
			metrics.find(
				(metric) =>
					metric.slotId === 'large' && metric.type === 'size_exceeded'
			)
		).toBeDefined();
	});

	test('unwraps Angular SafeValue objects before rendering', async () => {
		const stream = streamOutOfOrderSlots({
			footerHtml: '</body></html>',
			headerHtml: '<!DOCTYPE html><html><head></head><body>',
			slots: [
				{
					fallbackHtml: {
						changingThisBreaksApplicationSecurity: '<p>fallback</p>'
					},
					id: 'safe-value-slot',
					resolve: async () => ({
						changingThisBreaksApplicationSecurity:
							'<section>resolved</section>'
					})
				}
			]
		});
		const html = await new Response(stream).text();

		expect(html).toContain('<p>fallback</p>');
		expect(html).toContain('\\u003Csection>resolved\\u003C/section>');
		expect(html).not.toContain('[object Object]');
	});
});
