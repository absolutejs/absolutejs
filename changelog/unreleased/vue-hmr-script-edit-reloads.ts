import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: 'In `absolute dev`, every Vue hot update was applied with `__VUE_HMR_RUNTIME__.rerender()`, which swaps only the render function and keeps the instance\'s old `setup()` result. After an edit to `<script>` or `<script setup>` the new template read bindings the old setup never returned: a newly imported component, ref or function was `undefined`, so Vue warned "Invalid vnode type when creating vnode: undefined" and the added element never appeared until the page was reloaded. A component created while dev runs and imported by one the page renders was the common case. A script edit now updates with `reload()`, re-running setup; a template or style edit still rerenders and keeps state. The choice is recorded per file version, so every open tab gets the same instruction.',
	kind: 'fixed',
	summary:
		'A Vue script edit in dev re-runs setup, so a newly imported component or binding appears without a reload',
	symbols: []
};
