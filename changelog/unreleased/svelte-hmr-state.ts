import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: "On every Svelte component update the HMR client read the first number out of the page's first `<button>`, stored it in sessionStorage and remounted the page with it as an `initialCount` prop. On a page whose first button said \"Page 1\", editing any component reset a counter elsewhere on the page and injected `initialCount: 1`. The scaffold's demo only worked because its first button happened to be the counter. The client now leaves state to Svelte's own HMR and never reads it from the DOM. The dev server also stopped re-importing the components that import an edited `.svelte` file: `$.hmr` already swaps the edited component in place, and re-importing the page re-created every component under it. As in any Svelte setup, the edited component itself restarts from its props, and components elsewhere on the page keep their `$state`.",
	kind: 'fixed',
	summary:
		'Svelte HMR keeps component state instead of remounting the page with a number read from the first button'
};
