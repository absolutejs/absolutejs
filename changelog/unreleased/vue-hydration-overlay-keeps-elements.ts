import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: 'beta.357 collected Vue hydration warnings for the development overlay through `app.config.warnHandler`. Vue hands a handler the message with every node already turned into "[object HTMLDivElement]", and installing one stops Vue writing the warning to the console, so the live element was lost from both. The page now reads the warnings from `console.warn` while it hydrates and passes each call through untouched: the console keeps the mismatching node to inspect, and the overlay shows it as `<div.ai-widget>` or `<!--v-if-->`. The watch ends in the mount\'s `finally`. A page whose `setupApp` installs its own `warnHandler` receives the warnings there, as Vue intends.',
	kind: 'fixed',
	summary:
		'The development hydration overlay names the mismatching element, and the console keeps it',
	symbols: []
};
