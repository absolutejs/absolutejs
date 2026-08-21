import type {
	HMRApplyKind,
	HMRApplyOutcome,
	HMRClientTarget
} from '../../types/messages';
import type { AbsoluteAndroidWebViewSession } from './androidWebView';

const DEFAULT_ROUTE_TIMEOUT_MS = 30_000;
const DEFAULT_HMR_TIMEOUT_MS = 30_000;

export type AbsoluteAndroidHmrApply = {
	clientMs: number;
	duration: number;
	kind?: HMRApplyKind;
	outcome: HMRApplyOutcome;
	serverMs: number;
	target: HMRClientTarget;
	updateId?: number;
};

export type AbsoluteAndroidRouteCheck = {
	bodyText: string;
	hmrConnected: boolean;
	lastApply?: AbsoluteAndroidHmrApply;
	nativeTarget: string;
	overlayVisible: boolean;
	route: string;
	title: string;
	url: string;
};

const routeExpression = `(() => {
	const lastApply = window.__ABS_HMR_LAST_APPLY__;
	return {
		bodyText: document.body?.innerText?.trim() ?? '',
		hmrConnected: window.__HMR_WS__?.readyState === WebSocket.OPEN,
		lastApply,
		nativeTarget: window.__ABS_HMR_TARGET__ ?? '',
		overlayVisible: document.querySelector('#absolutejs-error-overlay') !== null,
		title: document.title,
		url: location.href
	};
})()`;

type RawRouteCheck = Omit<AbsoluteAndroidRouteCheck, 'route'>;

const normalizeRoute = (route: string) => {
	const value = route.trim();
	if (!value.startsWith('/') || value.startsWith('//')) {
		throw new TypeError(
			'Android conformance routes must be absolute application paths.'
		);
	}

	return value;
};

export const absoluteAndroidDevelopmentUrl = (
	port: number,
	route: string,
	https = false
) => {
	if (!Number.isInteger(port) || port < 1 || port > 65_535) {
		throw new TypeError('Android conformance requires a valid dev port.');
	}
	const url = new URL(
		`${https ? 'https' : 'http'}://localhost:${port}${normalizeRoute(route)}`
	);
	url.searchParams.set('__absolute_target', 'capacitor-android');

	return url.href;
};

export const inspectAbsoluteAndroidRoute = async (
	session: AbsoluteAndroidWebViewSession,
	options: {
		https?: boolean;
		port: number;
		route: string;
		timeoutMs?: number;
	}
) => {
	const route = normalizeRoute(options.route);
	await session.navigate(
		absoluteAndroidDevelopmentUrl(options.port, route, options.https)
	);
	const result = await session.waitFor<RawRouteCheck>(
		`(() => {
			const value = ${routeExpression};
			return value.bodyText.length > 0 && value.hmrConnected && value.nativeTarget === 'capacitor-android' ? value : null;
		})()`,
		{ timeoutMs: options.timeoutMs ?? DEFAULT_ROUTE_TIMEOUT_MS }
	);
	const check = { ...result, route } satisfies AbsoluteAndroidRouteCheck;
	if (check.overlayVisible) {
		throw new Error(
			`Android route ${route} loaded with the AbsoluteJS error overlay visible.`
		);
	}

	return check;
};

export const waitForAbsoluteAndroidHmrApply = async (
	session: AbsoluteAndroidWebViewSession,
	options: {
		afterUpdateId?: number;
		kind?: HMRApplyKind;
		timeoutMs?: number;
	}
) => {
	const expectedKind = JSON.stringify(options.kind);
	const afterUpdateId = JSON.stringify(options.afterUpdateId);
	const apply = await session.waitFor<AbsoluteAndroidHmrApply>(
		`(() => {
			const applies = window.__ABS_HMR_APPLIES__ ?? [];
			const values = applies.length > 0
				? applies
				: [window.__ABS_HMR_LAST_APPLY__];
			for (let index = values.length - 1; index >= 0; index -= 1) {
				const value = values[index];
				if (!value || value.target !== 'capacitor-android') continue;
				if (${expectedKind} !== undefined && value.kind !== ${expectedKind}) continue;
				if (${afterUpdateId} !== undefined && !(value.updateId > ${afterUpdateId})) continue;
				return value;
			}
			return null;
		})()`,
		{ timeoutMs: options.timeoutMs ?? DEFAULT_HMR_TIMEOUT_MS }
	);
	if (apply.outcome === 'failed') {
		throw new Error(
			`Android HMR update ${apply.updateId ?? 'unknown'} reported a failed ${apply.kind ?? 'unknown'} apply.`
		);
	}

	return apply;
};
