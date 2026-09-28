import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: 'The React fast path told the browser to re-import a single module: the first non-page file in the batch. A new component added to the page re-imported only the new file, so the page never rendered it; a folder created alongside a file became the target and its URL failed to load; and an edited hook or utility whose importer had not been fetched through the module server re-imported just itself, which updates nothing on screen. Every edited file now gets a target (hooks and utilities resolve to the nearest importing component, falling back to the dependents the dependency graph found), directories and deleted paths are skipped, and the client imports them all before refreshing. On stock Bun the remount fallback rendered the changed child in place of the whole page; it now re-imports the page module for the page on screen and ignores edits that do not reach it.',
	kind: 'fixed',
	summary:
		'React edits that add a component, touch a hook or utility, or create a folder now update the page in place'
};
