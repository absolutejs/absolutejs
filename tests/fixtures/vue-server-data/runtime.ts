/* Hydration runtime for tests/unit/vue/useServerData.test.ts. Runs in its own
 * process: Vue's runtime-dom captures `document` when first evaluated, so
 * Happy DOM must be registered before Vue loads. Server rendering uses the
 * server build of useServerData, hydration the browser build, as in a real
 * app where the package's `browser` export condition picks the second. */
import { GlobalRegistrator } from '@happy-dom/global-registrator';

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

const { createSSRApp, defineComponent, h, nextTick } = await import('vue');
const { createMemoryHistory, createRouter, RouterView } = await import(
	'vue-router'
);
const { renderToString } = await import('vue/server-renderer');
const { handleVuePageRequest } = await import('../../../src/vue');
const serverBuild = await import('../../../src/vue/useServerData');
const browserBuild = await import('../../../src/vue/useServerData.browser');
const {
	createServerDataCollector,
	SERVER_DATA_CONTEXT_KEY,
	serializeServerDataScript
} = await import('../../../src/vue/serverDataPayload');

type UseServerData = typeof serverBuild.useServerData;
type Profile = { id: number; name: string };
type CallCounts = { home: number; other: number; profile: number };

const calls: CallCounts = { home: 0, other: 0, profile: 0 };
const flush = () => new Promise((resolve) => setTimeout(resolve, 10));

const loadProfile = async () => {
	calls.profile += 1;
	const profile: Profile = { id: 7, name: 'Ada </script><b>x</b>' };

	return profile;
};

const createProfilePage = (useServerData: UseServerData) =>
	defineComponent({
		setup() {
			const { data, pending } = useServerData('profile', loadProfile);

			return () =>
				h(
					'main',
					pending.value
						? 'loading'
						: `${data.value?.name} #${data.value?.id}`
				);
		}
	});

const readPayloadScript = (html: string) => {
	const match =
		/<script>(window\.__ABSOLUTE_SERVER_DATA__=.*?)<\/script>/s.exec(html);
	if (!match?.[1]) throw new Error('payload script missing');

	return match[1];
};

// Vue reports hydration mismatches through console.warn and console.error.
const captureWarnings = () => {
	const warnings: string[] = [];
	const originalWarn = console.warn;
	const originalError = console.error;
	const record = (...args: unknown[]) =>
		warnings.push(args.map((value) => String(value)).join(' '));
	console.warn = record;
	console.error = record;

	return {
		warnings,
		restore: () => {
			console.warn = originalWarn;
			console.error = originalError;
		}
	};
};

const hydrateProfilePage = async () => {
	const response = await handleVuePageRequest({
		indexPath: '/profile.js',
		Page: createProfilePage(serverBuild.useServerData),
		pagePath: '/tests/profile.vue'
	});
	const html = await response.text();
	const serverCalls = calls.profile;
	const root = document.createElement('div');
	root.innerHTML =
		/<div id="root">(.*?)<\/div><div id="absolute-teleports">/s.exec(
			html
		)?.[1] ?? '';
	document.body.replaceChildren(root);
	// Run the payload script the way the browser would.
	new Function(readPayloadScript(html))();
	const capture = captureWarnings();
	try {
		createSSRApp(createProfilePage(browserBuild.useServerData)).mount(root);
		await flush();
	} finally {
		capture.restore();
	}

	return {
		clientCalls: calls.profile - serverCalls,
		hydrationWarnings: capture.warnings.filter((warning) =>
			/hydration|mismatch/i.test(warning)
		),
		payloadLeft: Object.keys(window.__ABSOLUTE_SERVER_DATA__ ?? {}),
		serverCalls,
		text: root.textContent
	};
};

const createRoutedApp = (useServerData: UseServerData) => {
	const Home = defineComponent({
		setup() {
			const { data } = useServerData('home', async () => {
				calls.home += 1;

				return 'home data';
			});

			return () => h('p', data.value ?? 'loading');
		}
	});
	const Other = defineComponent({
		setup() {
			const { data } = useServerData('other', async () => {
				calls.other += 1;

				return 'other data';
			});

			return () => h('p', data.value ?? 'loading');
		}
	});
	const router = createRouter({
		history: createMemoryHistory(),
		routes: [
			{ component: Home, path: '/' },
			{ component: Other, path: '/other' }
		]
	});
	const app = createSSRApp(
		defineComponent({ setup: () => () => h(RouterView) })
	);
	app.use(router);

	return { app, router };
};

const navigateRoutedApp = async () => {
	const server = createRoutedApp(serverBuild.useServerData);
	await server.router.push('/');
	await server.router.isReady();
	const collector = createServerDataCollector();
	const html = await renderToString(server.app, {
		[SERVER_DATA_CONTEXT_KEY]: collector
	});
	const root = document.createElement('div');
	root.innerHTML = html;
	document.body.replaceChildren(root);
	new Function(readPayloadScript(serializeServerDataScript(collector)))();
	const afterServer: CallCounts = { ...calls };

	const client = createRoutedApp(browserBuild.useServerData);
	await client.router.push('/');
	await client.router.isReady();
	client.app.mount(root);
	await flush();
	const hydrated = root.textContent;
	const homeCallsAfterHydration = calls.home - afterServer.home;

	await client.router.push('/other');
	await flush();
	await nextTick();
	const otherText = root.textContent;
	await client.router.push('/');
	await flush();

	return {
		homeCallsAfterHydration,
		homeCallsAfterReturn: calls.home - afterServer.home,
		hydrated,
		otherCalls: calls.other - afterServer.other,
		otherText,
		returnedText: root.textContent
	};
};

try {
	const profile = await hydrateProfilePage();
	const routed = await navigateRoutedApp();
	console.log(JSON.stringify({ profile, routed }));
} finally {
	await GlobalRegistrator.unregister();
}
