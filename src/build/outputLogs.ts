import {
	BUN_BUILD_WARNING_SUPPRESSION,
	TAILWIND_BUN_CSS_WARNING_PATTERN
} from '../constants';

export const outputLogs = (logs: (BuildMessage | ResolveMessage)[]) => {
	for (const log of logs) {
		if (
			// TODO: When bun supports wildcard sideEffects, remove this suppression
			log.message.includes(BUN_BUILD_WARNING_SUPPRESSION) ||
			TAILWIND_BUN_CSS_WARNING_PATTERN.test(log.message)
		)
			continue;

		if (log.level === 'error') console.error(log);
		else if (log.level === 'warning') console.warn(log);
		else console.info(log);
	}
};
