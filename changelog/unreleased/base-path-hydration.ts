import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: "Under a base path, a React page whose <head> renders its own inline <script> (a theme script, say) hydrated with a mismatch on every load: React pairs a page's first inline script with the first <script> it finds in <head>, whatever its type, and that was the framework's import map. The import map and the base-path script now remove themselves once they have run. The browser keeps an import map it has registered, so the module specifiers still resolve under the prefix, and React hydrates <head> as it was rendered.",
	kind: 'fixed',
	summary: 'A React page under a base path hydrates without a head mismatch'
};
