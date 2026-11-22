import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: 'Svelte, Vue and Angular route pages are split again in the most common SPA: one whose navigation names its pages (`<Link to="/settings">Settings</Link>` beside a `Settings` page). The splitters decided a page was "used elsewhere" by counting its name anywhere in the file, so the name in a link\'s label, any other text, or a comment kept every such page in the entry. They now count references only: tags and identifiers in code and template expressions (Svelte from its parsed component; Vue from both script blocks, component tags in either case and bound template expressions; Angular from its TypeScript AST). Also: the router Angular pages get no longer adds `withEnabledBlockingInitialNavigation()`, which Angular refuses alongside hydration (NG05001 in development); Angular\'s hydration already waits for the router\'s first navigation, lazy pages included.',
	kind: 'fixed',
	summary:
		'Route pages named in their own navigation are split; Angular SPA pages no longer log NG05001'
};
