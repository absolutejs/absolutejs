import {
	keyboard,
	network,
	platform,
	systemBars,
	type DeviceKeyboardState,
	type DeviceNetworkStatus,
	type DevicePlatformInfo,
	type DeviceSubscription
} from '@absolutejs/devices';

const STYLE_ID = 'absolute-mobile-adaptive-shell';
const ANNOUNCER_ID = 'absolute-mobile-announcer';
const HOST_METRICS_EVENT = 'absolute:native-host-metrics';

const STATUS_STYLE = `
[data-absolute-mobile-status] {
	display: grid;
	min-height: var(--absolute-available-height, 100dvh);
	place-items: center;
	padding: max(1.5rem, var(--absolute-safe-area-inset-top, 0px)) max(1.5rem, var(--absolute-safe-area-inset-right, 0px)) max(1.5rem, var(--absolute-safe-area-inset-bottom, 0px)) max(1.5rem, var(--absolute-safe-area-inset-left, 0px));
	box-sizing: border-box;
	color: CanvasText;
	background: Canvas;
	font: 500 1rem/1.5 system-ui, sans-serif;
	text-align: center;
}
[data-absolute-mobile-announcer] {
	position: fixed;
	width: 1px;
	height: 1px;
	padding: 0;
	margin: -1px;
	overflow: hidden;
	clip: rect(0, 0, 0, 0);
	white-space: nowrap;
	border: 0;
}
`;

export type AbsoluteMobileAdaptiveShellState = {
	availableHeight: number;
	keyboard: DeviceKeyboardState;
	network: DeviceNetworkStatus;
	platform: DevicePlatformInfo;
	viewportHeight: number;
	viewportWidth: number;
};

declare global {
	// Event-map augmentation requires interface merging.
	// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
	interface WindowEventMap {
		'absolute:adaptive-shell-change': CustomEvent<AbsoluteMobileAdaptiveShellState>;
	}
}

export type AbsoluteMobileAdaptiveShellDevices = {
	keyboard: Pick<typeof keyboard, 'capability' | 'getState' | 'onChange'>;
	network: Pick<typeof network, 'getStatus' | 'onChange'>;
	platform: Pick<typeof platform, 'getInfo'>;
	systemBars: Pick<typeof systemBars, 'capability' | 'setAppearance'>;
};

export type AbsoluteMobileAdaptiveShell = {
	dispose(): Promise<void>;
	refreshDocument(): void;
	state(): AbsoluteMobileAdaptiveShellState;
};

const DEFAULT_KEYBOARD: DeviceKeyboardState = {
	heightPx: 0,
	visible: false
};
const DEFAULT_NETWORK: DeviceNetworkStatus = {
	connected: true,
	connectionType: 'unknown'
};
const DEFAULT_PLATFORM: DevicePlatformInfo = {
	formFactor: 'unknown',
	isNative: true,
	os: 'unknown',
	runtime: 'capacitor'
};

const finitePixels = (value: number | undefined) =>
	Number.isFinite(value) ? Math.max(0, Math.round(value ?? 0)) : 0;
const isFiniteNumber = (value: unknown): value is number =>
	typeof value === 'number' && Number.isFinite(value);

const viewportSize = () => ({
	height: finitePixels(globalThis.visualViewport?.height ?? innerHeight),
	width: finitePixels(globalThis.visualViewport?.width ?? innerWidth)
});

const setPixels = (name: string, value: number) =>
	document.documentElement.style.setProperty(
		name,
		`${finitePixels(value)}px`
	);

const ensureStyle = () => {
	let style = document.getElementById(STYLE_ID);
	if (!(style instanceof HTMLStyleElement)) {
		style = document.createElement('style');
		style.id = STYLE_ID;
		style.textContent = STATUS_STYLE;
		document.head.append(style);
	}
};

const ensureViewport = () => {
	let viewport = document.head.querySelector<HTMLMetaElement>(
		'meta[name="viewport"]'
	);
	if (!viewport) {
		viewport = document.createElement('meta');
		viewport.name = 'viewport';
		document.head.prepend(viewport);
	}
	const values = new Set(
		viewport.content
			.split(',')
			.map((value) => value.trim())
			.filter(Boolean)
	);
	values.add('width=device-width');
	values.add('initial-scale=1');
	values.add('viewport-fit=cover');
	viewport.content = [...values].join(',');
};

const ensureAnnouncer = () => {
	let announcer = document.getElementById(ANNOUNCER_ID);
	if (!(announcer instanceof HTMLElement)) {
		announcer = document.createElement('div');
		announcer.id = ANNOUNCER_ID;
		announcer.dataset.absoluteMobileAnnouncer = '';
		announcer.setAttribute('aria-atomic', 'true');
		announcer.setAttribute('aria-live', 'polite');
		announcer.setAttribute('role', 'status');
		document.body.append(announcer);
	}

	return announcer;
};

const dispatchState = (state: AbsoluteMobileAdaptiveShellState) =>
	dispatchEvent(
		new CustomEvent<AbsoluteMobileAdaptiveShellState>(
			'absolute:adaptive-shell-change',
			{ detail: state }
		)
	);

const defaultDevices: AbsoluteMobileAdaptiveShellDevices = {
	keyboard,
	network,
	platform,
	systemBars
};

const hostSafeAreaInsets = (value: unknown) => {
	if (typeof value !== 'object' || value === null) return undefined;
	const candidate = Reflect.get(value, 'safeAreaInsets');
	if (typeof candidate !== 'object' || candidate === null) return undefined;
	const insets: Record<'bottom' | 'left' | 'right' | 'top', unknown> = {
		bottom: Reflect.get(candidate, 'bottom'),
		left: Reflect.get(candidate, 'left'),
		right: Reflect.get(candidate, 'right'),
		top: Reflect.get(candidate, 'top')
	};
	if (
		!isFiniteNumber(insets.bottom) ||
		!isFiniteNumber(insets.left) ||
		!isFiniteNumber(insets.right) ||
		!isFiniteNumber(insets.top)
	)
		return undefined;

	return {
		bottom: finitePixels(insets.bottom),
		left: finitePixels(insets.left),
		right: finitePixels(insets.right),
		top: finitePixels(insets.top)
	};
};

/** Installs the framework-neutral environment contract owned by the native shell. */
export const installAbsoluteMobileAdaptiveShell = async (
	devices: AbsoluteMobileAdaptiveShellDevices = defaultDevices
): Promise<AbsoluteMobileAdaptiveShell> => {
	let disposed = false;
	let keyboardState: DeviceKeyboardState = { ...DEFAULT_KEYBOARD };
	let networkState: DeviceNetworkStatus = { ...DEFAULT_NETWORK };
	let platformInfo: DevicePlatformInfo = { ...DEFAULT_PLATFORM };
	let viewport = viewportSize();
	const subscriptions: DeviceSubscription[] = [];

	const state = (): AbsoluteMobileAdaptiveShellState => ({
		availableHeight: globalThis.visualViewport
			? viewport.height
			: Math.max(0, viewport.height - keyboardState.heightPx),
		keyboard: keyboardState,
		network: networkState,
		platform: platformInfo,
		viewportHeight: viewport.height,
		viewportWidth: viewport.width
	});

	const refreshDocument = () => {
		if (disposed || !document.head || !document.body) return;
		ensureViewport();
		ensureStyle();
		const root = document.documentElement;
		const current = state();
		root.dataset.absoluteMobile = '';
		root.dataset.absoluteRuntime = current.platform.runtime;
		root.dataset.absolutePlatform = current.platform.os;
		root.dataset.absoluteFormFactor = current.platform.formFactor;
		root.dataset.absoluteKeyboard = current.keyboard.visible
			? 'visible'
			: 'hidden';
		root.dataset.absoluteNetwork = current.network.connected
			? 'online'
			: 'offline';
		root.dataset.absoluteConnection = current.network.connectionType;
		root.dataset.absoluteReducedMotion = current.platform
			.prefersReducedMotion
			? 'reduce'
			: 'no-preference';
		const insets = current.platform.safeAreaInsets ?? {
			bottom: 0,
			left: 0,
			right: 0,
			top: 0
		};
		setPixels('--absolute-safe-area-inset-top', insets.top);
		setPixels('--absolute-safe-area-inset-right', insets.right);
		setPixels('--absolute-safe-area-inset-bottom', insets.bottom);
		setPixels('--absolute-safe-area-inset-left', insets.left);
		setPixels('--absolute-keyboard-height', current.keyboard.heightPx);
		setPixels('--absolute-viewport-height', current.viewportHeight);
		setPixels('--absolute-viewport-width', current.viewportWidth);
		setPixels('--absolute-available-height', current.availableHeight);
		ensureAnnouncer();
	};

	const publish = () => {
		refreshDocument();
		dispatchState(state());
	};
	const updateViewport = () => {
		viewport = viewportSize();
		void devices.platform
			.getInfo()
			.then((info) => {
				platformInfo = info;
				publish();

				return undefined;
			})
			.catch(() => publish());
	};
	const updateKeyboard = (next: DeviceKeyboardState) => {
		keyboardState = {
			heightPx: finitePixels(next.heightPx),
			visible: next.visible
		};
		publish();
	};
	const updateNetwork = (next: DeviceNetworkStatus) => {
		const changed = networkState.connected !== next.connected;
		networkState = next;
		publish();
		if (changed || !next.connected)
			ensureAnnouncer().textContent = next.connected
				? 'Connection restored.'
				: 'You are offline.';
	};
	const updateHostMetrics = (event: Event) => {
		const insets = hostSafeAreaInsets(Reflect.get(event, 'detail'));
		if (!insets) return;
		platformInfo = { ...platformInfo, safeAreaInsets: insets };
		publish();
	};
	const installKeyboard = async () => {
		const capability = await devices.keyboard.capability();
		if (!capability.available) return;
		keyboardState = await devices.keyboard.getState();
		subscriptions.push(await devices.keyboard.onChange(updateKeyboard));
	};

	try {
		platformInfo = await devices.platform.getInfo();
	} catch {
		// Environment variables still work when provider metadata is unavailable.
	}
	const initialHostInsets = hostSafeAreaInsets(
		Reflect.get(globalThis, '__absoluteNativeHostMetrics')
	);
	if (initialHostInsets)
		platformInfo = {
			...platformInfo,
			safeAreaInsets: initialHostInsets
		};
	try {
		networkState = await devices.network.getStatus();
		subscriptions.push(await devices.network.onChange(updateNetwork));
	} catch {
		// navigator/viewport behavior remains available without a native listener.
	}
	try {
		await installKeyboard();
	} catch {
		// VisualViewport remains the keyboard fallback on the web and in WebViews.
	}
	try {
		const capability = await devices.systemBars.capability('appearance');
		if (capability.available)
			await devices.systemBars.setAppearance('automatic');
	} catch {
		// System-bar coordination is progressive and must never block startup.
	}

	addEventListener('resize', updateViewport);
	addEventListener(HOST_METRICS_EVENT, updateHostMetrics);
	globalThis.visualViewport?.addEventListener('resize', updateViewport);
	globalThis.visualViewport?.addEventListener('scroll', updateViewport);
	publish();
	if (!networkState.connected)
		ensureAnnouncer().textContent = 'You are offline.';

	return {
		refreshDocument,
		state,
		dispose: async () => {
			if (disposed) return;
			disposed = true;
			removeEventListener('resize', updateViewport);
			removeEventListener(HOST_METRICS_EVENT, updateHostMetrics);
			globalThis.visualViewport?.removeEventListener(
				'resize',
				updateViewport
			);
			globalThis.visualViewport?.removeEventListener(
				'scroll',
				updateViewport
			);
			await Promise.all(
				subscriptions.map((unsubscribe) => unsubscribe())
			);
		}
	};
};
