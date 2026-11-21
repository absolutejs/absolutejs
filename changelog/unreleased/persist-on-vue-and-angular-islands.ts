import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: "`persist` did nothing on a Vue page, and nothing on an Angular one. Vue's `<Island>` did not declare a `persist` prop and Vue drops undeclared props, so a Vue page's island markup carried no persist key: the navigation layer found no island to match the live one against, and a persisted island arriving on or leaving a Vue page was torn down like any other. Angular had the same gap in a different place — its server-island lowering builds the marker from the attributes on `<absolute-island>` and did not read `persist`. Both now carry the key, so a persisted island keeps its instance and its DOM state across a navigation into a Vue page: one mount, nothing destroyed, the typed value and the running interval intact, the same as a React or Svelte destination. An Angular page as a destination is not yet verified end to end, but its plumbing is covered by a unit test on the lowering.",
	kind: 'fixed',
	summary: 'A `persist` key survives Vue and Angular island markup',
	symbols: ['Island']
};
