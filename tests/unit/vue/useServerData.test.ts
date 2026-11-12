import { describe, expect, spyOn, test } from 'bun:test';
import { resolve } from 'node:path';
import { defineComponent, h } from 'vue';
import { handleVuePageRequest, useServerData } from '../../../src/vue';
import { StreamSlot } from '../../../src/vue/components';
import {
	claimServerDataKey,
	createServerDataCollector,
	serializeServerDataScript,
	storeServerDataValue
} from '../../../src/vue/serverDataPayload';

type Profile = { id: number; name: string };
type RenderMode = { client?: 'none'; collectStreamingSlots?: boolean };

const PAYLOAD_SCRIPT =
	/<script>window\.__ABSOLUTE_SERVER_DATA__=(.*?)<\/script>/s;

const readPayload = (html: string) => {
	const json = PAYLOAD_SCRIPT.exec(html)?.[1];
	if (json === undefined) return null;
	// The payload is a JSON literal; `<` escapes decode in JSON.parse.
	const parsed: unknown = JSON.parse(json);

	return parsed;
};

const loadProfile = async (_signal: AbortSignal) => {
	const profile: Profile = { id: 7, name: 'Ada' };

	return profile;
};

const ProfilePage = defineComponent({
	setup() {
		const { data, error, pending } = useServerData('profile', loadProfile);

		return () => {
			if (pending.value) return h('main', 'loading');
			if (error.value) return h('main', `failed: ${error.value.name}`);

			return h('main', `${data.value?.name} #${data.value?.id}`);
		};
	}
});

const render = (
	Page: ReturnType<typeof defineComponent>,
	extra: RenderMode = {}
) =>
	extra.client === 'none'
		? handleVuePageRequest({
				client: 'none',
				Page,
				pagePath: '/tests/server-data.vue'
			})
		: handleVuePageRequest({
				collectStreamingSlots: extra.collectStreamingSlots,
				indexPath: '/server-data.js',
				Page,
				pagePath: '/tests/server-data.vue'
			});

describe('useServerData on the server', () => {
	test('renders fetched data and serializes it before the page script', async () => {
		const response = await render(ProfilePage);
		const html = await response.text();

		expect(response.status).toBe(200);
		expect(html).toContain('<main>Ada #7</main>');
		expect(readPayload(html)).toEqual({
			profile: { data: { id: 7, name: 'Ada' } }
		});
		expect(html.indexOf('__ABSOLUTE_SERVER_DATA__')).toBeLessThan(
			html.indexOf('<script type="module" src="/server-data.js">')
		);
	});

	test('escapes values so they cannot close the script element', async () => {
		const hostile = '</script><script>alert(1)</script> <!--';
		const Page = defineComponent({
			setup() {
				const { data } = useServerData('hostile', async () => hostile);

				return () => h('p', data.value ?? '');
			}
		});
		const html = await (await render(Page)).text();
		const script = PAYLOAD_SCRIPT.exec(html)?.[0] ?? '';

		expect(script).not.toContain('</script><script>');
		expect(script).not.toContain('<!--');
		expect(script).not.toContain(' ');
		expect(readPayload(html)).toEqual({ hostile: { data: hostile } });
	});

	test('serializes nothing for client: none pages but still renders the data', async () => {
		const html = await (
			await render(ProfilePage, { client: 'none' })
		).text();

		expect(html).toContain('<main>Ada #7</main>');
		expect(html).not.toContain('__ABSOLUTE_SERVER_DATA__');
	});

	test('writes the payload on streaming pages after the stream settles', async () => {
		const Page = defineComponent({
			setup() {
				const { data } = useServerData('streamed', async () => {
					await Bun.sleep(5);

					return { items: ['a', 'b'] };
				});

				return () =>
					h('main', [
						h('p', data.value?.items.join(',') ?? ''),
						h(StreamSlot, {
							fallbackHtml: '<p>loading</p>',
							id: 'server-data-slot',
							resolve: async () => '<section>slot</section>'
						})
					]);
			}
		});
		const html = await (
			await render(Page, { collectStreamingSlots: true })
		).text();

		expect(html).toContain('<p>a,b</p>');
		// The slot patch must not be written inside the page's own scripts.
		expect(html).toContain('window.__INITIAL_PROPS__={}</script>');
		expect(readPayload(html)).toEqual({
			streamed: { data: { items: ['a', 'b'] } }
		});
	});

	test('a failing fetcher renders and serializes an error state', async () => {
		const consoleError = spyOn(console, 'error').mockImplementation(
			() => undefined
		);
		const Page = defineComponent({
			setup() {
				const { error } = useServerData('broken', async () => {
					throw new TypeError('database offline');
				});

				return () => h('p', error.value?.message ?? 'no error');
			}
		});
		try {
			const response = await render(Page);
			const html = await response.text();

			expect(response.status).toBe(200);
			expect(html).toContain('<p>database offline</p>');
			expect(readPayload(html)).toEqual({
				broken: {
					error: { message: 'database offline', name: 'TypeError' }
				}
			});
		} finally {
			consoleError.mockRestore();
		}
	});

	test('an unserializable value becomes an error state, not a crash', () => {
		const consoleError = spyOn(console, 'error').mockImplementation(
			() => undefined
		);
		try {
			const collector = createServerDataCollector();
			const failure = storeServerDataValue(collector, 'big', 1n);

			expect(failure?.message).toContain('cannot be serialized');
			expect(serializeServerDataScript(collector)).toContain(
				'"big":{"error"'
			);
		} finally {
			consoleError.mockRestore();
		}
	});

	test('server: false renders the pending state and serializes nothing', async () => {
		let calls = 0;
		const Page = defineComponent({
			setup() {
				const { pending } = useServerData(
					'client-only',
					async () => {
						calls += 1;

						return 1;
					},
					{ server: false }
				);

				return () => h('p', pending.value ? 'loading' : 'done');
			}
		});
		const html = await (await render(Page)).text();

		expect(calls).toBe(0);
		expect(html).toContain('<p>loading</p>');
		expect(html).not.toContain('__ABSOLUTE_SERVER_DATA__');
	});

	test('a duplicate key in one request fails with a clear error in dev', async () => {
		const consoleError = spyOn(console, 'error').mockImplementation(
			() => undefined
		);
		const Child = defineComponent({
			setup() {
				const { data } = useServerData('profile', loadProfile);

				return () => h('span', data.value?.name ?? '');
			}
		});
		const Page = defineComponent({
			setup: () => () => h('div', [h(Child), h(Child)])
		});
		try {
			const response = await render(Page);

			expect(response.status).toBe(500);
			const logged = consoleError.mock.calls.flat().map(String).join(' ');
			expect(logged).toContain(
				'useServerData: the key "profile" is used more than once'
			);
		} finally {
			consoleError.mockRestore();
		}
	});

	test('in production a repeated key warns and an error hides its message', async () => {
		const previous = process.env.NODE_ENV;
		const consoleWarn = spyOn(console, 'warn').mockImplementation(
			() => undefined
		);
		const consoleError = spyOn(console, 'error').mockImplementation(
			() => undefined
		);
		const Child = defineComponent({
			setup() {
				const { error } = useServerData('shared', async () => {
					throw new Error('secret connection string');
				});

				return () => h('span', error.value?.message ?? 'no error');
			}
		});
		process.env.NODE_ENV = 'production';
		try {
			const response = await render(
				defineComponent({
					setup: () => () => h('div', [h(Child), h(Child)])
				})
			);
			const html = await response.text();

			expect(response.status).toBe(200);
			expect(consoleWarn.mock.calls.flat().join(' ')).toContain(
				'The repeated call will load in the browser.'
			);
			expect(html).not.toContain('secret connection string');
			// The server renders the message the browser will hydrate with.
			expect(html).toContain('<span>Loading server data failed.</span>');
			expect(readPayload(html)).toEqual({
				shared: {
					error: {
						message: 'Loading server data failed.',
						name: 'Error'
					}
				}
			});
		} finally {
			process.env.NODE_ENV = previous;
			consoleWarn.mockRestore();
			consoleError.mockRestore();
		}
	});

	test('claimServerDataKey refuses the second claim of a key', () => {
		const collector = createServerDataCollector();

		expect(claimServerDataKey(collector, 'a')).toBe(true);
		expect(claimServerDataKey(collector, 'a')).toBe(false);
		expect(collector.failure?.message).toMatch(
			/the key "a" is used more than once/
		);
	});

	test('calling outside setup() fails clearly', () => {
		expect(() => useServerData('loose', loadProfile)).toThrow(
			/must be called inside a Vue component's setup\(\)/
		);
	});

	test('data is typed from the fetcher', () => {
		const Typed = defineComponent({
			setup() {
				const { data } = useServerData('typed', loadProfile);
				const name: string | undefined = data.value?.name;
				// @ts-expect-error `data` holds Profile | null, not a number.
				const wrong: number = data.value;

				return () => h('p', `${name}${wrong}`);
			}
		});

		expect(Typed).toBeDefined();
	});
});

describe('useServerData hydration', () => {
	test('hydrates from the payload with no fetch, and fetches on a route change', async () => {
		// Vue runtime-dom captures `document` on first evaluation, so the
		// browser half runs in a clean process with Happy DOM installed first.
		const runner = resolve(
			import.meta.dir,
			'../../fixtures/vue-server-data/runtime.ts'
		);
		const subprocess = Bun.spawn([process.execPath, runner], {
			stderr: 'pipe',
			stdout: 'pipe'
		});
		const [exitCode, stdout, stderr] = await Promise.all([
			subprocess.exited,
			new Response(subprocess.stdout).text(),
			new Response(subprocess.stderr).text()
		]);

		expect(stderr).toBe('');
		expect(exitCode).toBe(0);
		expect(JSON.parse(stdout)).toEqual({
			profile: {
				clientCalls: 0,
				hydrationWarnings: [],
				payloadLeft: [],
				serverCalls: 1,
				text: 'Ada </script><b>x</b> #7'
			},
			routed: {
				homeCallsAfterHydration: 0,
				homeCallsAfterReturn: 1,
				hydrated: 'home data',
				otherCalls: 1,
				otherText: 'other data',
				returnedText: 'home data'
			}
		});
	});
});
