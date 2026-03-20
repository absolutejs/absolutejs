import type { HMRClientMessage } from './messages';

/* Type guard for client messages */
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
			return true;
		case 'ready':
			return true;
		case 'request-rebuild':
			return true;
		case 'hydration-error':
			return true;
		case 'hmr-timing':
			return true;
		default:
			return false;
	}
};
