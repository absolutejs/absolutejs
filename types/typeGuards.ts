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
		case 'hmr-timing':
			return true;
		default:
			return false;
	}
};
