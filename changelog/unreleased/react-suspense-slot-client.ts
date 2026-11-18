import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: 'A React SuspenseSlot rendered through children(value) now streams its value with its HTML. The browser SuspenseSlot takes the streamed slot over and renders children(value) interactively, with no hydration mismatch and no second fetch. A slot mounted after hydration (a client-side navigation) resolves in the browser from resolve or promise, showing fallback until it does. The new onResolved prop receives the value in the browser either way, so it can seed a cache such as React Query. Slots whose children are plain nodes stream HTML as before.',
	kind: 'added',
	summary:
		'React SuspenseSlot stays interactive after streaming and resolves on client navigation',
	symbols: ['SuspenseSlot']
};
