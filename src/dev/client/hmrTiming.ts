import type { HMRApplyKind, HMRApplyOutcome } from '../../../types/messages';

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null;

export const absoluteHmrClientTarget = () => {
	const currentLocation = Reflect.get(globalThis, 'location');
	if (typeof currentLocation === 'object' && currentLocation !== null) {
		const search = Reflect.get(currentLocation, 'search');
		if (typeof search === 'string') {
			const marker = new URLSearchParams(search).get('__absolute_target');
			if (marker === 'capacitor-android') return marker;
			if (marker === 'capacitor-ios') return marker;
		}
	}
	const capacitor = Reflect.get(globalThis, 'Capacitor');
	if (!isRecord(capacitor)) return 'web';
	const getPlatform = Reflect.get(capacitor, 'getPlatform');
	const isNativePlatform = Reflect.get(capacitor, 'isNativePlatform');
	const platform =
		typeof getPlatform === 'function'
			? Reflect.apply(getPlatform, capacitor, [])
			: undefined;
	if (platform === 'android') return 'capacitor-android';
	if (platform === 'ios') return 'capacitor-ios';
	if (
		typeof isNativePlatform === 'function' &&
		Reflect.apply(isNativePlatform, capacitor, []) === true
	) {
		return 'capacitor-native';
	}

	return 'web';
};

type SendHmrTimingOptions = {
	clientStart: number;
	kind?: HMRApplyKind;
	outcome?: HMRApplyOutcome;
	serverMs?: number;
	updateId?: number;
};

export const sendAbsoluteHmrTiming = (options: SendHmrTimingOptions) => {
	if (!window.__HMR_WS__) return;
	const clientMs = Math.round(performance.now() - options.clientStart);
	const serverMs = options.serverMs ?? 0;
	window.__HMR_WS__.send(
		JSON.stringify({
			clientMs,
			duration: serverMs + clientMs,
			kind: options.kind,
			outcome: options.outcome ?? 'applied',
			serverMs,
			target: absoluteHmrClientTarget(),
			type: 'hmr-timing',
			updateId: options.updateId
		})
	);
};
