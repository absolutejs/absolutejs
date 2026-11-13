import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: 'The packaged Svelte `Head` component imports a small icon helper by relative path, and the package shipped the component without that file, so any app using `Head` from `@absolutejs/absolute/svelte/components/Head.js` failed to build with "Could not resolve ../../utils/iconVersion". The helper now ships next to the components.',
	kind: 'fixed',
	summary: 'Apps using the Svelte `Head` component build again'
};
