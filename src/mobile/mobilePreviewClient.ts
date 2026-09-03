import { installDeviceAdapter } from '@absolutejs/devices';
import {
	createAbsoluteHttpTransport,
	installAbsoluteHttpTransport
} from '@absolutejs/http';
import {
	createTestDeviceAdapter,
	type TestDeviceController
} from '@absolutejs/devices/testing';

type PreviewMessage =
	| { type: 'absolute-preview:back' }
	| { type: 'absolute-preview:deep-link'; url: string }
	| { type: 'absolute-preview:keyboard'; heightPx: number; visible: boolean }
	| {
			type: 'absolute-preview:lifecycle';
			state: 'active' | 'background' | 'inactive';
	  }
	| {
			type: 'absolute-preview:network';
			connected: boolean;
			connectionType: 'cellular' | 'none' | 'unknown' | 'wifi';
	  }
	| {
			type: 'absolute-preview:permission';
			capability: 'camera' | 'location' | 'notifications';
			state: 'blocked' | 'denied' | 'granted' | 'prompt';
	  };

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null;

const isPreviewMessage = (value: unknown): value is PreviewMessage => {
	if (!isRecord(value) || typeof value.type !== 'string') return false;
	if (value.type === 'absolute-preview:back') return true;
	if (value.type === 'absolute-preview:deep-link')
		return typeof value.url === 'string';
	if (value.type === 'absolute-preview:keyboard')
		return (
			typeof value.heightPx === 'number' &&
			Number.isFinite(value.heightPx) &&
			typeof value.visible === 'boolean'
		);
	if (value.type === 'absolute-preview:lifecycle')
		return ['active', 'background', 'inactive'].includes(
			String(value.state)
		);
	if (value.type === 'absolute-preview:network')
		return (
			typeof value.connected === 'boolean' &&
			['cellular', 'none', 'unknown', 'wifi'].includes(
				String(value.connectionType)
			)
		);
	if (value.type === 'absolute-preview:permission')
		return (
			['camera', 'location', 'notifications'].includes(
				String(value.capability)
			) &&
			['blocked', 'denied', 'granted', 'prompt'].includes(
				String(value.state)
			)
		);

	return false;
};

const previewPlatform = () =>
	new URLSearchParams(location.search).get('__absolute_preview_platform') ===
	'android'
		? 'android'
		: 'ios';

const PREVIEW_STATE_KEY = Symbol.for('@absolutejs/mobile-preview/state');
type AbsoluteMobilePreviewState = { connected: boolean };
const isAbsoluteMobilePreviewState = (
	value: unknown
): value is AbsoluteMobilePreviewState =>
	isRecord(value) && typeof value.connected === 'boolean';
const getPreviewState = () => {
	const existing = Reflect.get(globalThis, PREVIEW_STATE_KEY);
	if (isAbsoluteMobilePreviewState(existing)) return existing;
	const created: AbsoluteMobilePreviewState = { connected: true };
	Reflect.set(globalThis, PREVIEW_STATE_KEY, created);

	return created;
};
const previewState = getPreviewState();
const browserFetch = globalThis.fetch;
const nativeFetch = browserFetch.bind(globalThis);
const isPreviewInfrastructureRequest = (url: URL) =>
	url.origin === location.origin &&
	(url.pathname.startsWith('/__absolute/') ||
		url.pathname.startsWith('/@src/') ||
		url.pathname === '/hmr-status');

const previewPreconnect = (
	...args: Parameters<typeof globalThis.fetch.preconnect>
) => {
	const preconnect = Reflect.get(browserFetch, 'preconnect');
	if (typeof preconnect === 'function')
		Reflect.apply(preconnect, browserFetch, args);
};

const previewFetch: typeof globalThis.fetch = Object.assign(
	(
		input: Parameters<typeof globalThis.fetch>[0],
		init?: Parameters<typeof globalThis.fetch>[1]
	) => {
		const requestUrl = new URL(
			input instanceof Request ? input.url : String(input),
			location.href
		);
		if (
			!previewState.connected &&
			!isPreviewInfrastructureRequest(requestUrl)
		) {
			return Promise.reject(
				new TypeError(
					'AbsoluteJS mobile preview is offline. Restore connectivity from the preview controls.'
				)
			);
		}

		return nativeFetch(input, init);
	},
	{ preconnect: previewPreconnect }
);

const installPreviewFetch = () => {
	if (globalThis.fetch !== previewFetch) globalThis.fetch = previewFetch;
};

let removePreviewHttpTransport: (() => void) | undefined;
const installPreviewHttpTransport = () => {
	removePreviewHttpTransport?.();
	removePreviewHttpTransport = installAbsoluteHttpTransport(
		createAbsoluteHttpTransport({
			fetch: previewFetch,
			origin: location.origin,
			runtime: 'web'
		})
	);
};

const postState = (
	type: 'event' | 'ready',
	detail: Record<string, unknown> = {}
) => {
	if (window.parent === window) return;
	window.parent.postMessage(
		{
			...detail,
			platform: previewPlatform(),
			type: `absolute-preview:${type}`
		},
		location.origin
	);
};

const reportReady = () => {
	const durationMs = Math.max(0, Math.round(performance.now()));
	void nativeFetch('/__absolute/mobile-preview-telemetry', {
		body: JSON.stringify({ durationMs, platform: previewPlatform() }),
		headers: { 'content-type': 'application/json' },
		keepalive: true,
		method: 'POST'
	}).catch(() => undefined);
};

const emitPermission = (
	controller: TestDeviceController,
	message: Extract<PreviewMessage, { type: 'absolute-preview:permission' }>
) => {
	const status = {
		canRequest: message.state === 'prompt',
		state: message.state
	} as const;
	if (message.capability === 'camera')
		controller.cameraPermission.setStatus(status);
	else if (message.capability === 'location')
		controller.locationPermission.setStatus(status);
	else controller.notificationPermission.setStatus(status);
};

const handlePreviewMessage = (
	controller: TestDeviceController,
	message: PreviewMessage
) => {
	if (message.type === 'absolute-preview:back') {
		controller.emitBack({ canGoBack: history.length > 1 });
	} else if (message.type === 'absolute-preview:deep-link') {
		controller.emitLink(message.url);
	} else if (message.type === 'absolute-preview:keyboard') {
		controller.emitKeyboard({
			heightPx: Math.max(0, Math.round(message.heightPx)),
			visible: message.visible
		});
	} else if (message.type === 'absolute-preview:lifecycle') {
		controller.emitLifecycle(message.state);
	} else if (message.type === 'absolute-preview:network') {
		previewState.connected = message.connected;
		// Some framework runtimes replace window.fetch while bootstrapping.
		// Reassert the raw-fetch simulation whenever connectivity changes;
		// @absolutejs/http remains pinned to this provider independently.
		installPreviewFetch();
		installPreviewHttpTransport();
		controller.emitNetwork({
			connected: message.connected,
			connectionType: message.connectionType
		});
	} else emitPermission(controller, message);
	postState('event', { event: message.type });
};

/** Installs the preview bridge exactly once per document. Importing this
 *  module has no side effects: the fetch simulation, the simulated device
 *  adapter, and the HTTP transport are only installed from here, so a page
 *  that never targets the preview keeps the browser's own `fetch`. */
export const installAbsoluteMobilePreview = () => {
	if (Reflect.has(globalThis, '__ABS_MOBILE_PREVIEW__')) return;
	installPreviewFetch();
	const platform = previewPlatform();
	const controller = createTestDeviceAdapter({
		lifecycle: 'active',
		network: { connected: true, connectionType: 'wifi' },
		platform: {
			formFactor: 'phone',
			isNative: true,
			os: platform,
			runtime: 'capacitor',
			safeAreaInsets:
				platform === 'ios'
					? { bottom: 34, left: 0, right: 0, top: 59 }
					: { bottom: 24, left: 0, right: 0, top: 24 }
		}
	});
	installDeviceAdapter(controller.adapter);
	installPreviewHttpTransport();
	Reflect.set(globalThis, '__ABS_MOBILE_PREVIEW__', controller);
	addEventListener('message', (event: MessageEvent<unknown>) => {
		if (event.origin !== location.origin || event.source !== window.parent)
			return;
		if (!isPreviewMessage(event.data)) return;
		handlePreviewMessage(controller, event.data);
	});
	postState('ready');
	reportReady();
};
