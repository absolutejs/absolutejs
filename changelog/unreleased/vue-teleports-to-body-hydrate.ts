import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: 'Vue collects a `<Teleport>`\'s server markup apart from the page, and hydration looks for it as the target\'s first children. The page handler wrote only the framework\'s own `#absolute-teleports` target, so on a server-rendered page (every routed page since beta.244) the content of `<Teleport to="body">` was missing from the HTML. Hydration then matched the teleport against the page\'s own markup: the teleported elements never appeared, mismatch recovery replaced server markup (a blank page in some cases), and the next update to the teleport threw inside Vue ("Cannot read properties of null (reading \'emitsOptions\')"), so a router navigation left the previous route on screen. Body teleports are now written directly after `<body>`, before `#root`. A teleport into an element of the page itself cannot hydrate (Vue does not support it either) and is now reported once per page and target with what to do, instead of being dropped silently; so is a body teleport on a `streaming: true` page, whose `<body>` start is sent before the render finishes.',
	kind: 'fixed',
	summary:
		'`<Teleport to="body">` is server-rendered where hydration looks for it',
	symbols: ['handleVuePageRequest']
};
