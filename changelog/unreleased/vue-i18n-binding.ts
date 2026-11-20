import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: "Vue pages reach a locale's messages the way React and Svelte pages already do: `provideI18n(payload)` in the page's setup shares them with every component below and returns that page's translator, and `useI18n<typeof en>()` reads it anywhere underneath. The payload is the ordinary page prop `i18n.payload(['home'])` returns, so the browser hydrates against the messages the server rendered. `useI18n()` throws when nothing provided a payload rather than translating into the keys themselves, which would show `home.title` to visitors. Vue's document shell also now writes `lang` and `dir` from the request locale, which it never did: a screen reader announced every Vue page in the browser's default language and an RTL locale rendered left to right.",
	kind: 'added',
	summary:
		'Vue pages get i18n bindings, and a shell that says which language it is in',
	symbols: ['provideI18n', 'useI18n']
};
