import type { AIServerMessage } from '../../types/ai';
import { isValidAIClientMessage } from '../../types/typeGuards';

export const generateId = () => crypto.randomUUID();

export const parseAIMessage = (raw: unknown) => {
	if (raw === null || raw === undefined) {
		return null;
	}

	let text: string;

	if (typeof raw === 'string') {
		text = raw;
	} else if (raw instanceof ArrayBuffer) {
		text = new TextDecoder().decode(raw);
	} else if (ArrayBuffer.isView(raw)) {
		text = new TextDecoder().decode(raw);
	} else if (typeof raw === 'object') {
		if (isValidAIClientMessage(raw)) {
			return raw;
		}

		return null;
	} else {
		return null;
	}

	try {
		const parsed: unknown = JSON.parse(text);

		if (isValidAIClientMessage(parsed)) {
			return parsed;
		}

		return null;
	} catch {
		return null;
	}
};

export const serializeAIMessage = (message: AIServerMessage) =>
	JSON.stringify(message);
