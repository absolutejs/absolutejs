import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test
} from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import {
	installAbsoluteMobileAdaptiveShell,
	type AbsoluteMobileAdaptiveShellDevices
} from '../../../src/mobile/adaptiveShell';
import type {
	DeviceKeyboardState,
	DeviceNetworkStatus
} from '@absolutejs/devices';

beforeAll(() => GlobalRegistrator.register());
afterAll(() => GlobalRegistrator.unregister());

beforeEach(() => {
	Reflect.deleteProperty(globalThis, '__absoluteNativeHostMetrics');
	Reflect.deleteProperty(globalThis, 'visualViewport');
	document.documentElement.replaceChildren(
		document.createElement('head'),
		document.createElement('body')
	);
	for (const attribute of [...document.documentElement.attributes])
		document.documentElement.removeAttribute(attribute.name);
	Object.defineProperty(globalThis, 'innerHeight', {
		configurable: true,
		value: 800
	});
	Object.defineProperty(globalThis, 'innerWidth', {
		configurable: true,
		value: 400
	});
});

const fixture = () => {
	let keyboardListener: ((state: DeviceKeyboardState) => void) | undefined;
	let networkListener: ((state: DeviceNetworkStatus) => void) | undefined;
	let appearance: string | undefined;
	let disposed = 0;
	const devices: AbsoluteMobileAdaptiveShellDevices = {
		keyboard: {
			capability: async () => ({ available: true, fidelity: 'native' }),
			getState: async () => ({ heightPx: 0, visible: false }),
			onChange: async (listener) => {
				keyboardListener = listener;

				return () => {
					disposed += 1;
				};
			}
		},
		network: {
			getStatus: async () => ({
				connected: true,
				connectionType: 'wifi'
			}),
			onChange: async (listener) => {
				networkListener = listener;

				return () => {
					disposed += 1;
				};
			}
		},
		platform: {
			getInfo: async () => ({
				formFactor: 'phone',
				isNative: true,
				os: 'ios',
				prefersReducedMotion: true,
				runtime: 'capacitor',
				safeAreaInsets: { bottom: 34, left: 0, right: 0, top: 59 }
			})
		},
		systemBars: {
			capability: async () => ({ available: true, fidelity: 'native' }),
			setAppearance: async (value) => {
				appearance = value;
			}
		}
	};

	return {
		devices,
		appearance: () => appearance,
		disposed: () => disposed,
		keyboard: (state: DeviceKeyboardState) => keyboardListener?.(state),
		network: (state: DeviceNetworkStatus) => networkListener?.(state)
	};
};

describe('mobile adaptive shell', () => {
	test('publishes native layout state without styling author content', async () => {
		const input = fixture();
		document.body.className = 'author-page';
		const shell = await installAbsoluteMobileAdaptiveShell(input.devices);

		expect(document.documentElement.dataset.absoluteMobile).toBe('');
		expect(document.documentElement.dataset.absolutePlatform).toBe('ios');
		expect(document.documentElement.dataset.absoluteNetwork).toBe('online');
		expect(document.documentElement.dataset.absoluteReducedMotion).toBe(
			'reduce'
		);
		expect(
			document.documentElement.style.getPropertyValue(
				'--absolute-safe-area-inset-top'
			)
		).toBe('59px');
		expect(
			document.documentElement.style.getPropertyValue(
				'--absolute-viewport-height'
			)
		).toBe('800px');
		expect(
			document
				.querySelector('meta[name="viewport"]')
				?.getAttribute('content')
		).toContain('viewport-fit=cover');
		expect(document.body.className).toBe('author-page');
		expect(input.appearance()).toBe('automatic');

		input.keyboard({ heightPx: 300, visible: true });
		expect(document.documentElement.dataset.absoluteKeyboard).toBe(
			'visible'
		);
		expect(
			document.documentElement.style.getPropertyValue(
				'--absolute-available-height'
			)
		).toBe('500px');

		input.network({ connected: false, connectionType: 'none' });
		expect(document.documentElement.dataset.absoluteNetwork).toBe(
			'offline'
		);
		expect(
			document.getElementById('absolute-mobile-announcer')?.textContent
		).toBe('You are offline.');
		dispatchEvent(
			new CustomEvent('absolute:native-host-metrics', {
				detail: {
					safeAreaInsets: {
						bottom: 21,
						left: 1,
						right: 2,
						top: 47
					}
				}
			})
		);
		expect(
			document.documentElement.style.getPropertyValue(
				'--absolute-safe-area-inset-top'
			)
		).toBe('47px');

		await shell.dispose();
		expect(input.disposed()).toBe(2);
	});

	test('restores the contract after a static document replaces head and html attributes', async () => {
		const input = fixture();
		const shell = await installAbsoluteMobileAdaptiveShell(input.devices);
		document.head.replaceChildren(document.createElement('title'));
		for (const attribute of [...document.documentElement.attributes])
			document.documentElement.removeAttribute(attribute.name);

		shell.refreshDocument();

		expect(
			document.getElementById('absolute-mobile-adaptive-shell')
		).not.toBeNull();
		expect(document.documentElement.dataset.absoluteRuntime).toBe(
			'capacitor'
		);
		expect(document.querySelector('meta[name="viewport"]')).not.toBeNull();
		await shell.dispose();
	});

	test('does not subtract keyboard height twice when VisualViewport already resized', async () => {
		const input = fixture();
		const visualViewport = Object.assign(new EventTarget(), {
			height: 800,
			offsetLeft: 0,
			offsetTop: 0,
			onresize: null,
			onscroll: null,
			pageLeft: 0,
			pageTop: 0,
			scale: 1,
			width: 400
		});
		Object.defineProperty(globalThis, 'visualViewport', {
			configurable: true,
			value: visualViewport
		});
		const shell = await installAbsoluteMobileAdaptiveShell(input.devices);
		visualViewport.height = 500;
		visualViewport.dispatchEvent(new Event('resize'));
		input.keyboard({ heightPx: 300, visible: true });

		expect(shell.state().availableHeight).toBe(500);
		await shell.dispose();
	});
});
