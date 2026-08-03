import { afterAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import type { Window as HappyDOMWindow } from 'happy-dom';

type NativeWebGlobals = Pick<
	typeof globalThis,
	'ReadableStream' | 'Response' | 'TextDecoder' | 'TextEncoder'
>;

const nativeWebGlobals: NativeWebGlobals = {
	ReadableStream: globalThis.ReadableStream,
	Response: globalThis.Response,
	TextDecoder: globalThis.TextDecoder,
	TextEncoder: globalThis.TextEncoder
};
GlobalRegistrator.register({ url: 'https://example.com/' });
Object.assign(globalThis, nativeWebGlobals);
(
	window as unknown as HappyDOMWindow
).happyDOM.settings.handleDisabledFileLoadingAsSuccess = true;

afterAll(() => GlobalRegistrator.unregister());

describe('handleVuePageRequest hydration', () => {
	test('renders the same multi-root app shape the client hydrates', async () => {
		const { createSSRApp, defineComponent, h } = await import('vue');
		const { handleVuePageRequest } = await import('../../../src/vue');
		const MultiRootPage = defineComponent({
			props: { label: { required: true, type: String } },
			setup(props) {
				return () => [h('main', props.label), h('footer', 'Footer')];
			}
		});
		const response = await handleVuePageRequest({
			indexPath: '/page.js',
			Page: MultiRootPage,
			pagePath: '/tests/multi-root.vue',
			props: { label: 'Hydrated content' }
		});
		const parsed = new DOMParser().parseFromString(
			await response.text(),
			'text/html'
		);
		document.head.innerHTML = parsed.head.innerHTML;
		document.body.innerHTML = parsed.body.innerHTML;
		const warnings: string[] = [];
		const originalWarn = console.warn;
		console.warn = (...args: unknown[]) =>
			warnings.push(args.map((value) => String(value)).join(' '));

		try {
			createSSRApp(MultiRootPage, { label: 'Hydrated content' }).mount(
				'#root'
			);
		} finally {
			console.warn = originalWarn;
		}

		expect(
			warnings.filter((warning) => /hydration/i.test(warning))
		).toEqual([]);
	});
});
