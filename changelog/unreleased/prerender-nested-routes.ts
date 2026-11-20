import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: 'A pre-rendered route was stored under a flattened name: `/docs/guide` became `docs-guide.html`. prepare() rebuilds the route map from that directory on every boot and read the name back as `/docs-guide`, so a nested route never served from its own cache — it missed the map and rendered dynamically on every request, losing the point of pre-rendering it — while its HTML answered a URL nobody pre-rendered. Two routes could also land on one file, since `/a/b` and `/a-b` both wrote `docs-guide`-style names, and whichever rendered last won. A pre-rendered file now mirrors its URL (`docs/guide.html`), which is reversible and collision-free, and the directory listing recurses. The mapping and its inverse live in one module so the writer and the reader cannot disagree again — that disagreement was the bug.',
	kind: 'fixed',
	summary: 'A nested route is pre-rendered and served at its own path'
};
