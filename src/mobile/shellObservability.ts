import {
	createBeacon,
	type Beacon,
	type BeaconEvent
} from '@absolutejs/beacon';
import { resolveAbsoluteMobileRoute } from './routeMatcher';
import type {
	AbsoluteMobileClientManifest,
	AbsoluteMobileFetch
} from './transport';

export type AbsoluteMobileObservabilityEngine = 'capacitor' | 'expo';

export type AbsoluteMobileShellObservability = {
	beacon: Beacon;
	captureException: (
		error: unknown,
		context?: { phase?: string; path?: string }
	) => void;
};

const capacitorPlatform = () => {
	const capacitor = Reflect.get(globalThis, 'Capacitor');
	if (typeof capacitor !== 'object' || capacitor === null) return undefined;
	const getPlatform = Reflect.get(capacitor, 'getPlatform');
	if (typeof getPlatform !== 'function') return undefined;
	const value: unknown = getPlatform.call(capacitor);

	return value === 'android' || value === 'ios' || value === 'web'
		? value
		: undefined;
};

const platform = () => {
	const nativePlatform = capacitorPlatform();
	if (nativePlatform) return nativePlatform;
	const agent = typeof navigator === 'undefined' ? '' : navigator.userAgent;
	if (/Android/u.test(agent)) return 'android';
	if (/(?:iPad|iPhone|iPod)/u.test(agent)) return 'ios';

	return 'web';
};

const routeContext = (manifest: AbsoluteMobileClientManifest, path: string) => {
	let pathname = path;
	try {
		({ pathname } = new URL(path, manifest.productionOrigin));
	} catch {
		// A malformed application path is itself reportable without preserving it.
	}
	const route = resolveAbsoluteMobileRoute(manifest.routes, pathname);
	const page = route
		? manifest.pages.find((candidate) => candidate.pageId === route.pageId)
		: undefined;

	return {
		...(page
			? {
					mobileFramework: page.framework,
					mobilePageBundle: page.bundleHash,
					mobilePageContract: page.contract,
					mobilePageId: page.pageId
				}
			: {}),
		...(route ? { mobileRoute: route.pattern } : {})
	};
};

export const installAbsoluteMobileShellObservability = (
	manifest: AbsoluteMobileClientManifest,
	engine: AbsoluteMobileObservabilityEngine,
	fetch: AbsoluteMobileFetch = globalThis.fetch
): AbsoluteMobileShellObservability | undefined => {
	const config = manifest.observability;
	if (!config) return undefined;
	if (config.sampleRate === 0) return undefined;
	const beforeSend = (event: BeaconEvent): BeaconEvent => ({
		...event,
		tags: {
			...event.tags,
			absoluteMobile: 'true',
			mobileAppBuild: manifest.appBuild,
			mobileEngine: engine,
			mobileManifestFormat: String(manifest.format),
			mobileNativeRuntime: manifest.nativeRuntime,
			mobilePlatform: platform(),
			mobileRuntime: manifest.runtime,
			...routeContext(
				manifest,
				typeof location === 'undefined' ? manifest.entry : location.href
			)
		}
	});
	const beacon = createBeacon({
		beforeSend,
		endpoint: config.endpoint,
		...(config.environment ? { environment: config.environment } : {}),
		project: config.project,
		redact: true,
		release: manifest.appBuild,
		sampleRate: config.sampleRate,
		transport: async ({ body, url }) => {
			try {
				await fetch(url, {
					body,
					headers: { 'content-type': 'application/json' },
					method: 'POST'
				});
			} catch {
				// Production reporting must never become an application failure.
			}
		}
	});

	return {
		beacon,
		captureException: (error, context = {}) => {
			const target = context.path
				? routeContext(manifest, context.path)
				: {};
			let tags: Record<string, string> | undefined;
			if (Object.keys(target).length > 0) tags = target;
			if (context.phase) {
				tags = {
					mobileFailurePhase: context.phase,
					...target
				};
			}
			beacon.captureException(error, tags ? { tags } : {});
		}
	};
};
