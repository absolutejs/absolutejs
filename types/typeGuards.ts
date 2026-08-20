import type { HMRClientMessage } from './messages';

/* Type guard for HMR client messages */
export const isValidHMRClientMessage = (
	data: unknown
): data is HMRClientMessage => {
	if (!data || typeof data !== 'object') {
		return false;
	}

	if (!('type' in data) || typeof data.type !== 'string') {
		return false;
	}

	switch (data.type) {
		case 'ping':
		case 'ready':
		case 'request-rebuild':
		case 'hydration-error':
		case 'angular:hmr-ack':
			return true;
		case 'hmr-timing':
			return (
				typeof Reflect.get(data, 'duration') === 'number' &&
				Number.isFinite(Reflect.get(data, 'duration')) &&
				isOptionalHmrApplyKind(Reflect.get(data, 'kind')) &&
				isOptionalHmrApplyOutcome(Reflect.get(data, 'outcome'))
			);
		default:
			return false;
	}
};

const isOptionalHmrApplyKind = (value: unknown) =>
	value === undefined ||
	value === 'component' ||
	value === 'css' ||
	value === 'full-reload' ||
	value === 'html' ||
	value === 'htmx' ||
	value === 'script';

const isOptionalHmrApplyOutcome = (value: unknown) =>
	value === undefined ||
	value === 'applied' ||
	value === 'failed' ||
	value === 'reloaded';
