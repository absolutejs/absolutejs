import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: "A persisted island (`persist`) now keeps its instance across a navigation into an Angular page, which completes that destination for every framework the layer supports. Angular's island component client-renders its container — the server replaces the whole `<absolute-island>` element with the island's markup, so there is no host element left for Angular to hydrate — and it used to fill that container with a fresh copy of the markup, discarding the live island the navigation layer had moved in. It now looks for the live island first, by the island id the server stamps on every island or by the `persist` key, in the document and then in the disposer registry, which is the only thing still holding the element once the container it arrived in is gone. The same component also wrote its markup twice, once from `ngOnChanges` and again from `ngAfterViewInit`: the second write replaced an island the islands runtime had just hydrated, orphaning the first instance on detached nodes. It now leaves a container that already holds an island alone. An Angular page entered cold still hydrates its island twice, which is unrelated to persistence and recorded in the cross-framework navigation plan with the explanations ruled out so far.",
	kind: 'fixed',
	summary:
		'A persisted island survives a navigation into an Angular page, and Angular writes its island once'
};
