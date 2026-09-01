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

try {
	const { createSSRApp, defineComponent, h, Teleport } = await import('vue');
	const { handleVuePageRequest } = await import('../../../src/vue');
	const { captureSsrTextBaselines, prepareBrowserTranslationHydration } =
		await import('../../../src/vue/browserTranslation');
	const { ABSOLUTE_TELEPORT_TARGET } = await import(
		'../../../src/vue/teleports'
	);
	const MultiRootPage = defineComponent({
		props: { label: { required: true, type: String } },
		setup(props) {
			return () => [h('main', props.label), h('footer', 'Footer')];
		}
	});
	const TeleportPage = defineComponent({
		setup() {
			return () => [
				h(MultiRootPage, { label: 'Hydrated content' }),
				h(Teleport, { to: ABSOLUTE_TELEPORT_TARGET }, [
					h('div', { id: 'teleported-dialog' }, 'Teleported content')
				])
			];
		}
	});
	const response = await handleVuePageRequest({
		indexPath: '/page.js',
		Page: TeleportPage,
		pagePath: '/tests/multi-root.vue',
		props: {}
	});
	const parsed = new DOMParser().parseFromString(
		await response.text(),
		'text/html'
	);
	document.head.innerHTML = parsed.head.innerHTML;
	document.body.innerHTML = parsed.body.innerHTML;
	const root = document.querySelector<HTMLElement>('#root');
	const main = document.querySelector<HTMLElement>('main');
	if (root === null || main === null) throw new Error('SSR fixture missing');
	captureSsrTextBaselines(root);
	main.textContent = '翻訳されたコンテンツ';
	const warnings: string[] = [];
	const originalWarn = console.warn;
	console.warn = (...args: unknown[]) =>
		warnings.push(args.map((value) => String(value)).join(' '));

	try {
		const restoreBrowserTranslation =
			prepareBrowserTranslationHydration(root);
		try {
			createSSRApp(TeleportPage).mount(root);
		} finally {
			restoreBrowserTranslation();
		}
	} finally {
		console.warn = originalWarn;
	}

	console.log(
		JSON.stringify({
			teleported:
				document.querySelector('#teleported-dialog')?.textContent,
			translated: main.textContent,
			warnings: warnings.filter((warning) => /hydration/i.test(warning))
		})
	);
} finally {
	GlobalRegistrator.unregister();
}
