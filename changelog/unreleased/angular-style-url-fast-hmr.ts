import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: 'The surgical Angular HMR path compiled `styleUrl` files synchronously, which Less and Stylus don\'t support. Editing a component whose `styleUrl` was a `.less` or `.styl` file showed "Style file not found" for a file that existed, and the update stalled behind the error overlay. The fast path now compiles Less and Stylus with their async compilers. A style that exists but fails to compile reports the compiler\'s error instead of "not found". The production build and the dev rebuild path already handled Less and Stylus.',
	kind: 'fixed',
	summary:
		'Angular HMR applies edits to components whose `styleUrl` is Less or Stylus, and reports style compile errors accurately'
};
