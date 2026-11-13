import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: "Angular pages ran zoneless only, so apps and libraries that rely on zone.js (NgZone, change detection after timers or manually added event listeners) didn't update. Set `angular: { changeDetection: 'zone' }` in absolute.config.ts and add zone.js to your app (`bun add zone.js`). Server rendering then waits for the timers and requests a page starts, the browser loads zone.js before Angular boots, and hydration and HMR keep working. Async functions in your Angular code are compiled to generators in this mode, because zone.js can't follow native `await`. Elysia routes keep working with zone.js loaded on the server. The default stays zoneless. Angular islands still render zoneless in zone mode.",
	kind: 'added',
	summary: 'Angular pages can opt into zone.js change detection'
};
