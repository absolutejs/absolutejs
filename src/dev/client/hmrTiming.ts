import type {
	HMRApplyKind,
	HMRApplyOutcome,
	HMRClientTarget
} from '../../../types/messages';

const MAX_RETAINED_HMR_APPLIES = 50;
const HMR_APPLY_STORAGE_KEY = '__absolute_hmr_last_apply__';

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null;

const isHmrTarget = (value: unknown): value is HMRClientTarget =>
	value === 'capacitor-android' ||
	value === 'capacitor-ios' ||
	value === 'capacitor-native' ||
	value === 'expo-android' ||
	value === 'expo-ios' ||
	value === 'mobile-preview' ||
	value === 'web';

const isHmrKind = (value: unknown): value is HMRApplyKind =>
	value === 'component' ||
	value === 'css' ||
	value === 'full-reload' ||
	value === 'html' ||
	value === 'htmx' ||
	value === 'script';

const isHmrOutcome = (value: unknown): value is HMRApplyOutcome =>
	value === 'applied' || value === 'failed' || value === 'reloaded';

type HmrApply = NonNullable<Window['__ABS_HMR_LAST_APPLY__']>;

const isHmrApply = (value: unknown): value is HmrApply =>
	isRecord(value) &&
	typeof value.clientMs === 'number' &&
	typeof value.duration === 'number' &&
	(value.kind === undefined || isHmrKind(value.kind)) &&
	isHmrOutcome(value.outcome) &&
	typeof value.serverMs === 'number' &&
	isHmrTarget(value.target) &&
	(value.updateId === undefined || typeof value.updateId === 'number');

const getSessionStorage = () => {
	const storage = Reflect.get(window, 'sessionStorage');
	if (!isRecord(storage)) return undefined;

	return storage;
};

const persistHmrApplies = (timings: HmrApply[]) => {
	try {
		const storage = getSessionStorage();
		const setItem = storage && Reflect.get(storage, 'setItem');
		if (typeof setItem !== 'function') return;
		Reflect.apply(setItem, storage, [
			HMR_APPLY_STORAGE_KEY,
			JSON.stringify(timings)
		]);
	} catch {
		// Storage may be unavailable in sandboxed or privacy-restricted documents.
	}
};

export const absoluteHmrClientTarget = () => {
	const currentLocation = Reflect.get(globalThis, 'location');
	if (typeof currentLocation === 'object' && currentLocation !== null) {
		const search = Reflect.get(currentLocation, 'search');
		if (typeof search === 'string') {
			const marker = new URLSearchParams(search).get('__absolute_target');
			if (marker === 'capacitor-android') return marker;
			if (marker === 'capacitor-ios') return marker;
			if (marker === 'expo-android') return marker;
			if (marker === 'expo-ios') return marker;
			if (marker === 'mobile-preview') return marker;
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

export const restoreAbsoluteHmrApply = () => {
	try {
		const storage = getSessionStorage();
		const getItem = storage && Reflect.get(storage, 'getItem');
		if (typeof getItem !== 'function') return;
		const serialized = Reflect.apply(getItem, storage, [
			HMR_APPLY_STORAGE_KEY
		]);
		if (typeof serialized !== 'string') return;
		const stored: unknown = JSON.parse(serialized);
		let timings: HmrApply[] = [];
		if (Array.isArray(stored)) {
			timings = stored
				.filter(isHmrApply)
				.slice(-MAX_RETAINED_HMR_APPLIES);
		} else if (isHmrApply(stored)) timings = [stored];
		const last = timings.at(-1);
		if (!last) return;
		window.__ABS_HMR_LAST_APPLY__ = last;
		window.__ABS_HMR_APPLIES__ = timings;
	} catch {
		// A malformed or inaccessible entry should never affect HMR startup.
	}
};

type SendHmrTimingOptions = {
	clientStart: number;
	kind?: HMRApplyKind;
	outcome?: HMRApplyOutcome;
	serverMs?: number;
	updateId?: number;
};

export const sendAbsoluteHmrTiming = (options: SendHmrTimingOptions) => {
	const clientMs = Math.round(performance.now() - options.clientStart);
	const serverMs = options.serverMs ?? 0;
	const timing = {
		clientMs,
		duration: serverMs + clientMs,
		kind: options.kind,
		outcome: options.outcome ?? 'applied',
		serverMs,
		target: absoluteHmrClientTarget(),
		updateId: options.updateId
	} satisfies NonNullable<Window['__ABS_HMR_LAST_APPLY__']>;
	window.__ABS_HMR_LAST_APPLY__ = timing;
	const applies = (window.__ABS_HMR_APPLIES__ ??= []);
	applies.push(timing);
	if (applies.length > MAX_RETAINED_HMR_APPLIES) {
		applies.splice(0, applies.length - MAX_RETAINED_HMR_APPLIES);
	}
	persistHmrApplies(applies);
	if (!window.__HMR_WS__) return;
	window.__HMR_WS__.send(JSON.stringify({ ...timing, type: 'hmr-timing' }));
};
