import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: "The props guard added in 0.20.0-beta.225 read `Object.entries(process.env)` with no test for whether there is an environment to read, and that module is reachable from browser code: an island re-derives its own marker attributes to find the element it hydrates into (`getIslandMarkerAttributes` → `serializeIslandProps` → `assertNoServerSecrets`). Bun does not inline `process.env` into a browser bundle, so every island that went through that path threw `ReferenceError: process is not defined` and never hydrated. The environment is now read only where there is one — a browser has no secrets to guard, and the props it is re-serializing are already in the page. Found by the new client-boundary build check on this repo's own example build, which is the first thing that would have caught it.",
	kind: 'fixed',
	summary: 'An island no longer fails to hydrate on a missing process.env'
};
